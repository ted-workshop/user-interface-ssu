import {
  DELIVERY_LEASE_SECONDS,
  type JobClaim,
  JobError,
  jobLog,
  MAX_ATTEMPTS,
  statement,
  unixNow,
} from "./shared";

const eligibleDelivery = `EXISTS (SELECT 1 FROM channel_subscriptions s WHERE s.id = d.subscription_id AND s.status = 'active')
  AND EXISTS (SELECT 1 FROM recipients r WHERE r.id = d.recipient_id AND r.email = d.recipient_email AND r.verified_at IS NOT NULL AND r.deleted_at IS NULL)
  AND EXISTS (SELECT 1 FROM report_permissions p WHERE p.report_id = d.report_id AND p.audience = 'user' AND p.user_id = d.user_id)`;

export async function getDeliveryMessage(db: D1Database, id: string) {
  const message = await statement(
    db,
    `SELECT d.recipient_email, r.title, r.body_markdown
    FROM deliveries d JOIN reports r ON r.id = d.report_id WHERE d.id = ?`,
    id,
  ).first<{ recipient_email: string; title: string; body_markdown: string }>();
  if (!message) throw new Error("발송할 보고서를 찾지 못했어요.");
  return message;
}

export async function enqueueDelivery(
  db: D1Database,
  userId: string,
  requestId: string,
  recipientId: string,
  now = unixNow(),
) {
  const id = crypto.randomUUID();
  await statement(
    db,
    `INSERT INTO deliveries (id, user_id, request_id, report_id, subscription_id, recipient_id, recipient_email, available_at, created_at)
    SELECT ?, q.user_id, q.id, r.id, q.subscription_id, a.id, a.email, ?, ?
    FROM summary_requests q JOIN reports r ON r.analysis_job_id = q.analysis_job_id
    JOIN recipients a ON a.user_id = q.user_id AND a.id = ?
    WHERE q.id = ? AND q.user_id = ? AND q.origin = 'channel' AND q.status = 'completed'
    AND a.verified_at IS NOT NULL AND a.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM channel_subscriptions WHERE id = q.subscription_id AND status = 'active')
    AND EXISTS (SELECT 1 FROM report_permissions WHERE report_id = r.id AND audience = 'user' AND user_id = q.user_id)
    AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.user_id = q.user_id AND d.report_id = r.id AND (d.recipient_id = a.id OR d.recipient_email = a.email))`,
    id,
    now,
    now,
    recipientId,
    requestId,
    userId,
  ).run();
  const existing = await statement(
    db,
    `SELECT d.id FROM deliveries d JOIN recipients a ON a.user_id = d.user_id
    WHERE d.user_id = ? AND d.request_id = ? AND a.id = ? AND (d.recipient_id = a.id OR d.recipient_email = a.email)`,
    userId,
    requestId,
    recipientId,
  ).first<{ id: string }>();
  if (!existing) throw new JobError("INELIGIBLE");
  return getDelivery(db, userId, existing.id);
}

export async function claimDelivery(
  db: D1Database,
  now = unixNow(),
): Promise<JobClaim | null> {
  const token = crypto.randomUUID();
  const sql = (query: string, ...values: (string | number | null)[]) =>
    statement(db, query, ...values);
  const rows = await db.batch([
    // 확실히 거절된 SMTP 일시 오류만 1분·5분의 대기를 마친 뒤 다시 대기열에 넣어요.
    sql(
      `UPDATE deliveries AS d SET status = 'queued', failure_code = NULL
      WHERE id = (SELECT d.id FROM deliveries d WHERE d.status = 'failed' AND d.failure_code = 'temporary'
        AND d.available_at <= ? AND ${eligibleDelivery}
        AND (SELECT count(*) FROM delivery_attempts WHERE delivery_id = d.id) < ?
        ORDER BY d.available_at, d.id LIMIT 1)`,
      now,
      MAX_ATTEMPTS,
    ),
    sql(
      `UPDATE deliveries SET lease_token = ?, lease_expires_at = ?
      WHERE id = (SELECT d.id FROM deliveries d JOIN delivery_attempts a ON a.delivery_id = d.id
        WHERE d.status = 'sending' AND d.lease_expires_at <= ? AND a.status = 'started' AND a.dispatched_at IS NULL
        ORDER BY d.lease_expires_at, d.id LIMIT 1)`,
      token,
      now + DELIVERY_LEASE_SECONDS,
      now,
    ),
    sql(
      `UPDATE deliveries AS d SET status = 'sending', lease_token = ?, lease_expires_at = ?
      WHERE status = 'queued' AND NOT EXISTS (SELECT 1 FROM deliveries WHERE status = 'sending')
      AND id = (SELECT d.id FROM deliveries d WHERE d.status = 'queued' AND d.available_at <= ? AND ${eligibleDelivery}
        AND (SELECT count(*) FROM delivery_attempts WHERE delivery_id = d.id) < ?
        ORDER BY d.available_at, d.id LIMIT 1)`,
      token,
      now + DELIVERY_LEASE_SECONDS,
      now,
      MAX_ATTEMPTS,
    ),
    sql(
      `INSERT INTO delivery_attempts (id, delivery_id, attempt_number, started_at)
      SELECT ?, d.id, (SELECT coalesce(max(attempt_number), 0) + 1 FROM delivery_attempts WHERE delivery_id = d.id), ?
      FROM deliveries d WHERE d.lease_token = ? AND NOT EXISTS (SELECT 1 FROM delivery_attempts WHERE delivery_id = d.id AND status = 'started')`,
      crypto.randomUUID(),
      now,
      token,
    ),
    sql(
      `SELECT d.id, d.lease_token AS token, a.id AS attemptId, a.attempt_number AS attempt
      FROM deliveries d JOIN delivery_attempts a ON a.delivery_id = d.id WHERE d.lease_token = ? AND a.status = 'started'`,
      token,
    ),
  ]);
  const claim = rows.at(-1)?.results[0] as JobClaim | undefined;
  if (claim) jobLog("delivery", claim.id, "claimed", claim.attempt);
  return claim ?? null;
}

export async function markDeliveryDispatched(
  db: D1Database,
  claim: JobClaim,
  now = unixNow(),
) {
  const rows = await db.batch([
    statement(
      db,
      `UPDATE deliveries AS d SET lease_expires_at = ?
      WHERE id = ? AND status = 'sending' AND lease_token = ? AND lease_expires_at > ? AND ${eligibleDelivery}
      AND EXISTS (SELECT 1 FROM delivery_attempts WHERE id = ? AND status = 'started' AND dispatched_at IS NULL)`,
      now + DELIVERY_LEASE_SECONDS,
      claim.id,
      claim.token,
      now,
      claim.attemptId,
    ),
    statement(
      db,
      `UPDATE delivery_attempts SET dispatched_at = ?
      WHERE id = ? AND status = 'started' AND dispatched_at IS NULL AND EXISTS (
        SELECT 1 FROM deliveries d WHERE d.id = ? AND d.status = 'sending' AND d.lease_token = ? AND d.lease_expires_at > ? AND ${eligibleDelivery})`,
      now,
      claim.attemptId,
      claim.id,
      claim.token,
      now,
    ),
  ]);
  return rows[1]?.meta.changes === 1;
}

export async function completeDelivery(
  db: D1Database,
  claim: JobClaim,
  now = unixNow(),
) {
  const rows = await db.batch([
    statement(
      db,
      `UPDATE delivery_attempts SET status = 'accepted', finished_at = ?
      WHERE id = ? AND status = 'started' AND dispatched_at IS NOT NULL AND EXISTS (
        SELECT 1 FROM deliveries WHERE id = ? AND status = 'sending' AND lease_token = ?)`,
      now,
      claim.attemptId,
      claim.id,
      claim.token,
    ),
    statement(
      db,
      `UPDATE deliveries SET status = 'sent', failure_code = NULL, lease_token = NULL, lease_expires_at = NULL
      WHERE id = ? AND status = 'sending' AND lease_token = ? AND EXISTS (SELECT 1 FROM delivery_attempts WHERE id = ? AND status = 'accepted')`,
      claim.id,
      claim.token,
      claim.attemptId,
    ),
  ]);
  const completed = rows[0]?.meta.changes === 1;
  if (completed) jobLog("delivery", claim.id, "completed", claim.attempt);
  return completed;
}

export async function failDelivery(
  db: D1Database,
  claim: JobClaim,
  code: string,
  now = unixNow(),
) {
  const rows = await db.batch([
    statement(
      db,
      `UPDATE delivery_attempts SET status = ?, failure_code = ?, finished_at = ?
      WHERE id = ? AND status = 'started' AND EXISTS (SELECT 1 FROM deliveries
        WHERE id = ? AND status = 'sending' AND lease_token = ?)`,
      code === "ambiguous" ? "ambiguous" : "rejected",
      code,
      now,
      claim.attemptId,
      claim.id,
      claim.token,
    ),
    statement(
      db,
      `UPDATE deliveries SET status = ?, failure_code = ?, available_at = ?, lease_token = NULL, lease_expires_at = NULL
      WHERE id = ? AND status = 'sending' AND lease_token = ? AND EXISTS (SELECT 1 FROM delivery_attempts WHERE id = ? AND status IN ('rejected', 'ambiguous'))`,
      code === "ambiguous" ? "ambiguous" : "failed",
      code,
      now + (claim.attempt === 1 ? 60 : 300),
      claim.id,
      claim.token,
      claim.attemptId,
    ),
  ]);
  if (rows[0]?.meta.changes === 1)
    jobLog("delivery", claim.id, "failed", claim.attempt, code);
}

// SMTP 호출 전 설정이 바뀌면 확실한 미발송으로 종료해요. 호출 후에는 결과를 추정하지 않아요.
export async function cancelUndispatchedDelivery(
  db: D1Database,
  claim: JobClaim,
  now = unixNow(),
) {
  await db.batch([
    statement(
      db,
      `UPDATE delivery_attempts SET status = 'rejected', failure_code = 'delivery_ineligible', finished_at = ?
      WHERE id = ? AND status = 'started' AND dispatched_at IS NULL AND EXISTS (
        SELECT 1 FROM deliveries d WHERE d.id = ? AND d.lease_token = ? AND d.lease_expires_at > ? AND NOT (${eligibleDelivery}))`,
      now,
      claim.attemptId,
      claim.id,
      claim.token,
      now,
    ),
    statement(
      db,
      `UPDATE deliveries AS d SET status = 'failed', failure_code = CASE
        WHEN NOT EXISTS (SELECT 1 FROM channel_subscriptions WHERE id = d.subscription_id AND status = 'active') THEN 'channel_inactive'
        WHEN NOT EXISTS (SELECT 1 FROM recipients WHERE id = d.recipient_id AND email = d.recipient_email AND verified_at IS NOT NULL AND deleted_at IS NULL) THEN 'recipient_inactive'
        ELSE 'access_revoked' END
      WHERE id = ? AND status = 'sending' AND lease_token = ? AND EXISTS (SELECT 1 FROM delivery_attempts WHERE id = ? AND status = 'rejected' AND dispatched_at IS NULL)`,
      claim.id,
      claim.token,
      claim.attemptId,
    ),
    statement(
      db,
      `UPDATE deliveries SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL
      WHERE id = ? AND status = 'failed' AND lease_token = ? AND failure_code IN ('channel_inactive', 'recipient_inactive', 'access_revoked')`,
      claim.id,
      claim.token,
    ),
  ]);
}

export async function recoverDeliveries(db: D1Database, now = unixNow()) {
  const expired = await statement(
    db,
    `SELECT d.id, (SELECT coalesce(max(attempt_number), 0) FROM delivery_attempts WHERE delivery_id = d.id) AS attempt
    FROM deliveries d WHERE d.status = 'sending'
    AND (d.lease_expires_at IS NULL OR d.lease_expires_at <= ?)
    AND (d.lease_token IS NULL OR EXISTS (SELECT 1 FROM delivery_attempts a WHERE a.delivery_id = d.id AND a.status = 'started' AND a.dispatched_at IS NOT NULL))
    ORDER BY d.lease_expires_at, d.id LIMIT 2`,
    now,
  ).all<{ id: string; attempt: number }>();
  for (const { id, attempt } of expired.results) {
    const rows = await db.batch([
      statement(
        db,
        `UPDATE delivery_attempts SET status = 'ambiguous', failure_code = 'ambiguous', finished_at = ?
        WHERE delivery_id = ? AND status = 'started' AND EXISTS (SELECT 1 FROM deliveries
          WHERE id = ? AND status = 'sending' AND (lease_expires_at IS NULL OR lease_expires_at <= ?))`,
        now,
        id,
        id,
        now,
      ),
      statement(
        db,
        `UPDATE deliveries SET status = 'ambiguous', failure_code = 'ambiguous', lease_token = NULL, lease_expires_at = NULL
        WHERE id = ? AND status = 'sending' AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
        id,
        now,
      ),
    ]);
    if (rows[1]?.meta.changes === 1)
      jobLog("delivery", id, "recovered_unknown", attempt, "ambiguous");
  }
}

type DeliveryRow = {
  id: string;
  status: string;
  attempt: number;
  failureCode: string | null;
  eligible: number;
  availableAt: number;
};

export async function getDelivery(db: D1Database, userId: string, id: string) {
  const row = await statement(
    db,
    `SELECT d.id, d.status, d.failure_code AS failureCode, d.available_at AS availableAt,
    (SELECT coalesce(max(attempt_number), 0) FROM delivery_attempts WHERE delivery_id = d.id) AS attempt,
    (${eligibleDelivery}) AS eligible FROM deliveries d WHERE d.id = ? AND d.user_id = ?`,
    id,
    userId,
  ).first<DeliveryRow>();
  if (!row) throw new JobError("NOT_FOUND");
  return {
    ...row,
    retryable:
      row.status === "failed" &&
      row.failureCode === "temporary" &&
      row.attempt < MAX_ATTEMPTS &&
      row.eligible === 1,
  };
}

export async function retryDelivery(
  db: D1Database,
  userId: string,
  id: string,
  attempt: number,
) {
  const delivery = await getDelivery(db, userId, id);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_ATTEMPTS)
    throw new JobError("RETRY_NOT_ALLOWED");
  if (
    delivery.status === "sent" ||
    delivery.attempt === attempt + 1 ||
    (delivery.attempt === attempt &&
      ["queued", "sending"].includes(delivery.status))
  )
    return delivery;
  if (delivery.attempt !== attempt || !delivery.retryable)
    throw new JobError("RETRY_NOT_ALLOWED");
  // 사용자 재시도도 대기 시간을 줄이지 않도록 available_at을 유지해요.
  await statement(
    db,
    `UPDATE deliveries AS d SET status = 'queued', failure_code = NULL
    WHERE id = ? AND user_id = ? AND status = 'failed' AND failure_code = 'temporary' AND ${eligibleDelivery}
    AND (SELECT max(attempt_number) FROM delivery_attempts WHERE delivery_id = d.id) = ?`,
    id,
    userId,
    attempt,
  ).run();
  jobLog("delivery", id, "retry_requested", attempt);
  return getDelivery(db, userId, id);
}
