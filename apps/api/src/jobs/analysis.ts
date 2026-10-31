import { parseYouTubeUrl, SummaryError, summaryConfigSchema } from "../summary";
import {
  ANALYSIS_LEASE_SECONDS,
  type JobClaim,
  JobError,
  jobLog,
  MAX_ATTEMPTS,
  statement,
  unixNow,
} from "./shared";

const generationSettingsSchema = summaryConfigSchema.omit({ apiKey: true });

// 호출부가 임의 프롬프트를 공통 보고서에 섞지 못하게 현재 생성 설정만 식별해요.
export function generationProfile(model: string) {
  const settings = generationSettingsSchema.parse({ model });
  return {
    model: settings.model,
    api: "interactions",
    videoProcessing: "agentic",
    promptVersion: "adr-0017-v1",
    language: "ko",
    store: false,
    timeoutMs: settings.timeoutMs,
    sdkRetries: "default",
  } as const;
}

export async function parseGenerationProfile(configJson: string, key: string) {
  const settings = generationSettingsSchema.parse(JSON.parse(configJson));
  const profile = generationProfile(settings.model);
  if (JSON.stringify(profile) !== configJson)
    throw new SummaryError("configuration");
  if ((await generationKey(configJson)) !== key)
    throw new SummaryError("configuration");
  return profile;
}

export async function generationKey(config: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(config),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function getAnalysisJob(db: D1Database, id: string) {
  const job = await statement(
    db,
    "SELECT video_id, generation_key, generation_config_json FROM analysis_jobs WHERE id = ?",
    id,
  ).first<{
    video_id: string;
    generation_key: string;
    generation_config_json: string;
  }>();
  if (!job) throw new Error("접수한 분석 작업을 찾지 못했어요.");
  return job;
}

export async function enqueueAnalysis(
  db: D1Database,
  input: {
    userId: string;
    url: string;
    model: string;
    subscriptionId?: string;
    admissionLimit?: number;
  },
  now = unixNow(),
) {
  const { videoId } = parseYouTubeUrl(input.url);
  const config = JSON.stringify(generationProfile(input.model));
  const key = await generationKey(config);
  const jobId = crypto.randomUUID();
  const limit = input.admissionLimit ?? null;
  const day = Math.floor(now / 86_400) * 86_400;
  const sql = (query: string, ...values: (string | number | null)[]) =>
    statement(db, query, ...values);
  // 접수와 기존 결과 재사용까지 한 번에 저장해 응답 유실에도 중간 상태를 남기지 않아요.
  const rows = await db.batch([
    sql(
      `INSERT INTO videos (id) SELECT ? WHERE ? IS NULL OR (
        SELECT count(*) FROM summary_admissions WHERE user_id = ? AND accepted_at >= ? AND accepted_at < ?) < ?
      ON CONFLICT(id) DO NOTHING`,
      videoId,
      limit,
      input.userId,
      day,
      day + 86_400,
      limit,
    ),
    sql(
      `INSERT INTO analysis_jobs (id, video_id, generation_key, generation_config_json, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE ? IS NULL OR (
        SELECT count(*) FROM summary_admissions WHERE user_id = ? AND accepted_at >= ? AND accepted_at < ?) < ?
      ON CONFLICT(video_id, generation_key) DO NOTHING`,
      jobId,
      videoId,
      key,
      config,
      now,
      now,
      limit,
      input.userId,
      day,
      day + 86_400,
      limit,
    ),
    sql(
      `INSERT INTO summary_admissions (analysis_job_id, attempt_number, user_id, accepted_at)
      SELECT id, 1, ?, ? FROM analysis_jobs WHERE id = ? AND ? IS NOT NULL`,
      input.userId,
      now,
      jobId,
      limit,
    ),
    sql(
      `INSERT INTO summary_requests (id, user_id, analysis_job_id, origin, subscription_id, created_at, updated_at)
      SELECT ?, ?, j.id, ?, ?, ?, ? FROM analysis_jobs j WHERE j.video_id = ? AND j.generation_key = ?
      AND NOT EXISTS (SELECT 1 FROM summary_requests WHERE user_id = ? AND analysis_job_id = j.id)`,
      crypto.randomUUID(),
      input.userId,
      input.subscriptionId ? "channel" : "direct",
      input.subscriptionId ?? null,
      now,
      now,
      videoId,
      key,
      input.userId,
    ),
    sql(
      `INSERT INTO report_permissions (id, report_id, audience, user_id, can_read, can_comment, created_at)
      SELECT ?, r.id, 'user', q.user_id, 1, 0, ? FROM summary_requests q
      JOIN analysis_jobs j ON j.id = q.analysis_job_id JOIN reports r ON r.analysis_job_id = j.id
      WHERE q.user_id = ? AND j.video_id = ? AND j.generation_key = ? AND j.status = 'completed' ON CONFLICT DO NOTHING`,
      crypto.randomUUID(),
      now,
      input.userId,
      videoId,
      key,
    ),
    sql(
      `UPDATE summary_requests SET status = 'completed', failure_code = NULL, updated_at = ?
      WHERE user_id = ? AND status != 'completed' AND analysis_job_id IN (SELECT id FROM analysis_jobs WHERE video_id = ? AND generation_key = ? AND status = 'completed')`,
      now,
      input.userId,
      videoId,
      key,
    ),
    sql(
      `UPDATE summary_requests SET status = 'failed', failure_code = (SELECT failure_code FROM analysis_jobs WHERE id = analysis_job_id), updated_at = ?
      WHERE user_id = ? AND status = 'queued' AND analysis_job_id IN (SELECT id FROM analysis_jobs WHERE video_id = ? AND generation_key = ? AND status = 'failed')`,
      now,
      input.userId,
      videoId,
      key,
    ),
  ]);
  const request = await sql(
    `SELECT q.id FROM summary_requests q
    JOIN analysis_jobs j ON j.id = q.analysis_job_id WHERE q.user_id = ? AND j.video_id = ? AND j.generation_key = ?`,
    input.userId,
    videoId,
    key,
  ).first<{ id: string }>();
  if (!request)
    throw new JobError(
      limit === null
        ? "INELIGIBLE"
        : limit === 0
          ? "SUMMARY_UNAVAILABLE"
          : "USAGE_LIMIT_REACHED",
    );
  const current = await getAnalysisRequest(db, input.userId, request.id);
  return {
    ...current,
    accepted:
      rows[3]?.meta.changes === 1 &&
      current.status !== "completed" &&
      current.status !== "failed",
  };
}

const eligibleRequest = `(q.origin = 'direct' OR (
  EXISTS (SELECT 1 FROM channel_subscriptions s WHERE s.id = q.subscription_id AND s.status = 'active')
  AND EXISTS (SELECT 1 FROM recipients r WHERE r.user_id = q.user_id AND r.verified_at IS NOT NULL AND r.deleted_at IS NULL)))`;

export async function claimAnalysis(
  db: D1Database,
  now = unixNow(),
): Promise<JobClaim | null> {
  const token = crypto.randomUUID();
  const sql = (query: string, ...values: (string | number | null)[]) =>
    statement(db, query, ...values);
  const rows = await db.batch([
    // 미호출 시도만 같은 번호로 이어받고 이전 실행자의 저장 권한을 회수해요.
    sql(
      `UPDATE analysis_jobs SET lease_token = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = (SELECT j.id FROM analysis_jobs j JOIN analysis_attempts a ON a.analysis_job_id = j.id
        WHERE j.status = 'running' AND j.lease_expires_at <= ? AND a.status = 'running' AND a.dispatched_at IS NULL
        ORDER BY j.lease_expires_at, j.id LIMIT 1)`,
      token,
      now + ANALYSIS_LEASE_SECONDS,
      now,
      now,
    ),
    sql(
      `UPDATE analysis_jobs SET status = 'running', lease_token = ?, lease_expires_at = ?, updated_at = ?
      WHERE status = 'queued' AND NOT EXISTS (SELECT 1 FROM analysis_jobs WHERE status = 'running')
      AND id = (SELECT j.id FROM analysis_jobs j WHERE j.status = 'queued'
        AND (SELECT count(*) FROM analysis_attempts WHERE analysis_job_id = j.id) < ?
        AND NOT EXISTS (SELECT 1 FROM analysis_attempts WHERE analysis_job_id = j.id AND status IN ('succeeded', 'ambiguous'))
        AND EXISTS (SELECT 1 FROM summary_requests q WHERE q.analysis_job_id = j.id AND q.status = 'queued' AND ${eligibleRequest}
          AND NOT EXISTS (SELECT 1 FROM summary_requests busy WHERE busy.user_id = q.user_id AND busy.status = 'running'))
        ORDER BY j.created_at, j.id LIMIT 1)`,
      token,
      now + ANALYSIS_LEASE_SECONDS,
      now,
      MAX_ATTEMPTS,
    ),
    sql(
      `UPDATE summary_requests AS q SET status = 'running', updated_at = ?
      WHERE status = 'queued' AND EXISTS (SELECT 1 FROM analysis_jobs j WHERE j.id = q.analysis_job_id AND j.lease_token = ?)
      AND ${eligibleRequest} AND NOT EXISTS (SELECT 1 FROM summary_requests busy WHERE busy.user_id = q.user_id AND busy.status = 'running')`,
      now,
      token,
    ),
    sql(
      `INSERT INTO analysis_attempts (id, analysis_job_id, attempt_number, started_at)
      SELECT ?, j.id, (SELECT coalesce(max(attempt_number), 0) + 1 FROM analysis_attempts WHERE analysis_job_id = j.id), ?
      FROM analysis_jobs j WHERE j.lease_token = ?
      AND NOT EXISTS (SELECT 1 FROM analysis_attempts WHERE analysis_job_id = j.id AND status = 'running')`,
      crypto.randomUUID(),
      now,
      token,
    ),
    sql(
      `SELECT j.id, j.lease_token AS token, a.id AS attemptId, a.attempt_number AS attempt
      FROM analysis_jobs j JOIN analysis_attempts a ON a.analysis_job_id = j.id
      WHERE j.lease_token = ? AND a.status = 'running'`,
      token,
    ),
  ]);
  const claim = rows.at(-1)?.results[0] as JobClaim | undefined;
  if (claim) jobLog("analysis", claim.id, "claimed", claim.attempt);
  return claim ?? null;
}

export async function markAnalysisDispatched(
  db: D1Database,
  claim: JobClaim,
  now = unixNow(),
) {
  const rows = await db.batch([
    statement(
      db,
      `UPDATE analysis_jobs AS d SET lease_expires_at = ?
      WHERE id = ? AND status = 'running' AND lease_token = ? AND lease_expires_at > ?
      AND EXISTS (SELECT 1 FROM analysis_attempts WHERE id = ? AND status = 'running' AND dispatched_at IS NULL)`,
      now + ANALYSIS_LEASE_SECONDS,
      claim.id,
      claim.token,
      now,
      claim.attemptId,
    ),
    statement(
      db,
      `UPDATE analysis_attempts SET dispatched_at = ?
      WHERE id = ? AND status = 'running' AND dispatched_at IS NULL AND EXISTS (
        SELECT 1 FROM analysis_jobs d WHERE d.id = ? AND d.status = 'running' AND d.lease_token = ? AND d.lease_expires_at > ?)`,
      now,
      claim.attemptId,
      claim.id,
      claim.token,
      now,
    ),
  ]);
  return rows[1]?.meta.changes === 1;
}

export type AnalysisResult = {
  title: string;
  channel: string;
  channelUrl: string | null;
  markdown: string;
  model: string;
  interactionId: string;
  usage: unknown;
};

export async function completeAnalysis(
  db: D1Database,
  claim: JobClaim,
  result: AnalysisResult,
  now = unixNow(),
) {
  const sql = (query: string, ...values: (string | number | null)[]) =>
    statement(db, query, ...values);
  const rows = await db.batch([
    sql(
      `UPDATE analysis_attempts SET status = 'succeeded', provider_interaction_id = ?, usage_json = ?, finished_at = ?
      WHERE id = ? AND status = 'running' AND dispatched_at IS NOT NULL AND EXISTS (
        SELECT 1 FROM analysis_jobs WHERE id = ? AND status = 'running' AND lease_token = ?)`,
      result.interactionId,
      result.usage == null ? null : JSON.stringify(result.usage),
      now,
      claim.attemptId,
      claim.id,
      claim.token,
    ),
    sql(
      `INSERT INTO reports (id, analysis_job_id, successful_attempt_id, title, channel_name, channel_url, body_markdown, model, created_at)
      SELECT ?, j.id, a.id, ?, ?, ?, ?, ?, ? FROM analysis_jobs j JOIN analysis_attempts a ON a.analysis_job_id = j.id
      WHERE j.id = ? AND j.status = 'running' AND j.lease_token = ? AND a.id = ? AND a.status = 'succeeded'
      ON CONFLICT(analysis_job_id) DO NOTHING`,
      crypto.randomUUID(),
      result.title,
      result.channel,
      result.channelUrl,
      result.markdown,
      result.model,
      now,
      claim.id,
      claim.token,
      claim.attemptId,
    ),
    sql(
      `UPDATE analysis_jobs SET status = 'completed', lease_token = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND lease_token = ? AND EXISTS (SELECT 1 FROM reports WHERE analysis_job_id = ? AND successful_attempt_id = ?)`,
      now,
      claim.id,
      claim.token,
      claim.id,
      claim.attemptId,
    ),
    ...completeRequests(db, claim.id, now),
  ]);
  const completed = rows[0]?.meta.changes === 1;
  if (completed) jobLog("analysis", claim.id, "completed", claim.attempt);
  return completed;
}

function completeRequests(db: D1Database, id: string, now: number) {
  return [
    statement(
      db,
      `INSERT INTO report_permissions (id, report_id, audience, user_id, can_read, can_comment, created_at)
      SELECT q.id, r.id, 'user', q.user_id, 1, 0, ? FROM summary_requests q
      JOIN analysis_jobs j ON j.id = q.analysis_job_id JOIN reports r ON r.analysis_job_id = j.id
      WHERE j.id = ? AND j.status = 'completed' AND q.status IN ('queued', 'running') ON CONFLICT DO NOTHING`,
      now,
      id,
    ),
    statement(
      db,
      `UPDATE summary_requests SET status = 'completed', failure_code = NULL, updated_at = ?
      WHERE analysis_job_id = ? AND status IN ('queued', 'running')
      AND EXISTS (SELECT 1 FROM analysis_jobs WHERE id = ? AND status = 'completed')`,
      now,
      id,
      id,
    ),
  ];
}

export async function failAnalysis(
  db: D1Database,
  claim: JobClaim,
  code: string,
  now = unixNow(),
  usage: unknown = null,
) {
  const sql = (query: string, ...values: (string | number | null)[]) =>
    statement(db, query, ...values);
  const rows = await db.batch([
    sql(
      `UPDATE analysis_attempts SET status = ?, failure_code = ?, usage_json = ?, finished_at = ?
      WHERE id = ? AND status = 'running' AND EXISTS (
        SELECT 1 FROM analysis_jobs WHERE id = ? AND status = 'running' AND lease_token = ?)`,
      code === "provider_outcome_unknown" ? "ambiguous" : "failed",
      code,
      usage === null ? null : JSON.stringify(usage),
      now,
      claim.attemptId,
      claim.id,
      claim.token,
    ),
    sql(
      `UPDATE analysis_jobs SET status = 'failed', failure_code = ?, updated_at = ?, lease_token = NULL, lease_expires_at = NULL
      WHERE id = ? AND lease_token = ? AND EXISTS (SELECT 1 FROM analysis_attempts WHERE id = ? AND status IN ('failed', 'ambiguous'))`,
      code,
      now,
      claim.id,
      claim.token,
      claim.attemptId,
    ),
    ...failRequests(db, claim.id, now),
  ]);
  if (rows[0]?.meta.changes === 1)
    jobLog("analysis", claim.id, "failed", claim.attempt, code);
}

function failRequests(db: D1Database, id: string, now: number) {
  return [
    statement(
      db,
      `UPDATE summary_requests SET status = 'failed',
    failure_code = (SELECT failure_code FROM analysis_jobs WHERE id = ?), updated_at = ?
    WHERE analysis_job_id = ? AND status IN ('queued', 'running')
    AND EXISTS (SELECT 1 FROM analysis_jobs WHERE id = ? AND status = 'failed')`,
      id,
      now,
      id,
      id,
    ),
  ];
}

export async function recoverAnalysis(db: D1Database, now = unixNow()) {
  const expired = await statement(
    db,
    `SELECT j.id, (SELECT coalesce(max(attempt_number), 0) FROM analysis_attempts WHERE analysis_job_id = j.id) AS attempt
    FROM analysis_jobs j WHERE j.status = 'running'
    AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= ?)
    AND (j.lease_token IS NULL OR EXISTS (SELECT 1 FROM analysis_attempts a WHERE a.analysis_job_id = j.id AND a.status = 'running' AND a.dispatched_at IS NOT NULL))
    ORDER BY j.lease_expires_at, j.id LIMIT 2`,
    now,
  ).all<{ id: string; attempt: number }>();
  for (const { id, attempt } of expired.results) {
    const rows = await db.batch([
      statement(
        db,
        `UPDATE analysis_attempts SET status = 'ambiguous', failure_code = 'provider_outcome_unknown', finished_at = ?
        WHERE analysis_job_id = ? AND status = 'running' AND EXISTS (SELECT 1 FROM analysis_jobs
          WHERE id = ? AND status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at <= ?))`,
        now,
        id,
        id,
        now,
      ),
      statement(
        db,
        `UPDATE analysis_jobs SET status = 'failed', failure_code = 'provider_outcome_unknown', updated_at = ?, lease_token = NULL, lease_expires_at = NULL
        WHERE id = ? AND status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
        now,
        id,
        now,
      ),
      ...failRequests(db, id, now),
    ]);
    if (rows[1]?.meta.changes === 1)
      jobLog(
        "analysis",
        id,
        "recovered_unknown",
        attempt,
        "provider_outcome_unknown",
      );
  }
}

type RequestRow = {
  id: string;
  videoId: string;
  origin: "direct" | "channel";
  createdAt: number;
  updatedAt: number;
  eligible: number;
  analysisJobId: string;
  status: "queued" | "running" | "completed" | "failed";
  jobStatus: string;
  attempt: number;
  failureCode: string | null;
  jobFailure: string | null;
  reportId: string | null;
};

const requestQuery = `SELECT q.id, j.video_id AS videoId, q.origin, q.created_at AS createdAt, q.updated_at AS updatedAt,
  CASE WHEN ${eligibleRequest} THEN 1 ELSE 0 END AS eligible,
  j.id AS analysisJobId, q.status, j.status AS jobStatus,
  q.failure_code AS failureCode, j.failure_code AS jobFailure,
  (SELECT coalesce(max(attempt_number), 0) FROM analysis_attempts WHERE analysis_job_id = j.id) AS attempt,
  (SELECT r.id FROM reports r JOIN report_permissions p ON p.report_id = r.id AND p.audience = 'user' AND p.user_id = q.user_id
    WHERE r.analysis_job_id = j.id) AS reportId
  FROM summary_requests q JOIN analysis_jobs j ON j.id = q.analysis_job_id`;

export async function canAdmitAnalysis(
  db: D1Database,
  userId: string,
  limit: number,
  now = unixNow(),
) {
  if (limit <= 0) return false;
  const day = Math.floor(now / 86_400) * 86_400;
  const used = await statement(
    db,
    "SELECT count(*) AS used FROM summary_admissions WHERE user_id = ? AND accepted_at >= ? AND accepted_at < ?",
    userId,
    day,
    day + 86_400,
  ).first<number>("used");
  return used !== null && used < limit;
}

export async function listAnalysisRequests(
  db: D1Database,
  userId: string,
  input: {
    limit: number;
    status?: RequestRow["status"];
    cursor?: { createdAt: number; id: string };
  },
) {
  const conditions = ["q.user_id = ?"];
  const values: (string | number)[] = [userId];
  if (input.status) {
    conditions.push("q.status = ?");
    values.push(input.status);
  }
  if (input.cursor) {
    conditions.push("(q.created_at, q.id) < (?, ?)");
    values.push(input.cursor.createdAt, input.cursor.id);
  }
  const rows = await statement(
    db,
    `${requestQuery} WHERE ${conditions.join(" AND ")}
    ORDER BY q.created_at DESC, q.id DESC LIMIT ?`,
    ...values,
    input.limit + 1,
  ).all<RequestRow>();
  const items = rows.results.slice(0, input.limit).map(requestState);
  const last = items.at(-1);
  return {
    items,
    cursor:
      rows.results.length > input.limit && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
  };
}

export async function getAnalysisRequest(
  db: D1Database,
  userId: string,
  id: string,
) {
  const row = await statement(
    db,
    `${requestQuery} WHERE q.id = ? AND q.user_id = ?`,
    id,
    userId,
  ).first<RequestRow>();
  if (!row) throw new JobError("NOT_FOUND");
  return requestState(row);
}

function requestState(row: RequestRow) {
  return {
    ...row,
    retryable:
      row.eligible === 1 &&
      row.status === "failed" &&
      row.jobStatus === "failed" &&
      row.attempt < MAX_ATTEMPTS &&
      (row.jobFailure === "temporary" ||
        row.jobFailure === "metadata_unavailable") &&
      row.failureCode === row.jobFailure,
  };
}

export async function retryAnalysis(
  db: D1Database,
  userId: string,
  id: string,
  attempt: number,
  now = unixNow(),
  admissionLimit?: number,
) {
  const request = await getAnalysisRequest(db, userId, id);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_ATTEMPTS)
    throw new JobError("RETRY_NOT_ALLOWED");
  if (
    request.status === "completed" ||
    request.attempt === attempt + 1 ||
    (request.attempt === attempt &&
      ["queued", "running"].includes(request.jobStatus))
  )
    return { ...request, accepted: false };
  if (request.attempt !== attempt || !request.retryable)
    throw new JobError("RETRY_NOT_ALLOWED");
  const limit = admissionLimit ?? null;
  const day = Math.floor(now / 86_400) * 86_400;
  const rows = await db.batch([
    statement(
      db,
      `UPDATE analysis_jobs SET status = 'queued', failure_code = NULL, updated_at = ?
      WHERE id = ? AND status = 'failed' AND failure_code IN ('temporary', 'metadata_unavailable')
      AND (SELECT max(attempt_number) FROM analysis_attempts WHERE analysis_job_id = ?) = ?
      AND NOT EXISTS (SELECT 1 FROM analysis_attempts WHERE analysis_job_id = ? AND status IN ('succeeded', 'ambiguous'))
      AND EXISTS (SELECT 1 FROM summary_requests q WHERE q.id = ? AND q.user_id = ? AND ${eligibleRequest})
      AND (? IS NULL OR (SELECT count(*) FROM summary_admissions WHERE user_id = ? AND accepted_at >= ? AND accepted_at < ?) < ?)`,
      now,
      request.analysisJobId,
      request.analysisJobId,
      attempt,
      request.analysisJobId,
      id,
      userId,
      limit,
      userId,
      day,
      day + 86_400,
      limit,
    ),
    statement(
      db,
      `INSERT INTO summary_admissions (analysis_job_id, attempt_number, user_id, accepted_at)
      SELECT ?, ?, ?, ? WHERE changes() = 1 AND ? IS NOT NULL`,
      request.analysisJobId,
      attempt + 1,
      userId,
      now,
      limit,
    ),
    statement(
      db,
      `UPDATE summary_requests AS q SET status = 'queued', failure_code = NULL, updated_at = ?
      WHERE analysis_job_id = ? AND status = 'failed' AND failure_code IN ('temporary', 'metadata_unavailable')
      AND ${eligibleRequest} AND EXISTS (SELECT 1 FROM analysis_jobs WHERE id = ? AND status = 'queued')`,
      now,
      request.analysisJobId,
      request.analysisJobId,
    ),
  ]);
  const current = await getAnalysisRequest(db, userId, id);
  if (
    rows[0]?.meta.changes === 0 &&
    current.status === "failed" &&
    current.attempt === attempt &&
    !current.retryable
  )
    throw new JobError("RETRY_NOT_ALLOWED");
  if (
    rows[0]?.meta.changes === 0 &&
    current.retryable &&
    current.attempt === attempt &&
    limit !== null
  )
    throw new JobError(
      limit === 0 ? "SUMMARY_UNAVAILABLE" : "USAGE_LIMIT_REACHED",
    );
  return { ...current, accepted: rows[0]?.meta.changes === 1 };
}
