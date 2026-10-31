import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { createApp } from "../src/app";
import {
  claimAnalysis,
  enqueueAnalysis,
  failAnalysis,
  markAnalysisDispatched,
} from "../src/jobs/analysis";
import { runBackgroundJobs } from "../src/jobs/runner";

const now = 1_800_000_000;
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const token = "a".repeat(43);
const otherToken = "b".repeat(43);
const url = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const model = "gemini-3.6-flash";
const app = createApp();
const settings = { ...env, GEMINI_MODEL: model };
const sql = (query: string, ...values: (string | number | null)[]) =>
  env.DB.prepare(query).bind(...values);

async function session(userId: string, secret: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  await env.DB.batch([
    sql(
      "INSERT INTO users (id,email,nickname,password_hash,email_verified_at) VALUES (?,?,'독자','fixture',?)",
      userId,
      `${userId}@example.com`,
      now - 1,
    ),
    sql(
      "INSERT INTO sessions (id,user_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?)",
      crypto.randomUUID(),
      userId,
      Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
      now - 1,
      now + 3600,
    ),
  ]);
}

function request(
  path = "",
  init: RequestInit = {},
  secret = token,
  bindings = settings,
) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${secret}`);
  if (init.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  return app.request(
    `/v1/summary-requests${path}`,
    { ...init, headers },
    bindings,
  );
}

const post = (body: unknown = { url }, bindings = settings) =>
  request("", { method: "POST", body: JSON.stringify(body) }, token, bindings);

type Resource = {
  id: string;
  status: string;
  reportId: string | null;
  attempt: number;
  retryable: boolean;
};
const count = (table: string) =>
  sql(`SELECT count(*) AS count FROM ${table}`).first<number>("count");
const retryRequest = (
  id: string,
  attempt = 1,
  secret = token,
  bindings = settings,
) =>
  request(
    `/${id}/retry`,
    { method: "POST", body: JSON.stringify({ attempt }) },
    secret,
    bindings,
  );

async function failNext(code = "metadata_unavailable") {
  const claim = await claimAnalysis(env.DB, now);
  if (!claim) throw new Error("실패시킬 대기 분석이 필요해요.");
  if (code === "provider_outcome_unknown")
    await markAnalysisDispatched(env.DB, claim, now);
  await failAnalysis(env.DB, claim, code, now);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  vi.spyOn(Date, "now").mockReturnValue(now * 1000);
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("접수·조회에서 공급자를 호출하면 안 돼요."),
  );
  for (const table of [
    "delivery_attempts",
    "deliveries",
    "comments",
    "report_permissions",
    "reports",
    "summary_admissions",
    "analysis_attempts",
    "summary_requests",
    "analysis_jobs",
    "subscription_videos",
    "channel_subscriptions",
    "videos",
    "channels",
    "account_tokens",
    "recipients",
    "user_settings",
    "sessions",
    "users",
  ])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  await session(owner, token);
  await session(other, otherToken);
});

afterEach(() => vi.restoreAllMocks());

describe("직접 요약 HTTP 계약", () => {
  test("세션이 없는 요청은 로그인 안내와 캐시 금지 응답을 받아요", async () => {
    const response = await app.request(
      "/v1/summary-requests",
      undefined,
      settings,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  });

  test("접수는 공급자를 기다리지 않고 저장된 요청과 Location을 반환해요", async () => {
    const response = await post();
    expect(response.status).toBe(202);
    const body = await response.json<{ id: string }>();
    expect(response.headers.get("location")).toBe(
      `/v1/summary-requests/${body.id}`,
    );
    expect(body).toEqual({
      id: expect.any(String),
      videoId: "jNQXAC9IVRw",
      url,
      origin: "direct",
      status: "queued",
      attempt: 0,
      reportId: null,
      failureCode: null,
      retryable: false,
      createdAt: new Date(now * 1000).toISOString(),
      updatedAt: new Date(now * 1000).toISOString(),
    });
    expect(await (await request(`/${body.id}`)).json()).toEqual(body);
    expect(
      await sql("SELECT count(*) AS count FROM summary_requests").first(
        "count",
      ),
    ).toBe(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("타인 요청과 없는 요청은 같은 404이며 본인 목록만 보여요", async () => {
    const stored = await enqueueAnalysis(
      env.DB,
      { userId: owner, url, model },
      now,
    );
    const foreign = await request(`/${stored.id}`, {}, otherToken);
    const missing = await request(`/${crypto.randomUUID()}`, {}, otherToken);
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
    expect(await (await request("", {}, otherToken)).json()).toEqual({
      items: [],
      nextCursor: null,
    });
    const list = await (await request()).json<{ items: { id: string }[] }>();
    expect(list.items.map((item) => item.id)).toEqual([stored.id]);
    expect((await retryRequest(stored.id, 1, otherToken)).status).toBe(404);
  });

  test.each(["expired", "deleted", "unverified"])(
    "%s 세션은 요청을 읽거나 접수하지 못해요",
    async (state) => {
      if (state === "expired")
        await sql(
          "UPDATE sessions SET expires_at = ? WHERE user_id = ?",
          now,
          owner,
        ).run();
      if (state === "deleted")
        await sql("DELETE FROM sessions WHERE user_id = ?", owner).run();
      if (state === "unverified")
        await sql(
          "UPDATE users SET email_verified_at = NULL WHERE id = ?",
          owner,
        ).run();
      for (const response of [await request(), await post()]) {
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({
          error: { code: "AUTHENTICATION_REQUIRED" },
        });
      }
      expect(await count("summary_requests")).toBe(0);
    },
  );

  test.each(["", "short", "a".repeat(42), "c".repeat(43), "a".repeat(44)])(
    "잘못된 세션 %s를 거부해요",
    async (secret) => {
      expect((await request("", {}, secret)).status).toBe(401);
    },
  );

  test.each([
    null,
    [],
    {},
    { url: 42 },
    { url, userId: other },
    { url: "file:///private" },
    { url: `${url}\n${url}` },
  ])("잘못된 본문 %j를 저장·공급자 호출 전에 거부해요", async (body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "INVALID_INPUT" } });
    expect(await count("analysis_jobs")).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("깨진 JSON과 다른 content-type을 거부해요", async () => {
    expect((await request("", { method: "POST", body: "{" })).status).toBe(400);
    expect(
      (
        await request("", {
          method: "POST",
          body: JSON.stringify({ url }),
          headers: { "content-type": "text/plain" },
        })
      ).status,
    ).toBe(400);
  });

  test.each([false, true])(
    "Content-Length 존재 여부 %s와 무관하게 16 KiB 초과를 거부해요",
    async (withLength) => {
      const body = JSON.stringify({ url, padding: "한".repeat(6000) });
      const headers = new Headers();
      if (withLength)
        headers.set(
          "content-length",
          String(new TextEncoder().encode(body).length),
        );
      const response = await request("", { method: "POST", body, headers });
      expect(response.status).toBe(413);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        error: { code: "PAYLOAD_TOO_LARGE" },
      });
      expect(await count("analysis_jobs")).toBe(0);
    },
  );

  test("주소 변형을 동시에 접수해도 하나만 새 요청이며 다시 열면 같은 요청을 읽어요", async () => {
    const responses = await Promise.all(
      [
        url,
        "https://youtu.be/jNQXAC9IVRw?t=4",
        "https://www.youtube.com/shorts/jNQXAC9IVRw",
        url,
      ].map((value) => post({ url: value })),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 200, 200, 202,
    ]);
    const resources = await Promise.all(
      responses.map((response) => response.json<Resource>()),
    );
    expect(new Set(resources.map((item) => item.id)).size).toBe(1);
    const again = await post();
    expect(again.status).toBe(200);
    expect((await again.json<Resource>()).id).toBe(resources[0]?.id);
    expect(await count("analysis_jobs")).toBe(1);
    expect(await count("summary_admissions")).toBe(1);
    expect(await count("analysis_attempts")).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("계정 둘은 같은 실행에 합류하고 각자 요청으로 결과를 조회해요", async () => {
    const a = await (await post()).json<Resource>();
    const joined = await request(
      "",
      { method: "POST", body: JSON.stringify({ url }) },
      otherToken,
    );
    expect(joined.status).toBe(202);
    const b = await joined.json<Resource>();
    expect(b.id).not.toBe(a.id);
    expect(await count("analysis_jobs")).toBe(1);
    expect(await count("summary_admissions")).toBe(1);
    await runBackgroundJobs(settings, {
      now: () => now,
      metadata: async () => ({
        videoId: "jNQXAC9IVRw",
        url,
        title: "검사 영상",
        channel: "검사 채널",
        channelUrl: "https://www.youtube.com/@fixture",
        metadataSource: "https://www.youtube.com/oembed",
      }),
      generate: async () => ({
        markdown: "검사 보고서",
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
        timestampVerification: "unverified",
      }),
      send: vi.fn(async () => {
        throw new Error("직접 요약은 메일을 보내면 안 돼요.");
      }),
    });
    const completed = await (await request(`/${a.id}`)).json<Resource>();
    expect(completed.status).toBe("completed");
    expect(completed.reportId).not.toBeNull();
    expect(
      (await (await request(`/${b.id}`, {}, otherToken)).json<Resource>())
        .reportId,
    ).toBe(completed.reportId);
    expect(
      await sql(
        "SELECT channel_url FROM reports WHERE id = ?",
        completed.reportId,
      ).first("channel_url"),
    ).toBe("https://www.youtube.com/@fixture");
    expect(await count("report_permissions")).toBe(2);
    expect(await count("deliveries")).toBe(0);
    expect(
      await (
        await post(undefined, {
          ...settings,
          GEMINI_API_KEY: "",
        })
      ).json(),
    ).toEqual(completed);
    expect(await count("analysis_attempts")).toBe(1);
  });

  test("한도가 소진돼도 완성 보고서를 처음 읽는 계정에 개인 권한을 저장해요", async () => {
    const a = await (await post()).json<Resource>();
    const claim = await claimAnalysis(env.DB, now);
    if (!claim) throw new Error("실행권이 필요해요.");
    const { completeAnalysis } = await import("../src/jobs/analysis");
    await markAnalysisDispatched(env.DB, claim, now);
    await completeAnalysis(
      env.DB,
      claim,
      {
        title: "영상",
        channel: "채널",
        channelUrl: null,
        markdown: "본문",
        model,
        interactionId: "fixture",
        usage: null,
      },
      now,
    );
    const completed = await (await request(`/${a.id}`)).json<Resource>();
    for (const videoId of ["abcdefghijk", "0123456789_", "zzzzzzzzzzz"])
      expect(
        (
          await request(
            "",
            {
              method: "POST",
              body: JSON.stringify({ url: `https://youtu.be/${videoId}` }),
            },
            otherToken,
          )
        ).status,
      ).toBe(202);
    const response = await request(
      "",
      { method: "POST", body: JSON.stringify({ url }) },
      otherToken,
    );
    expect(response.status).toBe(200);
    expect((await response.json<Resource>()).reportId).toBe(completed.reportId);
    expect(await count("summary_admissions")).toBe(4);
    expect(await count("report_permissions")).toBe(2);
  });

  test("동시 접수에서도 일일 상한을 넘기지 않고 UTC 다음 날 다시 접수해요", async () => {
    const responses = await Promise.all(
      [
        url,
        "https://youtu.be/abcdefghijk",
        "https://youtu.be/0123456789_",
        "https://youtu.be/ABCDEFGHIJK",
      ].map((value) => post({ url: value })),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      202, 202, 202, 429,
    ]);
    const denied = responses.find((response) => response.status === 429);
    expect(denied?.headers.get("retry-after")).toBe(
      String(86_400 - (now % 86_400)),
    );
    expect(await denied?.json()).toEqual({
      error: { code: "USAGE_LIMIT_REACHED" },
    });
    expect(await count("analysis_jobs")).toBe(3);
    expect(await count("videos")).toBe(3);
    expect(await count("summary_admissions")).toBe(3);
    await sql("UPDATE sessions SET expires_at = ?", now + 172_800).run();
    vi.spyOn(Date, "now").mockReturnValue((now + 86_400) * 1_000);
    expect((await post({ url: "https://youtu.be/zzzzzzzzzzz" })).status).toBe(
      202,
    );
  });

  test.each([{ GEMINI_API_KEY: "" }, { GEMINI_MODEL: "unknown" }])(
    "준비되지 않은 설정 %j에서는 새 작업을 만들지 않아요",
    async (override) => {
      const response = await post(undefined, { ...settings, ...override });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: { code: "SUMMARY_UNAVAILABLE" },
      });
      expect(await count("summary_requests")).toBe(0);
      expect(await count("analysis_jobs")).toBe(0);
    },
  );

  test("재시도 응답이 유실돼도 한 번만 차감하고 오래된 시도로 다음 분석을 시작하지 않아요", async () => {
    const item = await (await post()).json<Resource>();
    await failNext();
    expect(
      (await (await request(`/${item.id}`)).json<Resource>()).retryable,
    ).toBe(true);
    const responses = await Promise.all([
      retryRequest(item.id),
      retryRequest(item.id),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 202,
    ]);
    expect(await count("summary_admissions")).toBe(2);
    await failNext();
    const stale = await retryRequest(item.id);
    expect(stale.status).toBe(200);
    expect(await stale.json()).toMatchObject({ status: "failed", attempt: 2 });
    expect(await count("summary_admissions")).toBe(2);
    expect((await retryRequest(item.id, 2)).status).toBe(202);
    await failNext();
    expect((await retryRequest(item.id, 3)).status).toBe(409);
    expect(await count("analysis_attempts")).toBe(3);
  });

  test("일일 상한에 도달한 실패는 재시도 불가로 조회되고 429에서 실행을 늘리지 않아요", async () => {
    const item = await (await post()).json<Resource>();
    await failNext();
    for (const videoId of ["abcdefghijk", "0123456789_"])
      expect((await post({ url: `https://youtu.be/${videoId}` })).status).toBe(
        202,
      );
    expect(
      (await (await request(`/${item.id}`)).json<Resource>()).retryable,
    ).toBe(false);
    expect((await retryRequest(item.id)).status).toBe(429);
    expect(await count("analysis_attempts")).toBe(1);
    expect(await count("summary_admissions")).toBe(3);
  });

  test.each(["quota", "configuration", "provider_outcome_unknown"])(
    "%s 실패는 읽을 수 있지만 재호출하지 않아요",
    async (code) => {
      const item = await (await post()).json<Resource>();
      await failNext(code);
      const response = await request(`/${item.id}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: "failed",
        failureCode: code,
        retryable: false,
      });
      expect((await retryRequest(item.id)).status).toBe(409);
      expect((await post()).status).toBe(200);
      expect(await count("analysis_attempts")).toBe(1);
    },
  );

  test("같은 초의 요청도 cursor로 중복 없이 나누고 계정·상태 필터를 유지해요", async () => {
    const ids: string[] = [];
    for (const videoId of ["jNQXAC9IVRw", "abcdefghijk", "0123456789_"])
      ids.push(
        (
          await (
            await post({ url: `https://youtu.be/${videoId}` })
          ).json<Resource>()
        ).id,
      );
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await request(
        `?limit=1&status=queued${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(response.status).toBe(200);
      const page = await response.json<{
        items: Resource[];
        nextCursor: string | null;
      }>();
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      expect(seen.length).toBeLessThanOrEqual(3);
    } while (cursor);
    expect(seen).toEqual(ids.sort().reverse());
    expect(await (await request("?status=failed")).json()).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  test.each([
    "?limit=0",
    "?limit=101",
    "?limit=1.5",
    "?limit=",
    "?limit=1&limit=2",
    "?status=bad",
    "?userId=other",
    "?cursor=not-json",
    "?cursor=e30",
    "?cursor=",
  ])("잘못된 query %s를 거부해요", async (query) => {
    const response = await request(query);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "INVALID_INPUT" } });
  });

  test("저장 실패는 내부 내용을 숨기고 접수·한도 차감을 모두 되돌려요", async () => {
    await env.DB.exec(
      "CREATE TRIGGER reject_admission BEFORE INSERT ON summary_admissions BEGIN SELECT RAISE(ABORT, 'private-storage-error'); END;",
    );
    try {
      const response = await post();
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: { code: "INTERNAL_ERROR" },
      });
      expect(await count("analysis_jobs")).toBe(0);
      expect(await count("summary_admissions")).toBe(0);
      expect(await count("summary_requests")).toBe(0);
    } finally {
      await env.DB.exec("DROP TRIGGER reject_admission");
    }
  });

  test("중지한 채널 요청은 직접 요청으로 바꾸거나 재시도 비용을 차감하지 않아요", async () => {
    await env.DB.batch([
      sql(
        "INSERT INTO channels (id,youtube_channel_id,title,url) VALUES ('channel','UC_fixture','채널','https://www.youtube.com/@fixture')",
      ),
      sql(
        "INSERT INTO videos (id,channel_id) VALUES ('jNQXAC9IVRw','channel')",
      ),
      sql(
        "INSERT INTO channel_subscriptions (id,user_id,channel_id,baseline_initialized_at) VALUES ('sub',?,'channel',?)",
        owner,
        now - 1,
      ),
      sql(
        "INSERT INTO subscription_videos (subscription_id,video_id,is_baseline) VALUES ('sub','jNQXAC9IVRw',0)",
      ),
      sql(
        "INSERT INTO recipients (id,user_id,email,verified_at) VALUES ('recipient',?,'reader@example.com',?)",
        owner,
        now,
      ),
    ]);
    const stored = await enqueueAnalysis(
      env.DB,
      { userId: owner, url, model, subscriptionId: "sub" },
      now,
    );
    await failNext();
    await sql("UPDATE channel_subscriptions SET status = 'paused'").run();
    expect(await (await request(`/${stored.id}`)).json()).toMatchObject({
      origin: "channel",
      status: "failed",
      retryable: false,
    });
    expect((await retryRequest(stored.id)).status).toBe(409);
    expect(await (await post()).json()).toMatchObject({
      id: stored.id,
      origin: "channel",
      status: "failed",
    });
    expect(await count("summary_admissions")).toBe(0);
    expect(await count("analysis_attempts")).toBe(1);
  });
});
