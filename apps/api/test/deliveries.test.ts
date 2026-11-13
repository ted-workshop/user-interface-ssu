import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createApp } from "../src/app";
import { sha256Hex } from "../src/auth";
import { EmailError } from "../src/email";
import { enqueueAnalysis } from "../src/jobs/analysis";
import { getDelivery } from "../src/jobs/delivery";
import { type JobProviders, runBackgroundJobs } from "../src/jobs/runner";
import type { getVideoMetadata } from "../src/summary";
import type { fetchChannelVideos } from "../src/youtube-videos";

const now = 1_800_000_000;
const videoId = "jNQXAC9IVRw";
const model = "gemini-3.6-flash";
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const token = "a".repeat(43);
const otherToken = "b".repeat(43);
const settings = { ...env, GEMINI_MODEL: model };
const app = createApp();
let clock = now;
const sql = (query: string, ...values: (string | number | null)[]) =>
  env.DB.prepare(query).bind(...values);

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

function providers(send: JobProviders["send"]) {
  return {
    now: () => clock,
    metadata: vi.fn(async (url: string) => ({
      videoId,
      url,
      title: "검사 영상",
      channel: "검사 채널",
      channelUrl: "https://www.youtube.com/@fixture",
      metadataSource: "https://www.youtube.com/oembed",
    })) as unknown as typeof getVideoMetadata,
    generate: vi.fn(async () => ({
      markdown: "검사 보고서 본문",
      model,
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
    listVideos: vi.fn(async () => []) as unknown as typeof fetchChannelVideos,
    send,
  } satisfies JobProviders;
}

const accepted = async () => ({
  status: "accepted" as const,
  messageId: "fixture",
});
const temporary = async () => {
  throw new EmailError("temporary", 451);
};

// 기준이 있는 구독과 관측 영상을 만들고 채널 자동 요청을 접수해요.
async function channelRequest(
  recipients: { id: string; email: string; verifiedAt: number }[],
) {
  await env.DB.batch([
    sql(
      "INSERT INTO channels (id, youtube_channel_id, title, url) VALUES ('channel', 'UC_fixture', '검사 채널', 'https://www.youtube.com/channel/UC_fixture')",
    ),
    sql("INSERT INTO videos (id, channel_id) VALUES (?, 'channel')", videoId),
    sql(
      "INSERT INTO channel_subscriptions (id, user_id, channel_id, baseline_initialized_at, last_checked_at, next_check_at) VALUES ('sub', ?, 'channel', ?, ?, ?)",
      owner,
      now - 100,
      now - 100,
      now + 3_600,
    ),
    sql(
      "INSERT INTO subscription_videos (subscription_id, video_id, is_baseline) VALUES ('sub', ?, 0)",
      videoId,
    ),
    ...recipients.map((recipient) =>
      sql(
        "INSERT INTO recipients (id, user_id, email, verified_at) VALUES (?, ?, ?, ?)",
        recipient.id,
        owner,
        recipient.email,
        recipient.verifiedAt,
      ),
    ),
  ]);
  return enqueueAnalysis(
    env.DB,
    {
      userId: owner,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      model,
      subscriptionId: "sub",
    },
    now,
  );
}

async function requestReportId() {
  return sql(
    "SELECT r.id FROM reports r JOIN analysis_jobs j ON j.id = r.analysis_job_id WHERE j.video_id = ?",
    videoId,
  ).first<string>("id");
}

async function listDeliveries(reportId: string, query = "") {
  const response = await call("GET", `/reports/${reportId}/deliveries${query}`);
  expect(response.status).toBe(200);
  return response.json<{
    items: {
      id: string;
      email: string;
      status: string;
      attempt: number;
      failureCode: string | null;
      retryable: boolean;
    }[];
    nextCursor: string | null;
  }>();
}

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(async () => {
  clock = now;
  vi.spyOn(Date, "now").mockImplementation(() => clock * 1_000);
  for (const table of [
    "delivery_attempts",
    "deliveries",
    "channel_check_results",
    "channel_checks",
    "auth_mail_outbox",
    "auth_rate_limits",
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

test("채널 리포트는 저장 시점의 확인된 주소별 발송 행을 자동으로 만들어요", async () => {
  await channelRequest([
    { id: "r1", email: "first@example.com", verifiedAt: now - 2 },
    { id: "r2", email: "second@example.com", verifiedAt: now - 1 },
  ]);
  await runBackgroundJobs(settings, providers(temporary));
  const reportId = await requestReportId();
  if (!reportId) throw new Error("리포트가 없어요.");
  expect(
    (
      await sql(
        "SELECT recipient_email AS email FROM deliveries ORDER BY recipient_email",
      ).all()
    ).results,
  ).toEqual([{ email: "first@example.com" }, { email: "second@example.com" }]);
  expect(
    (await sql("SELECT status FROM deliveries").all()).results.every((row) =>
      ["queued", "failed"].includes(String(row.status)),
    ),
  ).toBe(true);
  expect((await listDeliveries(reportId)).items).toHaveLength(2);
});

test("직접 요약과 리포트 저장 뒤에 확인한 주소는 발송 대상이 아니에요", async () => {
  await channelRequest([
    { id: "r1", email: "first@example.com", verifiedAt: now - 1 },
    { id: "r2", email: "late@example.com", verifiedAt: now + 10 },
  ]);
  await enqueueAnalysis(
    env.DB,
    { userId: other, url: `https://www.youtube.com/watch?v=${videoId}`, model },
    now,
  );
  await runBackgroundJobs(settings, providers(temporary));
  expect(
    (await sql("SELECT recipient_email AS email FROM deliveries").all())
      .results,
  ).toEqual([{ email: "first@example.com" }]);
});

test("같은 영상을 자동 요약한 다른 계정도 각자의 주소로 발송 행을 받아요", async () => {
  await channelRequest([
    { id: "r1", email: "first@example.com", verifiedAt: now - 1 },
  ]);
  await env.DB.batch([
    sql(
      "INSERT INTO channel_subscriptions (id, user_id, channel_id, baseline_initialized_at, last_checked_at, next_check_at) VALUES ('sub-other', ?, 'channel', ?, ?, ?)",
      other,
      now - 100,
      now - 100,
      now + 3_600,
    ),
    sql(
      "INSERT INTO subscription_videos (subscription_id, video_id, is_baseline) VALUES ('sub-other', ?, 0)",
      videoId,
    ),
    sql(
      "INSERT INTO recipients (id, user_id, email, verified_at) VALUES ('other-mail', ?, 'other@example.com', ?)",
      other,
      now - 1,
    ),
  ]);
  await enqueueAnalysis(
    env.DB,
    {
      userId: other,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      model,
      subscriptionId: "sub-other",
    },
    now,
  );
  await runBackgroundJobs(settings, providers(temporary));
  expect(
    (
      await sql(
        "SELECT user_id AS userId, recipient_email AS email FROM deliveries ORDER BY user_id",
      ).all()
    ).results,
  ).toEqual([
    { userId: owner, email: "first@example.com" },
    { userId: other, email: "other@example.com" },
  ]);
});

test("이미 완료된 리포트를 나중에 재사용한 채널 요청에는 발송 행을 만들지 않아요", async () => {
  await channelRequest([
    { id: "r1", email: "first@example.com", verifiedAt: now - 1 },
  ]);
  await runBackgroundJobs(settings, providers(temporary));
  const reportId = await requestReportId();
  if (!reportId) throw new Error("리포트가 없어요.");
  const before = (await listDeliveries(reportId)).items.length;

  await env.DB.batch([
    sql(
      "INSERT INTO channel_subscriptions (id, user_id, channel_id, baseline_initialized_at, last_checked_at, next_check_at) VALUES ('sub-late', ?, 'channel', ?, ?, ?)",
      other,
      now - 100,
      now - 100,
      now + 3_600,
    ),
    sql(
      "INSERT INTO subscription_videos (subscription_id, video_id, is_baseline) VALUES ('sub-late', ?, 0)",
      videoId,
    ),
    sql(
      "INSERT INTO recipients (id, user_id, email, verified_at) VALUES ('late-mail', ?, 'late@example.com', ?)",
      other,
      now - 1,
    ),
  ]);
  const reused = await enqueueAnalysis(
    env.DB,
    {
      userId: other,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      model,
      subscriptionId: "sub-late",
    },
    now,
  );
  expect(reused.status).toBe("completed");
  await runBackgroundJobs(settings, providers(temporary));
  expect((await listDeliveries(reportId)).items).toHaveLength(before);
  expect(
    (await sql("SELECT recipient_email AS email FROM deliveries").all())
      .results,
  ).toEqual([{ email: "first@example.com" }]);
});

test("일부 주소가 실패해도 리포트를 읽을 수 있고 실패 주소만 재시도해요", async () => {
  await channelRequest([
    { id: "r1", email: "first@example.com", verifiedAt: now - 1 },
    { id: "r2", email: "second@example.com", verifiedAt: now - 1 },
  ]);
  const io = providers(async (_config, message) => {
    if (message.to === "second@example.com")
      throw new EmailError("temporary", 451);
    return accepted();
  });
  for (let run = 0; run < 4; run += 1) await runBackgroundJobs(settings, io);
  const reportId = await requestReportId();
  if (!reportId) throw new Error("리포트가 없어요.");
  const list = await listDeliveries(reportId);
  expect(
    Object.fromEntries(list.items.map((item) => [item.email, item.status])),
  ).toEqual({
    "first@example.com": "sent",
    "second@example.com": "failed",
  });
  const failed = list.items.find((item) => item.status === "failed");
  if (!failed) throw new Error("실패 발송이 없어요.");
  expect(failed.retryable).toBe(true);
  expect((await call("GET", `/reports/${reportId}`)).status).toBe(200);

  const retried = await call("POST", `/deliveries/${failed.id}/retry`, {
    attempt: 1,
  });
  expect(retried.status).toBe(202);
  expect(await retried.json()).toMatchObject({ status: "queued", attempt: 1 });
  expect(
    (
      await call("POST", `/deliveries/${failed.id}/retry`, {
        attempt: 1,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call("POST", `/deliveries/${failed.id}/retry`, {
        attempt: 2,
      })
    ).status,
  ).toBe(409);

  clock += 60;
  io.send = vi.fn(accepted);
  await runBackgroundJobs(settings, io);
  const after = await listDeliveries(reportId);
  expect(
    Object.fromEntries(after.items.map((item) => [item.email, item.status])),
  ).toEqual({
    "first@example.com": "sent",
    "second@example.com": "sent",
  });
  // 메일 재시도는 저장된 리포트를 다시 만들지 않아요.
  expect(io.generate).toHaveBeenCalledTimes(1);
});

test("채널을 중지하면 대기 발송이 취소되고 재시도할 수 없어요", async () => {
  await channelRequest([
    { id: "r1", email: "first@example.com", verifiedAt: now - 1 },
  ]);
  await runBackgroundJobs(settings, providers(temporary));
  const reportId = await requestReportId();
  if (!reportId) throw new Error("리포트가 없어요.");
  const [delivery] = (await listDeliveries(reportId)).items;
  if (!delivery) throw new Error("발송 행이 없어요.");
  await sql("UPDATE channel_subscriptions SET status = 'paused'").run();
  expect(await getDelivery(env.DB, owner, delivery.id)).toMatchObject({
    status: "cancelled",
    retryable: false,
  });
  expect(
    (
      await call("POST", `/deliveries/${delivery.id}/retry`, {
        attempt: 1,
      })
    ).status,
  ).toBe(409);
  expect((await call("GET", `/reports/${reportId}`)).status).toBe(200);
});

test("발송 행 저장이 실패하면 리포트와 권한을 부분 저장하지 않아요", async () => {
  await channelRequest([
    { id: "r1", email: "first@example.com", verifiedAt: now - 1 },
  ]);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await env.DB.prepare(
    "CREATE TRIGGER fixture_delivery_failure BEFORE INSERT ON deliveries BEGIN SELECT RAISE(ABORT, 'fixture'); END",
  ).run();
  try {
    await expect(
      runBackgroundJobs(settings, providers(temporary)),
    ).rejects.toThrow("영속 작업 실행");
  } finally {
    await env.DB.prepare("DROP TRIGGER fixture_delivery_failure").run();
    error.mockRestore();
  }
  expect((await sql("SELECT id FROM reports").all()).results).toEqual([]);
  expect(
    (await sql("SELECT id FROM report_permissions").all()).results,
  ).toEqual([]);
  expect(
    (
      await sql(
        "SELECT id FROM summary_requests WHERE status = 'completed'",
      ).all()
    ).results,
  ).toEqual([]);
});

test("다른 계정은 발송 목록과 재시도에 접근할 수 없어요", async () => {
  await channelRequest([
    { id: "r1", email: "first@example.com", verifiedAt: now - 1 },
  ]);
  await runBackgroundJobs(settings, providers(temporary));
  const reportId = await requestReportId();
  if (!reportId) throw new Error("리포트가 없어요.");
  const [delivery] = (await listDeliveries(reportId)).items;
  if (!delivery) throw new Error("발송 행이 없어요.");
  expect(
    (
      await call(
        "GET",
        `/reports/${reportId}/deliveries`,
        undefined,
        otherToken,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await call(
        "POST",
        `/deliveries/${delivery.id}/retry`,
        { attempt: 1 },
        otherToken,
      )
    ).status,
  ).toBe(404);
});

test("발송 목록은 페이지 사이에 누락과 중복이 없어요", async () => {
  await channelRequest([
    { id: "r1", email: "first@example.com", verifiedAt: now - 2 },
    { id: "r2", email: "second@example.com", verifiedAt: now - 1 },
  ]);
  await runBackgroundJobs(settings, providers(temporary));
  const reportId = await requestReportId();
  if (!reportId) throw new Error("리포트가 없어요.");
  const first = await listDeliveries(reportId, "?limit=1");
  expect(first.items).toHaveLength(1);
  if (!first.nextCursor) throw new Error("다음 페이지가 없어요.");
  const second = await call(
    "GET",
    `/reports/${reportId}/deliveries?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
  );
  expect(second.status).toBe(200);
  const rest = await second.json<{ items: { id: string }[] }>();
  expect(rest.items).toHaveLength(1);
  expect(rest.items[0]?.id).not.toBe(first.items[0]?.id);
});

test("리포트 권한이 없으면 발송 목록을 읽을 수 없어요", async () => {
  await channelRequest([
    { id: "r1", email: "first@example.com", verifiedAt: now - 1 },
  ]);
  await runBackgroundJobs(settings, providers(temporary));
  const reportId = await requestReportId();
  if (!reportId) throw new Error("리포트가 없어요.");
  await sql(
    "DELETE FROM report_permissions WHERE report_id = ? AND user_id = ?",
    reportId,
    owner,
  ).run();
  expect((await call("GET", `/reports/${reportId}/deliveries`)).status).toBe(
    404,
  );
});
