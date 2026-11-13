import type {
  ChannelCheckClaim,
  ChannelCheckResultRow,
  ChannelCheckRow,
  ChannelCheckTargetRow,
  IdRow,
} from "../rows";
import { summaryConfigSchema } from "../summary";
import type { ChannelVideo } from "../youtube-videos";
import { DAILY_ADMISSION_LIMIT, enqueueAnalysis } from "./analysis";
import { checkLog, JobError, statement, unixNow } from "./shared";

// 확인 주기와 지금 확인의 최소 간격이에요.
export const MANUAL_CHECK_INTERVAL_SECONDS = 60;
// 실행 중 확인이 비정상 종료로 남았을 때 다음 확인이 이어받는 기준 시간이에요.
export const CHANNEL_CHECK_STALE_SECONDS = 900;
// 무료 Workers invocation의 subrequest 한도(50)를 넘지 않도록 한 확인에서 처리할 상한이에요.
// 채널마다 공식 조회 2회와 D1 읽기·쓰기가 붙고, 분석·발송 작업이 같은 invocation에서 함께 실행돼요.
export const MAX_CHANNELS_PER_CHECK = 2;
// 한 확인에서 새 분석으로 접수하는 영상 수예요. 나머지는 다음 확인에서 이어가요.
export const MAX_NEW_VIDEOS_PER_CHECK = 2;

const checkColumns = `id, status, manual, failure_code AS failureCode,
  continued_from_id AS continuedFromId, created_at AS createdAt, finished_at AS finishedAt`;
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
      `SELECT id, user_id AS userId, manual, lease_token AS token,
        coalesce(continued_from_id, id) AS rootCheckId FROM channel_checks
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
  // 오래 확인하지 않은 구독부터 처리하고, 같은 지금 확인 묶음에서 이미 시도한 구독은 다시 보지 않아요.
  const rows = await statement(
    db,
    `${checkedTarget}
    WHERE s.user_id = ? AND ${activeForAutomation} ${due}
    AND NOT EXISTS (
      SELECT 1 FROM channel_check_results r JOIN channel_checks c ON c.id = r.check_id
      WHERE r.subscription_id = s.id AND (c.id = ? OR c.continued_from_id = ?))
    ORDER BY coalesce(s.last_checked_at, 0), s.created_at, s.id LIMIT ?`,
    claim.userId,
    ...(claim.manual ? [] : [now]),
    claim.rootCheckId,
    claim.rootCheckId,
    MAX_CHANNELS_PER_CHECK,
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
  // 진행 중인 지금 확인은 같은 작업을 돌려줘요. 예약 확인은 기한 된 구독만 보므로 그대로 재사용하지 않아요.
  const manual = await statement(
    db,
    `SELECT ${checkColumns} FROM channel_checks WHERE user_id = ? AND manual = 1 AND status IN ('queued', 'running') ORDER BY created_at, id LIMIT 1`,
    userId,
  ).first<ChannelCheckRow>();
  if (manual) return { status: "existing", check: manual };
  const ready = await statement(
    db,
    `SELECT s.id FROM channel_subscriptions s WHERE s.user_id = ? AND ${activeForAutomation} LIMIT 1`,
    userId,
  ).first<IdRow>();
  if (!ready) return { status: "not_ready" };
  // 60초 간격은 사용자가 누른 지금 확인에만 적용해요. 예약 확인은 사용자 요청이 아니에요.
  const latest = await statement(
    db,
    "SELECT created_at AS createdAt FROM channel_checks WHERE user_id = ? AND manual = 1 ORDER BY created_at DESC, id DESC LIMIT 1",
    userId,
  ).first<{ createdAt: number }>();
  if (latest && latest.createdAt > now - MANUAL_CHECK_INTERVAL_SECONDS)
    return {
      status: "rate_limited",
      retryAfter: latest.createdAt + MANUAL_CHECK_INTERVAL_SECONDS - now,
    };
  const id = crypto.randomUUID();
  const rows = await db.batch([
    // 아직 시작하지 않은 예약 확인은 결과가 없어 지금 확인으로 바꿔도 돼요.
    statement(
      db,
      "DELETE FROM channel_checks WHERE user_id = ? AND status = 'queued' AND manual = 0",
      userId,
    ),
    statement(
      db,
      `INSERT INTO channel_checks (id, user_id, manual, created_at)
      SELECT ?, ?, 1, ?
      WHERE NOT EXISTS (SELECT 1 FROM channel_checks WHERE user_id = ? AND status = 'queued')`,
      id,
      userId,
      now,
      userId,
    ),
    statement(
      db,
      `SELECT ${checkColumns} FROM channel_checks WHERE user_id = ? AND manual = 1 AND status IN ('queued', 'running') ORDER BY created_at, id LIMIT 1`,
      userId,
    ),
  ]);
  const check = rows[2]?.results[0] as ChannelCheckRow | undefined;
  if (check)
    return {
      status: rows[1]?.meta.changes === 1 ? "created" : "existing",
      check,
    };
  // 예약 확인 생성과 겹친 드문 경우에는 이미 대기 중인 확인을 돌려줘요.
  const active = await statement(
    db,
    `SELECT ${checkColumns} FROM channel_checks WHERE user_id = ? AND status IN ('queued', 'running') ORDER BY created_at, id LIMIT 1`,
    userId,
  ).first<ChannelCheckRow>();
  return active
    ? { status: "existing", check: active }
    : { status: "not_ready" };
}

// 지금 확인 묶음에서 다음에 실행할 작업이 있으면 앱이 이어서 조회할 수 있게 알려줘요.
export async function getNextCheckId(
  db: D1Database,
  userId: string,
  check: ChannelCheckRow,
) {
  const root = check.continuedFromId ?? check.id;
  return statement(
    db,
    `SELECT id FROM channel_checks
    WHERE user_id = ? AND id != ? AND status IN ('queued', 'running')
    AND coalesce(continued_from_id, id) = ? ORDER BY created_at, id LIMIT 1`,
    userId,
    check.id,
    root,
  ).first<string>("id");
}

// 구독이 한 확인의 상한보다 많으면 남은 활성 구독을 위한 지금 확인을 대기시켜요.
export async function queueFollowUpCheck(
  db: D1Database,
  claim: ChannelCheckClaim,
  now = unixNow(),
) {
  const result = await statement(
    db,
    `INSERT INTO channel_checks (id, user_id, manual, continued_from_id, created_at)
    SELECT ?, ?, 1, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM channel_checks WHERE user_id = ? AND status = 'queued')
    AND EXISTS (
      SELECT 1 FROM channel_subscriptions s
      WHERE s.user_id = ? AND s.status = 'active'
      AND EXISTS (SELECT 1 FROM recipients r WHERE r.user_id = s.user_id AND r.verified_at IS NOT NULL AND r.deleted_at IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM channel_check_results r JOIN channel_checks c ON c.id = r.check_id
        WHERE r.subscription_id = s.id AND (c.id = ? OR c.continued_from_id = ?)))`,
    crypto.randomUUID(),
    claim.userId,
    claim.rootCheckId,
    now,
    claim.userId,
    claim.userId,
    claim.rootCheckId,
    claim.rootCheckId,
  ).run();
  return result.meta.changes === 1;
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
// 한 확인에서 접수하는 수를 제한해 무료 Workers 요청 한도와 Gemini 사용량을 함께 지켜요.
export async function storeNewVideos(
  db: D1Database,
  claim: ChannelCheckClaim,
  target: ChannelCheckTargetRow,
  videos: ChannelVideo[],
  model: string,
  budget: number,
  now = unixNow(),
) {
  if (budget <= 0) return 0;
  if (!(await automationActive(db, claim, target.id, "initialized")))
    return budget;
  // 관측만 저장되고 요청 접수 전에 중단된 영상은 다음 확인에서 이어서 접수해요.
  const pending = await statement(
    db,
    `SELECT o.video_id AS videoId FROM subscription_videos o
    WHERE o.subscription_id = ? AND o.is_baseline = 0
    AND NOT EXISTS (
      SELECT 1 FROM summary_requests q JOIN analysis_jobs j ON j.id = q.analysis_job_id
      WHERE q.user_id = ? AND j.video_id = o.video_id)
    ORDER BY o.discovered_at, o.video_id LIMIT ?`,
    target.id,
    claim.userId,
    budget,
  ).all<{ videoId: string }>();
  const observed = await statement(
    db,
    "SELECT video_id AS videoId FROM subscription_videos WHERE subscription_id = ?",
    target.id,
  ).all<{ videoId: string }>();
  const known = new Set(observed.results.map((row) => row.videoId));
  // 이번 확인의 접수 예산만큼만 새로 관측해, 나머지는 다음 확인에서 다시 봐요.
  // 대기 중인 관측을 먼저 접수하므로 새 관측은 남은 예산만큼만 저장해요.
  const fresh = videos
    .filter((video) => !known.has(video.videoId))
    .slice(0, Math.max(0, budget - pending.results.length));
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
  let remaining = budget;
  let exhausted = false;
  const admit = async (
    videoId: string,
    freshObservation: boolean,
  ): Promise<"admitted" | "deferred" | "usage"> => {
    try {
      await enqueueAnalysis(
        db,
        {
          userId: claim.userId,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          model,
          subscriptionId: target.id,
          admissionLimit: DAILY_ADMISSION_LIMIT,
        },
        now,
      );
      return "admitted";
    } catch (error) {
      // 조건이 바뀌었거나 오늘 접수 한도를 다 쓴 관측은 다음 확인에서 다시 시도해요.
      if (error instanceof JobError && error.code === "INELIGIBLE")
        return "deferred";
      if (error instanceof JobError && error.code === "USAGE_LIMIT_REACHED")
        return "usage";
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
  for (const videoId of pendingIds) {
    if (remaining <= 0 || exhausted) break;
    const outcome = await admit(videoId, false);
    if (outcome === "admitted") remaining--;
    else if (outcome === "usage") exhausted = true;
    else break;
  }
  for (const videoId of freshIds) {
    if (remaining <= 0 || exhausted) break;
    const outcome = await admit(videoId, true);
    if (outcome === "admitted") remaining--;
    else if (outcome === "usage") exhausted = true;
    else break;
  }
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
  if (applied.meta.changes !== 1) return exhausted ? 0 : remaining;
  await recordCheckCompleted(db, claim, target.id, now);
  checkLog(claim.id, "channel_completed");
  return exhausted ? 0 : remaining;
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
