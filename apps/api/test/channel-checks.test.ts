import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createApp } from "../src/app";
import { sha256Hex } from "../src/auth";
import { claimChannelCheck } from "../src/jobs/channels";
import { type JobProviders, runBackgroundJobs } from "../src/jobs/runner";
import type { ChannelCheckTargetRow } from "../src/rows";
import type { getVideoMetadata } from "../src/summary";
import {
  ChannelFetchError,
  type ChannelVideo,
  type fetchChannelVideos,
} from "../src/youtube-videos";

const now = 1_800_000_000;
const interval = 360 * 60;
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const token = "a".repeat(43);
const otherToken = "b".repeat(43);
const youtubeId = `UC${"a".repeat(22)}`;
const youtubeId2 = `UC${"b".repeat(22)}`;
const channel = "channel";
let clock = now;
const settings = { ...env, GEMINI_MODEL: "gemini-3.6-flash" };
const app = createApp();
const sql = (query: string, ...values: (string | number | null)[]) =>
  env.DB.prepare(query).bind(...values);
const iso = (time: number) => new Date(time * 1000).toISOString();
const video = (videoId: string, title = "새 영상"): ChannelVideo => ({
  videoId,
  title,
  publishedAt: now - 3_600,
});

function call(method: string, path: string, body?: unknown, secret = token) {
  return app.request(
    `/v1${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${secret}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    settings,
  );
}

function providers(
  list:
    | ChannelVideo[]
    | ((youtubeChannelId: string) => Promise<ChannelVideo[]>),
) {
  return {
    now: () => clock,
    metadata: vi.fn(async (url: string) => ({
      videoId: new URL(url).searchParams.get("v") ?? "",
      url,
      title: "검사 영상",
      channel: "검사 채널",
      channelUrl: `https://www.youtube.com/channel/${youtubeId}`,
      metadataSource: "https://www.youtube.com/oembed",
    })) as unknown as typeof getVideoMetadata,
    generate: vi.fn(async () => ({
      markdown: "검사 보고서",
      model: settings.GEMINI_MODEL,
      interactionId: "fixture",
      generationMs: 1,
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        thoughtTokens: null,
        toolUseTokens: null,
        cachedTokens: null,
      },
      timestampVerification: "unverified" as const,
    })),
    listVideos: vi.fn(async (_env: Env, youtubeChannelId: string) =>
      typeof list === "function" ? list(youtubeChannelId) : list,
    ) as unknown as typeof fetchChannelVideos,
    send: vi.fn(async () => ({
      status: "accepted" as const,
      messageId: "fixture",
    })),
  } satisfies JobProviders;
}

async function count(table: string) {
  return (
    (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<number>(
      "n",
    )) ?? 0
  );
}

async function seedAutomation(
  options: { status?: "active" | "paused"; recipient?: boolean } = {},
) {
  const statements = [
    sql(
      "INSERT INTO channels (id, youtube_channel_id, title, url) VALUES (?, ?, '검사 채널', ?)",
      channel,
      youtubeId,
      `https://www.youtube.com/channel/${youtubeId}`,
    ),
    sql(
      "INSERT INTO channel_subscriptions (id, user_id, channel_id, status) VALUES ('sub', ?, ?, ?)",
      owner,
      channel,
      options.status ?? "active",
    ),
  ];
  if (options.recipient !== false)
    statements.push(
      sql(
        "INSERT INTO recipients (id, user_id, email, verified_at) VALUES ('mail', ?, 'inbox@example.com', ?)",
        owner,
        now - 1,
      ),
    );
  await env.DB.batch(statements);
}

function subscriptionRow() {
  return sql(
    "SELECT baseline_initialized_at AS baselineInitializedAt, last_checked_at AS lastCheckedAt, next_check_at AS nextCheckAt, status FROM channel_subscriptions WHERE id = 'sub'",
  ).first<ChannelCheckTargetRow & { status: string }>();
}

async function latestCheck() {
  return sql(
    "SELECT id, status, failure_code AS failureCode, manual FROM channel_checks ORDER BY created_at DESC, id DESC LIMIT 1",
  ).first<{
    id: string;
    status: string;
    failureCode: string | null;
    manual: number;
  }>();
}

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  clock = now;
  vi.spyOn(Date, "now").mockImplementation(() => clock * 1000);
  for (const table of [
    "channel_check_results",
    "channel_checks",
    "auth_mail_outbox",
    "auth_rate_limits",
    "delivery_attempts",
    "deliveries",
    "comments",
    "report_permissions",
    "reports",
    "analysis_attempts",
    "summary_admissions",
    "summary_requests",
    "analysis_jobs",
    "subscription_videos",
    "videos",
    "channel_subscriptions",
    "channels",
    "account_tokens",
    "recipients",
    "user_settings",
    "sessions",
    "users",
  ])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  for (const [id, secret] of [
    [owner, token],
    [other, otherToken],
  ] as const) {
    await env.DB.batch([
      sql(
        "INSERT INTO users (id,email,nickname,password_hash,email_verified_at) VALUES (?,?,'독자','fixture',?)",
        id,
        `${id}@example.com`,
        now - 1,
      ),
      sql(
        "INSERT INTO sessions (id,user_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?)",
        crypto.randomUUID(),
        id,
        await sha256Hex(secret),
        now - 1,
        now + 200_000,
      ),
    ]);
  }
});

test("활성 채널과 확인된 수신 주소가 모두 있어야 지금 확인을 접수해요", async () => {
  const missing = await call("POST", "/channel-checks", {});
  expect(missing.status).toBe(409);
  expect(await missing.json()).toEqual({
    error: { code: "AUTOMATION_NOT_READY" },
  });
  await seedAutomation({ status: "paused" });
  expect((await call("POST", "/channel-checks", {})).status).toBe(409);
  await sql("UPDATE channel_subscriptions SET status = 'active'").run();
  await sql("DELETE FROM recipients").run();
  expect((await call("POST", "/channel-checks", {})).status).toBe(409);
});

test("지금 확인은 60초 간격을 지키고 진행 중인 확인을 재사용해요", async () => {
  await seedAutomation();
  const created = await call("POST", "/channel-checks", {});
  expect(created.status).toBe(202);
  const queued = await created.json<{ id: string }>();
  expect(queued).toEqual({
    id: queued.id,
    status: "queued",
    failureCode: null,
    createdAt: iso(now),
    finishedAt: null,
    channels: [],
  });
  expect(created.headers.get("location")).toBe(
    `/v1/channel-checks/${queued.id}`,
  );
  const reused = await call("POST", "/channel-checks", {});
  expect(reused.status).toBe(200);
  expect(await reused.json()).toMatchObject({
    id: queued.id,
    status: "queued",
  });

  await runBackgroundJobs(settings, providers([]));
  expect(
    await (await call("GET", `/channel-checks/${queued.id}`)).json(),
  ).toEqual({
    id: queued.id,
    status: "completed",
    failureCode: null,
    createdAt: iso(now),
    finishedAt: iso(now),
    channels: [
      {
        subscriptionId: "sub",
        title: "검사 채널",
        status: "completed",
        failureCode: null,
        lastCheckedAt: iso(now),
      },
    ],
  });

  const limited = await call("POST", "/channel-checks", {});
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("60");
  expect(await limited.json()).toEqual({ error: { code: "RATE_LIMITED" } });
  clock += 60;
  expect((await call("POST", "/channel-checks", {})).status).toBe(202);
});

test("지금 확인은 빈 본문을 받고 잘못된 본문·설정에는 오류를 돌려줘요", async () => {
  await seedAutomation();
  expect((await call("POST", "/channel-checks", { extra: 1 })).status).toBe(
    400,
  );
  expect(await (await call("POST", "/channel-checks", [])).json()).toEqual({
    error: { code: "INVALID_INPUT" },
  });
  const unavailable = await app.request(
    "/v1/channel-checks",
    { method: "POST", headers: { authorization: `Bearer ${token}` } },
    { ...settings, YOUTUBE_API_KEY: "" },
  );
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toEqual({
    error: { code: "AUTOMATION_UNAVAILABLE" },
  });
  // 본문을 보내지 않아도 빈 확인 요청으로 접수해요.
  expect((await call("POST", "/channel-checks")).status).toBe(202);
});

test("첫 성공 확인은 현재 영상을 기준으로만 저장하고 분석하지 않아요", async () => {
  await seedAutomation();
  const io = providers([video("aaaaaaaaaaa"), video("bbbbbbbbbbb")]);
  await runBackgroundJobs(settings, io);
  expect(io.listVideos).toHaveBeenCalledTimes(1);
  expect(await count("summary_requests")).toBe(0);
  expect(
    (
      await sql(
        "SELECT is_baseline FROM subscription_videos ORDER BY video_id",
      ).all()
    ).results,
  ).toEqual([{ is_baseline: 1 }, { is_baseline: 1 }]);
  expect(await subscriptionRow()).toMatchObject({
    baselineInitializedAt: now,
    lastCheckedAt: now,
    nextCheckAt: now + interval,
  });
  expect((await sql("SELECT channel_id FROM videos").all()).results).toEqual([
    { channel_id: channel },
    { channel_id: channel },
  ]);
});

test("빈 채널도 기준을 기록하고 첫 업로드는 다음 확인에서 처리해요", async () => {
  await seedAutomation();
  await runBackgroundJobs(settings, providers([]));
  expect(await subscriptionRow()).toMatchObject({ baselineInitializedAt: now });
  expect(await count("subscription_videos")).toBe(0);

  clock += 60;
  expect((await call("POST", "/channel-checks", {})).status).toBe(202);
  await runBackgroundJobs(settings, providers([video("aaaaaaaaaaa")]));
  expect(
    (await sql("SELECT origin, subscription_id FROM summary_requests").all())
      .results,
  ).toEqual([{ origin: "channel", subscription_id: "sub" }]);
  expect(
    (await sql("SELECT is_baseline FROM subscription_videos").all()).results,
  ).toEqual([{ is_baseline: 0 }]);

  // 같은 영상은 다시 확인해도 요청과 관측 기록을 늘리지 않아요.
  clock += 60;
  expect((await call("POST", "/channel-checks", {})).status).toBe(202);
  await runBackgroundJobs(settings, providers([video("aaaaaaaaaaa")]));
  expect(await count("summary_requests")).toBe(1);
  expect(await count("subscription_videos")).toBe(1);
});

test("첫 확인 실패는 기준을 만들지 않고 다음 성공 확인이 기준을 세워요", async () => {
  await seedAutomation();
  await runBackgroundJobs(
    settings,
    providers(async () => {
      throw new ChannelFetchError("provider_unavailable");
    }),
  );
  const failed = await latestCheck();
  if (!failed) throw new Error("확인 작업이 없어요.");
  expect(failed).toMatchObject({ status: "completed" });
  expect(
    (
      await sql(
        "SELECT status, failure_code, last_checked_at FROM channel_check_results",
      ).all()
    ).results,
  ).toEqual([
    {
      status: "failed",
      failure_code: "provider_unavailable",
      last_checked_at: null,
    },
  ]);
  expect(await subscriptionRow()).toMatchObject({
    baselineInitializedAt: null,
    lastCheckedAt: null,
    nextCheckAt: now + interval,
  });
  expect(await count("subscription_videos")).toBe(0);
  expect(await count("summary_requests")).toBe(0);

  clock += interval;
  await runBackgroundJobs(settings, providers([video("aaaaaaaaaaa")]));
  expect(await count("channel_checks")).toBe(2);
  expect(await subscriptionRow()).toMatchObject({
    baselineInitializedAt: clock,
    lastCheckedAt: clock,
  });
  expect(
    (await sql("SELECT is_baseline FROM subscription_videos").all()).results,
  ).toEqual([{ is_baseline: 1 }]);
  expect(await count("summary_requests")).toBe(0);
});

test("기준 이후 새 영상만 채널 요청으로 한 번 접수해요", async () => {
  await seedAutomation();
  await env.DB.batch([
    sql(
      "INSERT INTO videos (id, channel_id, title) VALUES ('aaaaaaaaaaa', ?, '기존 영상')",
      channel,
    ),
    sql(
      "INSERT INTO subscription_videos (subscription_id, video_id, is_baseline) VALUES ('sub', 'aaaaaaaaaaa', 1)",
    ),
    sql(
      "UPDATE channel_subscriptions SET baseline_initialized_at = ?, last_checked_at = ?, next_check_at = ? WHERE id = 'sub'",
      now - 100,
      now - 100,
      now - 1,
    ),
  ]);
  await runBackgroundJobs(
    settings,
    providers([video("aaaaaaaaaaa", "기존 영상"), video("bbbbbbbbbbb")]),
  );
  expect(
    (
      await sql(
        "SELECT q.origin, q.subscription_id, j.video_id FROM summary_requests q JOIN analysis_jobs j ON j.id = q.analysis_job_id",
      ).all()
    ).results,
  ).toEqual([
    { origin: "channel", subscription_id: "sub", video_id: "bbbbbbbbbbb" },
  ]);
  expect(
    (
      await sql(
        "SELECT video_id, is_baseline FROM subscription_videos ORDER BY video_id",
      ).all()
    ).results,
  ).toEqual([
    { video_id: "aaaaaaaaaaa", is_baseline: 1 },
    { video_id: "bbbbbbbbbbb", is_baseline: 0 },
  ]);
});

test("확인 중 중지한 채널은 공급자를 호출하지 않고 결과도 남기지 않아요", async () => {
  await seedAutomation();
  expect((await call("POST", "/channel-checks", {})).status).toBe(202);
  await sql("UPDATE channel_subscriptions SET status = 'paused'").run();
  const io = providers([]);
  await runBackgroundJobs(settings, io);
  expect(io.listVideos).not.toHaveBeenCalled();
  const check = await latestCheck();
  if (!check) throw new Error("확인 작업이 없어요.");
  expect(check).toMatchObject({ status: "completed" });
  expect(await count("channel_check_results")).toBe(0);
  expect(await subscriptionRow()).toMatchObject({ nextCheckAt: null });
});

test("수신 주소가 없으면 예약 확인을 만들지 않아요", async () => {
  await seedAutomation({ recipient: false });
  const io = providers([]);
  await runBackgroundJobs(settings, io);
  expect(await count("channel_checks")).toBe(0);
  expect(io.listVideos).not.toHaveBeenCalled();
  expect(await subscriptionRow()).toMatchObject({ nextCheckAt: null });
});

test("한 채널의 공급자 실패는 확인 완료와 다른 결과로 남겨요", async () => {
  await seedAutomation();
  await env.DB.batch([
    sql(
      "INSERT INTO channels (id, youtube_channel_id, title, url) VALUES ('channel-2', ?, '둘째 채널', ?)",
      youtubeId2,
      `https://www.youtube.com/channel/${youtubeId2}`,
    ),
    sql(
      "INSERT INTO channel_subscriptions (id, user_id, channel_id, created_at) VALUES ('sub-2', ?, 'channel-2', ?)",
      owner,
      now + 1,
    ),
  ]);
  const io = providers(async (id) => {
    if (id === youtubeId2) throw new ChannelFetchError("invalid_response");
    return [video("aaaaaaaaaaa")];
  });
  await runBackgroundJobs(settings, io);
  const check = await latestCheck();
  if (!check) throw new Error("확인 작업이 없어요.");
  expect(check).toMatchObject({ status: "completed", failureCode: null });
  expect(
    (
      await sql(
        "SELECT s.id AS subscriptionId, r.status, r.failure_code AS failureCode FROM channel_check_results r JOIN channel_subscriptions s ON s.id = r.subscription_id ORDER BY s.created_at",
      ).all()
    ).results,
  ).toEqual([
    { subscriptionId: "sub", status: "completed", failureCode: null },
    {
      subscriptionId: "sub-2",
      status: "failed",
      failureCode: "invalid_response",
    },
  ]);
  const [first, second] = await Promise.all([
    sql(
      "SELECT next_check_at AS nextCheckAt FROM channel_subscriptions WHERE id = 'sub'",
    ).first<number>("nextCheckAt"),
    sql(
      "SELECT next_check_at AS nextCheckAt FROM channel_subscriptions WHERE id = 'sub-2'",
    ).first<number>("nextCheckAt"),
  ]);
  expect(first).toBe(now + interval);
  expect(second).toBe(now + interval);
});

test("영상 접수 저장이 실패하면 관측을 되돌리고 채널만 실패로 남겨 다음 채널을 이어가요", async () => {
  await seedAutomation();
  await env.DB.batch([
    sql(
      "INSERT INTO channels (id, youtube_channel_id, title, url) VALUES ('channel-2', ?, '둘째 채널', ?)",
      youtubeId2,
      `https://www.youtube.com/channel/${youtubeId2}`,
    ),
    sql(
      "INSERT INTO channel_subscriptions (id, user_id, channel_id, created_at) VALUES ('sub-2', ?, 'channel-2', ?)",
      owner,
      now + 1,
    ),
    sql(
      "UPDATE channel_subscriptions SET baseline_initialized_at = ?, last_checked_at = ?, next_check_at = ? WHERE id = 'sub'",
      now - 100,
      now - 100,
      now - 1,
    ),
  ]);
  const io = providers(async (id) => [
    video(id === youtubeId ? "bbbbbbbbbbb" : "ccccccccccc"),
  ]);
  // 첫 구독의 요청 접수만 실패시켜요.
  vi.spyOn(console, "error").mockImplementation(() => {});
  await env.DB.prepare(
    "CREATE TRIGGER fail_channel_request BEFORE INSERT ON summary_requests WHEN NEW.subscription_id = 'sub' BEGIN SELECT RAISE(ABORT, 'fixture_failure'); END",
  ).run();
  try {
    await runBackgroundJobs(settings, io);
  } finally {
    await env.DB.prepare("DROP TRIGGER fail_channel_request").run();
  }
  expect(await latestCheck()).toMatchObject({
    status: "completed",
    failureCode: null,
  });
  expect(
    (
      await sql(
        "SELECT subscription_id AS subscriptionId, status, failure_code AS failureCode FROM channel_check_results ORDER BY subscription_id",
      ).all()
    ).results,
  ).toEqual([
    {
      subscriptionId: "sub",
      status: "failed",
      failureCode: "processing_failed",
    },
    { subscriptionId: "sub-2", status: "completed", failureCode: null },
  ]);
  // 실패한 영상은 관측되지 않아 다음 확인에서 다시 접수할 수 있고, 마지막 성공 시각은 그대로예요.
  expect(
    (
      await sql(
        "SELECT video_id FROM subscription_videos WHERE subscription_id = 'sub'",
      ).all()
    ).results,
  ).toEqual([]);
  expect(await subscriptionRow()).toMatchObject({
    lastCheckedAt: now - 100,
    nextCheckAt: now + interval,
  });

  clock = now + interval;
  await runBackgroundJobs(settings, io);
  expect(
    (
      await sql(
        "SELECT q.origin, j.video_id FROM summary_requests q JOIN analysis_jobs j ON j.id = q.analysis_job_id WHERE q.subscription_id = 'sub'",
      ).all()
    ).results,
  ).toEqual([{ origin: "channel", video_id: "bbbbbbbbbbb" }]);
});

test("첫 기준 저장이 실패하면 기준을 비워 두고 채널만 실패로 남겨 다음 주기에 다시 세워요", async () => {
  await seedAutomation();
  const io = providers([video("aaaaaaaaaaa")]);
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  await env.DB.prepare(
    "CREATE TRIGGER fail_baseline BEFORE INSERT ON subscription_videos BEGIN SELECT RAISE(ABORT, 'fixture_failure'); END",
  ).run();
  try {
    await runBackgroundJobs(settings, io);
  } finally {
    await env.DB.prepare("DROP TRIGGER fail_baseline").run();
  }
  expect(await latestCheck()).toMatchObject({
    status: "completed",
    failureCode: null,
  });
  expect(
    (
      await sql(
        "SELECT status, failure_code AS failureCode FROM channel_check_results WHERE subscription_id = 'sub'",
      ).all()
    ).results,
  ).toEqual([{ status: "failed", failureCode: "processing_failed" }]);
  expect(await subscriptionRow()).toMatchObject({
    baselineInitializedAt: null,
    lastCheckedAt: null,
    nextCheckAt: now + interval,
  });
  // 원인 추적용 로그에는 작업 ID와 예외 이름만 남고 메시지 원문은 없어요.
  const entry = JSON.parse(String(logged.mock.calls[0]?.[0]));
  expect(entry).toMatchObject({
    event: "check.channel_error",
    kind: "channel_check",
    errorName: expect.any(String),
  });
  expect(JSON.stringify(entry)).not.toContain("fixture_failure");

  clock = now + interval;
  await runBackgroundJobs(settings, io);
  expect(await subscriptionRow()).toMatchObject({
    baselineInitializedAt: clock,
    lastCheckedAt: clock,
  });
  expect(await count("summary_requests")).toBe(0);
});

test("다른 계정의 확인 작업은 읽을 수 없어요", async () => {
  await seedAutomation();
  const created = await call("POST", "/channel-checks", {});
  const { id } = await created.json<{ id: string }>();
  expect(
    (await call("GET", `/channel-checks/${id}`, undefined, otherToken)).status,
  ).toBe(404);
  expect((await call("GET", "/channel-checks/not-a-uuid")).status).toBe(400);
  expect((await call("POST", "/channel-checks", {}, otherToken)).status).toBe(
    409,
  );
});

test("공급자 설정이 빠지면 확인 작업을 실패로 끝내고 다음 확인을 만들지 않아요", async () => {
  await seedAutomation();
  expect((await call("POST", "/channel-checks", {})).status).toBe(202);
  const io = providers([]);
  await runBackgroundJobs({ ...settings, GEMINI_MODEL: "unsupported" }, io);
  const check = await latestCheck();
  if (!check) throw new Error("확인 작업이 없어요.");
  expect(check).toMatchObject({
    status: "failed",
    failureCode: "configuration",
  });
  expect(io.listVideos).not.toHaveBeenCalled();
  expect(await subscriptionRow()).toMatchObject({
    baselineInitializedAt: null,
    nextCheckAt: null,
  });
  expect(await count("channel_checks")).toBe(1);
});

test("중첩 실행은 확인 작업 하나만 점유해요", async () => {
  await seedAutomation();
  expect((await call("POST", "/channel-checks", {})).status).toBe(202);
  const claims = await Promise.all(
    Array.from({ length: 8 }, () => claimChannelCheck(env.DB, now)),
  );
  expect(claims.filter(Boolean)).toHaveLength(1);
});

test("오래 실행 중인 확인은 중단으로 끝내고 다음 확인이 이어가요", async () => {
  await seedAutomation();
  expect((await call("POST", "/channel-checks", {})).status).toBe(202);
  expect(await claimChannelCheck(env.DB, now)).not.toBeNull();
  clock += 900;
  expect(await claimChannelCheck(env.DB, clock)).toBeNull();
  expect(await latestCheck()).toMatchObject({
    status: "failed",
    failureCode: "interrupted",
  });

  // 기준이 없는 구독은 다음 예약 실행에서 다시 확인해요.
  await runBackgroundJobs(settings, providers([video("aaaaaaaaaaa")]));
  expect(await count("channel_checks")).toBe(2);
  expect(await subscriptionRow()).toMatchObject({
    baselineInitializedAt: clock,
  });
});
