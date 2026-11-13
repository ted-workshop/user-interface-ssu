import type {
  ChannelCheckClaim,
  ChannelCheckResultRow,
  ChannelCheckRow,
  ChannelCheckTargetRow,
  IdRow,
} from "../rows";
import { summaryConfigSchema } from "../summary";
import type { ChannelVideo } from "../youtube-videos";
import { enqueueAnalysis } from "./analysis";
import { checkLog, JobError, statement, unixNow } from "./shared";

// 확인 주기와 지금 확인의 최소 간격이에요.
export const MANUAL_CHECK_INTERVAL_SECONDS = 60;
// 실행 중 확인이 비정상 종료로 남았을 때 다음 확인이 이어받는 기준 시간이에요.
export const CHANNEL_CHECK_STALE_SECONDS = 900;

const checkColumns = `id, status, manual, failure_code AS failureCode,
  created_at AS createdAt, finished_at AS finishedAt`;
const intervalSql =
  "60 * coalesce((SELECT check_interval_minutes FROM user_settings WHERE user_id = ?), 360)";
// 자동화는 활성 구독과 확인된 살아 있는 수신 주소가 모두 있을 때만 실행해요.
const activeForAutomation = `s.status = 'active'
  AND EXISTS (SELECT 1 FROM recipients r WHERE r.user_id = s.user_id AND r.verified_at IS NOT NULL AND r.deleted_at IS NULL)`;
const targetColumns = `s.id, c.id AS channelId, c.youtube_channel_id AS youtubeChannelId,
  s.baseline_initialized_at AS baselineInitializedAt, s.last_checked_at AS lastCheckedAt,
  s.next_check_at AS nextCheckAt`;
const checkedTarget = `SELECT ${targetColumns}
  FROM channel_subscriptions s JOIN channels c ON c.id = s.channel_id`;

// 확인 실행에 필요한 서버 설정이 준비됐는지 확인해요. 준비되지 않으면 접수·예약을 만들지 않아요.
export function automationConfigured(env: Env) {
  return (
    Boolean(env.YOUTUBE_API_KEY?.trim()) &&
    summaryConfigSchema.safeParse({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
    }).success
  );
}

// 확인할 때가 된 첫 계정의 확인 작업을 만들어요. 확인은 한 번에 하나만 실행해요.
export async function scheduleDueCheck(db: D1Database, now = unixNow()) {
  const id = crypto.randomUUID();
  const result = await statement(
    db,
    `INSERT INTO channel_checks (id, user_id, created_at)
    SELECT ?, s.user_id, ? FROM channel_subscriptions s
    WHERE ${activeForAutomation}
    AND (s.next_check_at IS NULL OR s.next_check_at <= ?)
    AND NOT EXISTS (SELECT 1 FROM channel_checks c WHERE c.user_id = s.user_id AND c.status IN ('queued', 'running'))
    ORDER BY coalesce(s.next_check_at, 0), s.created_at, s.id LIMIT 1`,
    id,
    now,
    now,
  ).run();
  return result.meta.changes === 1 ? id : null;
}

// 지난 실행 중 확인은 실패로 끝내고 다음 예약 확인이 남은 구독을 이어가요.
export async function claimChannelCheck(
  db: D1Database,
  now = unixNow(),
): Promise<ChannelCheckClaim | null> {
  const token = crypto.randomUUID();
  const rows = await db.batch([
    statement(
      db,
      `UPDATE channel_checks SET status = 'failed', failure_code = 'interrupted', finished_at = ?, lease_token = NULL
      WHERE status = 'running' AND started_at <= ?`,
      now,
      now - CHANNEL_CHECK_STALE_SECONDS,
    ),
    statement(
      db,
      `UPDATE channel_checks SET status = 'running', lease_token = ?, started_at = ?
      WHERE id = (SELECT id FROM channel_checks WHERE status = 'queued'
        AND NOT EXISTS (SELECT 1 FROM channel_checks WHERE status = 'running')
        ORDER BY created_at, id LIMIT 1) AND status = 'queued'`,
      token,
      now,
    ),
    statement(
      db,
      `SELECT id, user_id AS userId, manual, lease_token AS token FROM channel_checks
      WHERE lease_token = ? AND status = 'running'`,
      token,
    ),
  ]);
  const claim = rows[2]?.results[0] as ChannelCheckClaim | undefined;
  if (claim) checkLog(claim.id, "claimed");
  return claim ?? null;
}

// 예약 확인은 확인할 때가 된 구독만, 지금 확인은 활성 구독 전체를 봐요.
export async function listCheckTargets(
  db: D1Database,
  claim: ChannelCheckClaim,
  now = unixNow(),
) {
  const due = claim.manual
    ? ""
    : "AND (s.next_check_at IS NULL OR s.next_check_at <= ?)";
  const rows = await statement(
    db,
    `${checkedTarget}
    WHERE s.user_id = ? AND ${activeForAutomation} ${due}
    ORDER BY s.created_at, s.id`,
    claim.userId,
    ...(claim.manual ? [] : [now]),
  ).all<ChannelCheckTargetRow>();
  return rows.results;
}

// 실행 직전에 중지·삭제·주소 삭제·주기 변경을 다시 확인해요.
export async function getCheckTarget(
  db: D1Database,
  claim: ChannelCheckClaim,
  subscriptionId: string,
  now = unixNow(),
) {
  const due = claim.manual
    ? ""
    : "AND (s.next_check_at IS NULL OR s.next_check_at <= ?)";
  return statement(
    db,
    `${checkedTarget}
    WHERE s.id = ? AND s.user_id = ? AND ${activeForAutomation} ${due}`,
    subscriptionId,
    claim.userId,
    ...(claim.manual ? [] : [now]),
  ).first<ChannelCheckTargetRow>();
}

export async function getChannelCheck(
  db: D1Database,
  userId: string,
  id: string,
) {
  return statement(
    db,
    `SELECT ${checkColumns} FROM channel_checks WHERE id = ? AND user_id = ?`,
    id,
    userId,
  ).first<ChannelCheckRow>();
}

export async function listCheckResults(db: D1Database, checkId: string) {
  const rows = await statement(
    db,
    `SELECT r.subscription_id AS subscriptionId, ch.title, r.status,
      r.failure_code AS failureCode, r.last_checked_at AS lastCheckedAt
    FROM channel_check_results r
    JOIN channel_subscriptions s ON s.id = r.subscription_id
    JOIN channels ch ON ch.id = s.channel_id
    WHERE r.check_id = ? ORDER BY ch.title, r.subscription_id`,
    checkId,
  ).all<ChannelCheckResultRow>();
  return rows.results;
}

export type ManualCheckResult =
  | { status: "created" | "existing"; check: ChannelCheckRow }
  | { status: "not_ready" }
  | { status: "rate_limited"; retryAfter: number };

export async function createManualCheck(
  db: D1Database,
  userId: string,
  now = unixNow(),
): Promise<ManualCheckResult> {
  const active = await statement(
    db,
    `SELECT ${checkColumns} FROM channel_checks WHERE user_id = ? AND status IN ('queued', 'running') LIMIT 1`,
    userId,
  ).first<ChannelCheckRow>();
  if (active) return { status: "existing", check: active };
  const ready = await statement(
    db,
    `SELECT s.id FROM channel_subscriptions s WHERE s.user_id = ? AND ${activeForAutomation} LIMIT 1`,
    userId,
  ).first<IdRow>();
  if (!ready) return { status: "not_ready" };
  const latest = await statement(
    db,
    "SELECT created_at AS createdAt FROM channel_checks WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    userId,
  ).first<{ createdAt: number }>();
  if (latest && latest.createdAt > now - MANUAL_CHECK_INTERVAL_SECONDS)
    return {
      status: "rate_limited",
      retryAfter: latest.createdAt + MANUAL_CHECK_INTERVAL_SECONDS - now,
    };
  const id = crypto.randomUUID();
  const rows = await db.batch([
    statement(
      db,
      `INSERT INTO channel_checks (id, user_id, manual, created_at)
      SELECT ?, ?, 1, ?
      WHERE NOT EXISTS (SELECT 1 FROM channel_checks WHERE user_id = ? AND status IN ('queued', 'running'))`,
      id,
      userId,
      now,
      userId,
    ),
    statement(
      db,
      `SELECT ${checkColumns} FROM channel_checks WHERE user_id = ? AND status IN ('queued', 'running')`,
      userId,
    ),
  ]);
  const check = rows[1]?.results[0] as ChannelCheckRow | undefined;
  if (!check) return { status: "not_ready" };
  return {
    status: rows[0]?.meta.changes === 1 ? "created" : "existing",
    check,
  };
}

// 실행 직전 조건이 유지되는지 확인해요. 관측·접수 시점에도 같은 조건을 다시 봐요.
async function automationActive(
  db: D1Database,
  claim: ChannelCheckClaim,
  subscriptionId: string,
  baseline: "pending" | "initialized",
) {
  return statement(
    db,
    `SELECT 1 AS found FROM channel_subscriptions s
    WHERE s.id = ? AND s.user_id = ? AND s.status = 'active'
    AND s.baseline_initialized_at IS ${baseline === "pending" ? "NULL" : "NOT NULL"}
    AND EXISTS (SELECT 1 FROM recipients r WHERE r.user_id = s.user_id AND r.verified_at IS NOT NULL AND r.deleted_at IS NULL)`,
    subscriptionId,
    claim.userId,
  ).first<IdRow>();
}

// 첫 성공 확인은 현재 영상 목록 전체를 기준으로 저장하고 분석을 시작하지 않아요.
export async function storeBaseline(
  db: D1Database,
  claim: ChannelCheckClaim,
  target: ChannelCheckTargetRow,
  videos: ChannelVideo[],
  now = unixNow(),
) {
  if (!(await automationActive(db, claim, target.id, "pending"))) return;
  await runChunks(
    db,
    videos.map((video) => videoStatement(db, target, video, now)),
  );
  await runChunks(
    db,
    videos.map((video) =>
      observationStatement(db, claim, target, video, true, now),
    ),
  );
  const applied = await statement(
    db,
    `UPDATE channel_subscriptions SET baseline_initialized_at = ?, last_checked_at = ?,
    next_check_at = ? + ${intervalSql}
    WHERE id = ? AND user_id = ? AND status = 'active' AND baseline_initialized_at IS NULL
    AND EXISTS (SELECT 1 FROM recipients r WHERE r.user_id = channel_subscriptions.user_id AND r.verified_at IS NOT NULL AND r.deleted_at IS NULL)
    AND EXISTS (SELECT 1 FROM channel_checks c WHERE c.id = ? AND c.status = 'running' AND c.lease_token = ?)`,
    now,
    now,
    now,
    claim.userId,
    target.id,
    claim.userId,
    claim.id,
    claim.token,
  ).run();
  if (applied.meta.changes !== 1) return;
  await recordCheckCompleted(db, claim, target.id, now);
  checkLog(claim.id, "channel_completed");
}

// 두 번째 확인부터는 처음 본 영상과 접수 전에 중단된 관측만 기존 분석 흐름에 연결해요.
export async function storeNewVideos(
  db: D1Database,
  claim: ChannelCheckClaim,
  target: ChannelCheckTargetRow,
  videos: ChannelVideo[],
  model: string,
  now = unixNow(),
) {
  if (!(await automationActive(db, claim, target.id, "initialized"))) return;
  // 관측만 저장되고 요청 접수 전에 중단된 영상은 다음 확인에서 이어서 접수해요.
  const pending = await statement(
    db,
    `SELECT o.video_id AS videoId FROM subscription_videos o
    WHERE o.subscription_id = ? AND o.is_baseline = 0
    AND NOT EXISTS (
      SELECT 1 FROM summary_requests q JOIN analysis_jobs j ON j.id = q.analysis_job_id
      WHERE q.user_id = ? AND j.video_id = o.video_id)
    ORDER BY o.discovered_at, o.video_id`,
    target.id,
    claim.userId,
  ).all<{ videoId: string }>();
  const observed = await statement(
    db,
    "SELECT video_id AS videoId FROM subscription_videos WHERE subscription_id = ?",
    target.id,
  ).all<{ videoId: string }>();
  const known = new Set(observed.results.map((row) => row.videoId));
  const fresh = videos.filter((video) => !known.has(video.videoId));
  if (fresh.length) {
    await runChunks(
      db,
      fresh.map((video) => videoStatement(db, target, video, now)),
    );
  }
  const pendingIds = pending.results.map((row) => row.videoId);
  const freshIds: string[] = [];
  for (const video of fresh) {
    // 채널 요청은 관측 기록과 활성 구독·수신 주소가 있어야 접수할 수 있어요(스키마 트리거).
    const observedRow = await observationStatement(
      db,
      claim,
      target,
      video,
      false,
      now,
    ).run();
    if (observedRow.meta.changes !== 1) continue;
    freshIds.push(video.videoId);
  }
  const admit = async (videoId: string, freshObservation: boolean) => {
    try {
      await enqueueAnalysis(
        db,
        {
          userId: claim.userId,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          model,
          subscriptionId: target.id,
        },
        now,
      );
    } catch (error) {
      // 확인 중 조건이 바뀌어 접수하지 못한 관측은 다음 확인에서 다시 시도해요.
      if (error instanceof JobError && error.code === "INELIGIBLE") return;
      // 접수 전에 중단된 관측은 다음 확인에서 이어가고, 저장 실패로 끝난 이번 관측은 되돌려요.
      if (freshObservation)
        await statement(
          db,
          "DELETE FROM subscription_videos WHERE subscription_id = ? AND video_id = ? AND is_baseline = 0",
          target.id,
          videoId,
        ).run();
      throw error;
    }
  };
  for (const videoId of pendingIds) await admit(videoId, false);
  for (const videoId of freshIds) await admit(videoId, true);
  const applied = await statement(
    db,
    `UPDATE channel_subscriptions SET last_checked_at = ?, next_check_at = ? + ${intervalSql}
    WHERE id = ? AND user_id = ? AND status = 'active' AND baseline_initialized_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM recipients r WHERE r.user_id = channel_subscriptions.user_id AND r.verified_at IS NOT NULL AND r.deleted_at IS NULL)
    AND EXISTS (SELECT 1 FROM channel_checks c WHERE c.id = ? AND c.status = 'running' AND c.lease_token = ?)`,
    now,
    now,
    claim.userId,
    target.id,
    claim.userId,
    claim.id,
    claim.token,
  ).run();
  if (applied.meta.changes !== 1) return;
  await recordCheckCompleted(db, claim, target.id, now);
  checkLog(claim.id, "channel_completed");
}

// 공급자 실패와 저장 실패는 마지막 성공 시각을 유지하고 다음 주기로 미뤄요. 첫 확인이면 기준은 계속 비어 있어요.
export async function recordCheckFailure(
  db: D1Database,
  claim: ChannelCheckClaim,
  subscriptionId: string,
  failureCode:
    | "provider_unavailable"
    | "invalid_response"
    | "processing_failed",
  now = unixNow(),
) {
  const rows = await db.batch([
    statement(
      db,
      `UPDATE channel_subscriptions SET next_check_at = ? + ${intervalSql}
      WHERE id = ? AND user_id = ? AND status = 'active'
      AND EXISTS (SELECT 1 FROM channel_checks c WHERE c.id = ? AND c.status = 'running' AND c.lease_token = ?)`,
      now,
      claim.userId,
      subscriptionId,
      claim.userId,
      claim.id,
      claim.token,
    ),
    statement(
      db,
      `INSERT INTO channel_check_results (check_id, subscription_id, status, failure_code, last_checked_at)
      SELECT ?, s.id, 'failed', ?, s.last_checked_at FROM channel_subscriptions s
      WHERE s.id = ? AND s.user_id = ? AND s.status = 'active'
      AND EXISTS (SELECT 1 FROM channel_checks c WHERE c.id = ? AND c.status = 'running' AND c.lease_token = ?)
      ON CONFLICT DO NOTHING`,
      claim.id,
      failureCode,
      subscriptionId,
      claim.userId,
      claim.id,
      claim.token,
    ),
  ]);
  if (rows[0]?.meta.changes === 1)
    checkLog(claim.id, "channel_failed", failureCode);
}

async function recordCheckCompleted(
  db: D1Database,
  claim: ChannelCheckClaim,
  subscriptionId: string,
  now: number,
) {
  await statement(
    db,
    `INSERT INTO channel_check_results (check_id, subscription_id, status, failure_code, last_checked_at)
    SELECT ?, s.id, 'completed', NULL, ? FROM channel_subscriptions s
    WHERE s.id = ? AND s.user_id = ? AND s.status = 'active'
    AND EXISTS (SELECT 1 FROM channel_checks c WHERE c.id = ? AND c.status = 'running' AND c.lease_token = ?)
    ON CONFLICT DO NOTHING`,
    claim.id,
    now,
    subscriptionId,
    claim.userId,
    claim.id,
    claim.token,
  ).run();
}

export async function completeChannelCheck(
  db: D1Database,
  claim: ChannelCheckClaim,
  now = unixNow(),
) {
  const result = await statement(
    db,
    `UPDATE channel_checks SET status = 'completed', finished_at = ?
    WHERE id = ? AND status = 'running' AND lease_token = ?`,
    now,
    claim.id,
    claim.token,
  ).run();
  if (result.meta.changes === 1) checkLog(claim.id, "completed");
}

export async function failChannelCheck(
  db: D1Database,
  claim: ChannelCheckClaim,
  failureCode: "configuration" | "interrupted",
  now = unixNow(),
) {
  const result = await statement(
    db,
    `UPDATE channel_checks SET status = 'failed', failure_code = ?, finished_at = ?, lease_token = NULL
    WHERE id = ? AND status = 'running' AND lease_token = ?`,
    failureCode,
    now,
    claim.id,
    claim.token,
  ).run();
  if (result.meta.changes === 1) checkLog(claim.id, "failed", failureCode);
}

// 공통 채널 영상 행을 만들고, 직접 요약으로 먼저 생긴 행은 채널 출처만 채워요.
function videoStatement(
  db: D1Database,
  target: ChannelCheckTargetRow,
  video: ChannelVideo,
  now: number,
) {
  return statement(
    db,
    `INSERT INTO videos (id, channel_id, title, published_at, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET channel_id = coalesce(videos.channel_id, excluded.channel_id),
      title = coalesce(videos.title, excluded.title), published_at = coalesce(videos.published_at, excluded.published_at)`,
    video.videoId,
    target.channelId,
    video.title,
    video.publishedAt,
    now,
  );
}

// 확인 중 중지·삭제된 구독이나 삭제된 마지막 수신 주소에는 관측 기록을 추가하지 않아요.
function observationStatement(
  db: D1Database,
  claim: ChannelCheckClaim,
  target: ChannelCheckTargetRow,
  video: ChannelVideo,
  baseline: boolean,
  now: number,
) {
  return statement(
    db,
    `INSERT INTO subscription_videos (subscription_id, video_id, is_baseline, discovered_at)
    SELECT ?, ?, ?, ? WHERE EXISTS (
      SELECT 1 FROM channel_subscriptions s WHERE s.id = ? AND s.user_id = ? AND s.status = 'active'
      AND s.baseline_initialized_at IS ${baseline ? "NULL" : "NOT NULL"}
      AND EXISTS (SELECT 1 FROM recipients r WHERE r.user_id = s.user_id AND r.verified_at IS NOT NULL AND r.deleted_at IS NULL))
    ON CONFLICT DO NOTHING`,
    target.id,
    video.videoId,
    baseline ? 1 : 0,
    now,
    target.id,
    claim.userId,
  );
}

// D1 batch 하나에 너무 많은 문장을 넣지 않도록 나눠요. 기준·관측 기록은 다시 실행해도 같아요.
async function runChunks(db: D1Database, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 40)
    await db.batch(statements.slice(index, index + 40));
}
