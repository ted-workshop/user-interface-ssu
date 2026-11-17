import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createApp } from "../src/app";
import { sha256Hex } from "../src/auth";
import { runAuthMail } from "../src/auth-mail";
import type { EmailMessage } from "../src/email";
import { enqueueAnalysis } from "../src/jobs/analysis";
import { enqueueDelivery } from "../src/jobs/delivery";
import { runBackgroundJobs } from "../src/jobs/runner";

const now = 1_800_000_000;
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const token = "a".repeat(43);
const otherToken = "b".repeat(43);
const youtubeId = `UC${"a".repeat(22)}`;
const app = createApp();
const sql = (query: string, ...values: (string | number | null)[]) =>
  env.DB.prepare(query).bind(...values);
let clock = now;

function call(method: string, path: string, body?: unknown, secret = token) {
  return app.request(
    `/v1${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${secret}`,
        "cf-connecting-ip": "192.0.2.1",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

beforeAll(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS));
beforeEach(async () => {
  clock = now;
  vi.spyOn(Date, "now").mockImplementation(() => clock * 1000);
  for (const table of [
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
    "channel_check_results",
    "channel_checks",
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
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json({
      items: [{ id: youtubeId, snippet: { title: "검사 채널" } }],
    }),
  );
});

async function addChannel(secret = token) {
  const response = await call(
    "POST",
    "/channels",
    { youtubeChannelId: youtubeId },
    secret,
  );
  expect(response.status).toBe(201);
  return response.json<{ id: string }>();
}

async function addRecipient(address = "receiver@example.com", secret = token) {
  const response = await call(
    "POST",
    "/recipients",
    { email: address },
    secret,
  );
  expect(response.status).toBe(201);
  return response.json<{ id: string }>();
}

async function mailCode() {
  const messages: EmailMessage[] = [];
  await runAuthMail(
    env,
    async (_config, message) => {
      messages.push(message);
      return { status: "accepted", messageId: "fixture" };
    },
    clock,
  );
  expect(messages).toHaveLength(1);
  return {
    token: messages[0]?.text.match(/[A-Za-z0-9_-]{43}/)?.[0] ?? "",
    message: messages[0],
  };
}

test("확인 메일은 로그인 주소 대신 수신 주소로 보내고 소유자만 한 번 확인해요", async () => {
  const recipient = await addRecipient();
  expect(
    (
      await call(
        "POST",
        `/recipients/${recipient.id}/verifications`,
        undefined,
        otherToken,
      )
    ).status,
  ).toBe(404);
  expect(
    (await call("POST", `/recipients/${recipient.id}/verifications`)).status,
  ).toBe(202);
  const sealed = await sql(
    "SELECT token_ciphertext FROM auth_mail_outbox",
  ).first<string>("token_ciphertext");
  const code = await mailCode();
  expect(code.message?.to).toBe("receiver@example.com");
  expect(code.message?.subject).toBe("Qletter 수신 주소 확인");
  expect(sealed).not.toContain(code.token);
  expect(
    await sql("SELECT token_hash FROM account_tokens").first("token_hash"),
  ).toBe(await sha256Hex(code.token));
  expect(
    (
      await call(
        "POST",
        "/recipient-verifications/confirm",
        { token: code.token },
        otherToken,
      )
    ).status,
  ).toBe(400);
  const results = await Promise.all([
    call("POST", "/recipient-verifications/confirm", { token: code.token }),
    call("POST", "/recipient-verifications/confirm", { token: code.token }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([204, 400]);
  expect(await (await call("GET", "/recipients")).json()).toMatchObject({
    items: [{ verifiedAt: new Date(now * 1000).toISOString() }],
  });
  expect(
    (await call("POST", `/recipients/${recipient.id}/verifications`)).status,
  ).toBe(400);
  expect(
    await sql("SELECT count(*) AS n FROM auth_mail_outbox").first("n"),
  ).toBe(0);
});

test("재발급은 이전 코드만 폐기하고 60초 간격·시간당 세 번을 지켜요", async () => {
  const recipient = await addRecipient();
  const path = `/recipients/${recipient.id}/verifications`;
  expect((await call("POST", path)).status).toBe(202);
  const first = await mailCode();
  const early = await call("POST", path);
  expect(early.status).toBe(429);
  expect(early.headers.get("retry-after")).toBe("60");
  clock += 60;
  expect((await call("POST", path)).status).toBe(202);
  const second = await mailCode();
  expect(
    (
      await call("POST", "/recipient-verifications/confirm", {
        token: first.token,
      })
    ).status,
  ).toBe(400);
  clock += 60;
  const limited = await call("POST", path);
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("retry-after"))).toBe(3480);
  expect(
    (
      await call("POST", "/recipient-verifications/confirm", {
        token: second.token,
      })
    ).status,
  ).toBe(204);
});

test("수신 주소 확인은 계정 확인과 IP당 분당 다섯 번의 제한을 공유해요", async () => {
  const path = "/recipient-verifications/confirm";
  const missing = { token: "z".repeat(43) };
  const account = await call("POST", "/auth/email-verifications/confirm", {
    ...missing,
    password: "fixture-password",
  });
  expect(await account.json()).toEqual({ error: { code: "INVALID_TOKEN" } });
  for (let attempt = 0; attempt < 4; attempt++) {
    expect(await (await call("POST", path, missing)).json()).toEqual({
      error: { code: "INVALID_TOKEN" },
    });
  }
  const limited = await call("POST", path, missing);
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("60");
  expect(await limited.json()).toEqual({ error: { code: "RATE_LIMITED" } });
  clock += 60;
  expect(await (await call("POST", path, missing)).json()).toEqual({
    error: { code: "INVALID_TOKEN" },
  });
});

test("24시간 만료·다른 목적의 토큰은 수신 주소를 확인하지 못해요", async () => {
  const recipient = await addRecipient();
  await call("POST", `/recipients/${recipient.id}/verifications`);
  const first = await mailCode();
  clock += 86_400;
  expect(
    (
      await call("POST", "/recipient-verifications/confirm", {
        token: first.token,
      })
    ).status,
  ).toBe(400);
  const accountToken = "x".repeat(43);
  await sql(
    "INSERT INTO account_tokens (id,user_id,purpose,token_hash,created_at,expires_at) VALUES (?,?,'verify_email',?,?,?)",
    crypto.randomUUID(),
    owner,
    await sha256Hex(accountToken),
    clock,
    clock + 100,
  ).run();
  expect(
    (
      await call("POST", "/recipient-verifications/confirm", {
        token: accountToken,
      })
    ).status,
  ).toBe(400);
  expect(
    await sql(
      "SELECT verified_at FROM recipients WHERE id = ?",
      recipient.id,
    ).first("verified_at"),
  ).toBeNull();
});

test("발송 전 삭제는 대기 메일과 코드를 제거하고 재등록해도 되살리지 않아요", async () => {
  const recipient = await addRecipient();
  await call("POST", `/recipients/${recipient.id}/verifications`);
  expect((await call("DELETE", `/recipients/${recipient.id}`)).status).toBe(
    204,
  );
  const send = vi.fn(async () => ({
    status: "accepted" as const,
    messageId: "fixture",
  }));
  await runAuthMail(env, send, clock);
  expect(send).not.toHaveBeenCalled();
  expect(await sql("SELECT count(*) AS n FROM account_tokens").first("n")).toBe(
    0,
  );
  const again = await addRecipient();
  expect(again.id).not.toBe(recipient.id);
  expect(
    await sql(
      "SELECT verified_at FROM recipients WHERE id = ?",
      again.id,
    ).first("verified_at"),
  ).toBeNull();
});

test.each(["channels", "recipients"])(
  "%s 목록은 같은 시각에도 중복 없이 나누고 타인 행을 숨겨요",
  async (resource) => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      if (resource === "recipients")
        ids.push((await addRecipient(`reader${i}@example.com`)).id);
      else {
        const id = crypto.randomUUID();
        await sql(
          "INSERT INTO channels (id,youtube_channel_id,title,url) VALUES (?,?, '검사', 'https://www.youtube.com')",
          id,
          `UC${String(i).repeat(22)}`,
        ).run();
        await sql(
          "INSERT INTO channel_subscriptions (id,user_id,channel_id,created_at) VALUES (?,?,?,?)",
          id,
          owner,
          id,
          now,
        ).run();
        ids.push(id);
      }
    }
    if (resource === "recipients")
      await addRecipient("other@example.com", otherToken);
    else await addChannel(otherToken);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await call(
        "GET",
        `/${resource}?limit=1${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const page = await response.json<{
        items: { id: string }[];
        nextCursor: string | null;
      }>();
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(ids.sort().reverse());
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=1&limit=2",
      "cursor=bad",
      "userId=someone",
    ])
      expect((await call("GET", `/${resource}?${query}`)).status).toBe(400);
  },
);

test("모든 설정 경로는 인증을 요구하고 알 수 없는 입력을 거부해요", async () => {
  for (const [method, path, value] of [
    ["POST", "/channel-previews", { input: "@fixture" }],
    ["POST", "/channels", { youtubeChannelId: youtubeId }],
    ["GET", "/channels", undefined],
    ["PATCH", `/channels/${owner}`, { status: "paused" }],
    ["DELETE", `/channels/${owner}`, undefined],
    ["GET", "/settings", undefined],
    ["PATCH", "/settings", { checkIntervalMinutes: 60 }],
    ["GET", "/recipients", undefined],
    ["POST", "/recipients", { email: "test@example.com" }],
    ["POST", `/recipients/${owner}/verifications`, undefined],
    ["POST", "/recipient-verifications/confirm", { token }],
    ["DELETE", `/recipients/${owner}`, undefined],
  ] as const)
    expect((await call(method, path, value, "invalid")).status).toBe(401);
  for (const [path, value] of [
    ["/channel-previews", { input: "@fixture", userId: other }],
    ["/channels", { youtubeChannelId: youtubeId, title: "가짜" }],
    ["/recipients", { email: "test@example.com", verifiedAt: now }],
  ] as const) {
    const invalid = await call("POST", path, value);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: { code: "INVALID_INPUT" } });
  }
  expect((await call("DELETE", "/channels/not-a-uuid")).status).toBe(400);
  expect((await call("DELETE", "/recipients/not-a-uuid")).status).toBe(400);
  expect((await call("GET", "/settings?userId=other")).status).toBe(400);
  expect(
    (await call("POST", "/channel-previews", { input: "a".repeat(17_000) }))
      .status,
  ).toBe(413);
  expect((await app.request("/unknown", {}, env)).status).toBe(404);
});

test("주기 변경·중지·재개는 본인의 다음 확인 시각만 다시 계산해요", async () => {
  const channel = await addChannel();
  const another = await addChannel(otherToken);
  await sql(
    "UPDATE channel_subscriptions SET baseline_initialized_at = ?, last_checked_at = ?, next_check_at = ?",
    now - 100,
    now - 100,
    now + 21_500,
  ).run();
  await call("PATCH", "/settings", { checkIntervalMinutes: 60 });
  expect(
    await sql(
      "SELECT next_check_at FROM channel_subscriptions WHERE id = ?",
      channel.id,
    ).first("next_check_at"),
  ).toBe(now + 3500);
  expect(
    await sql(
      "SELECT next_check_at FROM channel_subscriptions WHERE id = ?",
      another.id,
    ).first("next_check_at"),
  ).toBe(now + 21_500);
  await call("PATCH", `/channels/${channel.id}`, { status: "paused" });
  await call("PATCH", "/settings", { checkIntervalMinutes: 1440 });
  expect(
    await sql(
      "SELECT next_check_at FROM channel_subscriptions WHERE id = ?",
      channel.id,
    ).first("next_check_at"),
  ).toBeNull();
  const resumed = await call("PATCH", `/channels/${channel.id}`, {
    status: "active",
  });
  expect(await resumed.json()).toMatchObject({
    nextCheckAt: new Date((now - 100 + 86_400) * 1000).toISOString(),
  });
});

test("동시에 같은 채널·주소를 등록해도 하나만 생성해요", async () => {
  for (const [path, body] of [
    ["/channels", { youtubeChannelId: youtubeId }],
    ["/recipients", { email: "reader@example.com" }],
  ] as const) {
    const responses = await Promise.all([
      call("POST", path, body),
      call("POST", path, body),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  }
});

test("저장 실패는 성공·중복으로 숨기지 않고 batch 전체를 되돌려요", async () => {
  const channel = await addChannel();
  await call("PATCH", "/settings", { checkIntervalMinutes: 60 });
  await sql(
    "UPDATE channel_subscriptions SET last_checked_at = ?, next_check_at = ? WHERE id = ?",
    now,
    now + 3600,
    channel.id,
  ).run();
  await env.DB.exec(
    "CREATE TRIGGER fixture_settings_failure BEFORE UPDATE OF next_check_at ON channel_subscriptions BEGIN SELECT RAISE(ABORT, 'fixture'); END",
  );
  try {
    expect(
      (await call("PATCH", "/settings", { checkIntervalMinutes: 1440 })).status,
    ).toBe(500);
    expect(await (await call("GET", "/settings")).json()).toEqual({
      checkIntervalMinutes: 60,
    });
  } finally {
    await env.DB.exec("DROP TRIGGER fixture_settings_failure");
  }
  const recipient = await addRecipient();
  await env.DB.exec(
    "CREATE TRIGGER fixture_mail_failure BEFORE INSERT ON auth_mail_outbox BEGIN SELECT RAISE(ABORT, 'fixture'); END",
  );
  try {
    expect(
      (await call("POST", `/recipients/${recipient.id}/verifications`)).status,
    ).toBe(500);
    expect(
      await sql("SELECT count(*) AS n FROM account_tokens").first("n"),
    ).toBe(0);
  } finally {
    await env.DB.exec("DROP TRIGGER fixture_mail_failure");
  }
});

test.each(["channel", "recipient"])(
  "%s 삭제는 대기 발송을 취소하고 저장된 리포트·계정을 보존해요",
  async (target) => {
    const channel = await addChannel();
    const recipient = await addRecipient();
    await sql(
      "UPDATE recipients SET verified_at = ? WHERE id = ?",
      now,
      recipient.id,
    ).run();
    const videoId = "jNQXAC9IVRw";
    await sql(
      "INSERT INTO videos (id,channel_id) SELECT ?, channel_id FROM channel_subscriptions WHERE id = ?",
      videoId,
      channel.id,
    ).run();
    await sql(
      "UPDATE channel_subscriptions SET baseline_initialized_at = ? WHERE id = ?",
      now - 1,
      channel.id,
    ).run();
    await sql(
      "INSERT INTO subscription_videos (subscription_id,video_id,is_baseline) VALUES (?,?,0)",
      channel.id,
      videoId,
    ).run();
    const requested = await enqueueAnalysis(
      env.DB,
      {
        userId: owner,
        url: `https://youtu.be/${videoId}`,
        model: "gemini-3.6-flash",
        subscriptionId: channel.id,
      },
      now,
    );
    await runBackgroundJobs(
      { ...env, GEMINI_MODEL: "gemini-3.6-flash" },
      {
        now: () => now,
        metadata: async (url) => ({
          videoId,
          url,
          title: "검사 영상",
          channel: "검사 채널",
          channelUrl: `https://www.youtube.com/channel/${youtubeId}`,
          metadataSource: "https://www.youtube.com/oembed",
        }),
        generate: async () => ({
          markdown: "보존할 리포트",
          model: "gemini-3.6-flash",
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
          timestampVerification: "unverified",
        }),
        listVideos: async () => [],
        send: vi.fn(),
      },
    );
    await enqueueDelivery(env.DB, owner, requested.id, recipient.id, now);
    const before = await (await call("GET", "/reports")).json<{
      items: { id: string }[];
    }>();
    expect(before.items).toHaveLength(1);
    const path =
      target === "channel"
        ? `/channels/${channel.id}`
        : `/recipients/${recipient.id}`;
    expect((await call("DELETE", path)).status).toBe(204);
    expect(await sql("SELECT status FROM deliveries").first("status")).toBe(
      "cancelled",
    );
    expect(await (await call("GET", "/reports")).json()).toMatchObject({
      items: [{ id: before.items[0]?.id }],
    });
    expect((await call("GET", `/reports/${before.items[0]?.id}`)).status).toBe(
      200,
    );
    expect((await call("GET", "/me")).status).toBe(200);
  },
);

test("수신 설정이 없어도 직접 요약을 접수해요", async () => {
  expect(
    (
      await call("POST", "/summary-requests", {
        url: "https://youtu.be/jNQXAC9IVRw",
      })
    ).status,
  ).toBe(202);
  expect(await sql("SELECT count(*) AS n FROM recipients").first("n")).toBe(0);
});
afterEach(() => vi.restoreAllMocks());

test("채널 확인·등록·중복 거부·중지·재개·삭제·새 등록을 계정별로 처리해요", async () => {
  const preview = await call("POST", "/channel-previews", {
    input: "@fixture",
  });
  expect(preview.status).toBe(200);
  expect(await preview.json()).toEqual({
    youtubeChannelId: youtubeId,
    title: "검사 채널",
    url: `https://www.youtube.com/channel/${youtubeId}`,
  });
  const added = await call("POST", "/channels", {
    youtubeChannelId: youtubeId,
  });
  expect(added.status).toBe(201);
  const channel = await added.json<{
    id: string;
    baselineInitializedAt: null;
  }>();
  expect(channel.baselineInitializedAt).toBeNull();
  expect(added.headers.get("location")).toBe(`/v1/channels/${channel.id}`);
  vi.mocked(globalThis.fetch).mockClear();
  expect(
    (await call("POST", "/channels", { youtubeChannelId: youtubeId })).status,
  ).toBe(409);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(
    (
      await call(
        "POST",
        "/channels",
        { youtubeChannelId: youtubeId },
        otherToken,
      )
    ).status,
  ).toBe(201);
  for (const status of ["paused", "active"]) {
    const changed = await call("PATCH", `/channels/${channel.id}`, { status });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ status });
  }
  expect(
    (await call("DELETE", `/channels/${channel.id}`, undefined, otherToken))
      .status,
  ).toBe(404);
  expect((await call("DELETE", `/channels/${channel.id}`)).status).toBe(204);
  expect(await (await call("GET", "/channels")).json()).toEqual({
    items: [],
    nextCursor: null,
  });
  expect(
    (await call("PATCH", `/channels/${channel.id}`, { status: "active" }))
      .status,
  ).toBe(404);
  const again = await call("POST", "/channels", {
    youtubeChannelId: youtubeId,
  });
  expect(again.status).toBe(201);
  expect((await again.json<{ id: string }>()).id).not.toBe(channel.id);
});

test("확인 주기를 저장하고 다른 계정의 기본값과 분리해요", async () => {
  expect(await (await call("GET", "/settings")).json()).toEqual({
    checkIntervalMinutes: 360,
  });
  for (const value of [60, 360, 1440]) {
    expect(
      (await call("PATCH", "/settings", { checkIntervalMinutes: value }))
        .status,
    ).toBe(200);
    expect(await (await call("GET", "/settings")).json()).toEqual({
      checkIntervalMinutes: value,
    });
  }
  expect(
    (await call("PATCH", "/settings", { checkIntervalMinutes: 30 })).status,
  ).toBe(400);
  expect(await (await call("GET", "/settings")).json()).toEqual({
    checkIntervalMinutes: 1440,
  });
  expect(
    await (await call("GET", "/settings", undefined, otherToken)).json(),
  ).toEqual({ checkIntervalMinutes: 360 });
});

test("주소를 정규화하고 중복·잘못된 입력·다른 소유자를 구분해요", async () => {
  const added = await call("POST", "/recipients", {
    email: " Reader+tag@Example.COM ",
  });
  expect(added.status).toBe(201);
  const recipient = await added.json<{
    id: string;
    email: string;
    verifiedAt: null;
  }>();
  expect(recipient).toMatchObject({
    email: "reader+tag@example.com",
    verifiedAt: null,
  });
  expect(
    (await call("POST", "/recipients", { email: recipient.email })).status,
  ).toBe(409);
  expect((await call("POST", "/recipients", { email: "invalid" })).status).toBe(
    400,
  );
  expect(
    (await call("POST", "/recipients", { email: recipient.email }, otherToken))
      .status,
  ).toBe(201);
  expect(
    (await call("DELETE", `/recipients/${recipient.id}`, undefined, otherToken))
      .status,
  ).toBe(404);
  expect((await call("DELETE", `/recipients/${recipient.id}`)).status).toBe(
    204,
  );
  expect(await (await call("GET", "/recipients")).json()).toEqual({
    items: [],
    nextCursor: null,
  });
});
