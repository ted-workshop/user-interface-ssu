import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createApp } from "../src/app";
import { enqueueAnalysis } from "../src/jobs/analysis";
import {
  claimDelivery,
  completeDelivery,
  enqueueDelivery,
  failDelivery,
  markDeliveryDispatched,
} from "../src/jobs/delivery";
import { runBackgroundJobs } from "../src/jobs/runner";
import { hashPassword } from "../src/password";

const now = 1_800_000_000;
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const token = "a".repeat(43);
const otherToken = "b".repeat(43);
const model = "gemini-3.6-flash";
const missingId = "33333333-3333-4333-8333-333333333333";
const app = createApp();
const settings = { ...env, GEMINI_MODEL: model };
const sql = (query: string, ...values: (string | number | null)[]) =>
  env.DB.prepare(query).bind(...values);
const videoUrl = (videoId: string) =>
  `https://www.youtube.com/watch?v=${videoId}`;
const videoIds = ["jNQXAC9IVRw", "dQw4w9WgXcQ", "9bZkp7q19f0"] as const;

type Report = {
  id: string;
  videoId: string;
  url: string;
  title: string;
  channelName: string;
  channelUrl: string | null;
  bodyMarkdown?: string;
  model: string;
  timestampVerification: string;
  createdAt: string;
  viewerContext: {
    requestId: string;
    origin: string;
    deliveryStatus: string;
    savedAt: string;
  } | null;
};
type ReportList = { items: Report[]; nextCursor: string | null };

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

const request = (path = "", secret: string | null = token) =>
  app.request(
    `/v1/reports${path}`,
    secret ? { headers: { authorization: `Bearer ${secret}` } } : {},
    settings,
  );

// 공급자만 fixture로 바꾸고 접수·실행·저장은 실제 작업 흐름을 그대로 사용해요.
// 영상별 제목·채널을 바꿔 검색과 필터를 검사해요.
let metadataByVideo: Record<
  string,
  { title?: string; channel?: string; channelUrl?: string | null }
> = {};
const runJobs = (at: number) =>
  runBackgroundJobs(settings, {
    now: () => at,
    metadata: async (url: string) => ({
      videoId: new URL(url).searchParams.get("v") ?? "",
      url,
      title: "검사 영상",
      channel: "검사 채널",
      channelUrl: "https://www.youtube.com/@fixture",
      metadataSource: "https://www.youtube.com/oembed",
      ...metadataByVideo[new URL(url).searchParams.get("v") ?? ""],
    }),
    generate: async () => ({
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
    }),
    send: vi.fn(async () => {
      throw new Error("이 검사에서는 메일을 보내지 않아요.");
    }),
  });

async function saveReport(userId: string, videoId: string, at: number) {
  const saved = await enqueueAnalysis(
    env.DB,
    { userId, url: videoUrl(videoId), model },
    at,
  );
  await runJobs(at);
  return saved.id;
}

const list = async (path = "", secret = token) => {
  const response = await request(path, secret);
  expect(response.status).toBe(200);
  return response.json<ReportList>();
};

// 채널 자동 요청과 수신 주소를 만들고, 앞에서부터 deliveries개의 대기 발송을 넣어요.
async function channelReport(recipients: number, deliveries = recipients) {
  const videoId = videoIds[0];
  await env.DB.batch([
    sql(
      "INSERT INTO channels (id,youtube_channel_id,title,url) VALUES ('channel','UC_fixture','채널','https://www.youtube.com/channel/UC_fixture')",
    ),
    sql("INSERT INTO videos (id,channel_id) VALUES (?,'channel')", videoId),
    sql(
      "INSERT INTO channel_subscriptions (id,user_id,channel_id,baseline_initialized_at) VALUES ('sub',?,'channel',?)",
      owner,
      now - 1,
    ),
    sql(
      "INSERT INTO subscription_videos (subscription_id,video_id,is_baseline) VALUES ('sub',?,0)",
      videoId,
    ),
    ...Array.from({ length: recipients }, (_, index) =>
      sql(
        "INSERT INTO recipients (id,user_id,email,verified_at) VALUES (?,?,?,?)",
        `recipient-${index}`,
        owner,
        `receiver-${index}@example.com`,
        now,
      ),
    ),
  ]);
  const requested = await enqueueAnalysis(
    env.DB,
    {
      userId: owner,
      url: videoUrl(videoId),
      model,
      subscriptionId: "sub",
    },
    now,
  );
  await runJobs(now);
  for (let index = 0; index < deliveries; index += 1)
    await enqueueDelivery(
      env.DB,
      owner,
      requested.id,
      `recipient-${index}`,
      now,
    );
}

async function claim() {
  const claimed = await claimDelivery(env.DB, now);
  if (!claimed) throw new Error("대기 중인 발송이 필요해요.");
  return claimed;
}

async function send(outcome: "sent" | "failed" | "ambiguous") {
  const claimed = await claim();
  await markDeliveryDispatched(env.DB, claimed, now);
  if (outcome === "sent") await completeDelivery(env.DB, claimed, now);
  else
    await failDelivery(
      env.DB,
      claimed,
      outcome === "failed" ? "permanent" : "ambiguous",
      now,
    );
}

const firstStatus = async () =>
  (await list()).items[0]?.viewerContext?.deliveryStatus;

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  metadataByVideo = {};
  vi.spyOn(Date, "now").mockReturnValue(now * 1000);
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

afterEach(() => {
  vi.restoreAllMocks();
});

test("로그인하지 않으면 목록과 상세를 읽을 수 없어요", async () => {
  for (const path of ["", `/${missingId}`]) {
    const response = await request(path, null);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
  }
});

test("저장한 리포트가 없으면 빈 목록을 돌려줘요", async () => {
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ items: [], nextCursor: null });
});

test("상세는 공통 보고서와 내 보관 정보를 계약 형식으로 돌려줘요", async () => {
  const requestId = await saveReport(owner, videoIds[0], now);
  const [item] = (await list()).items;
  const response = await request(`/${item?.id}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    id: item?.id,
    videoId: videoIds[0],
    url: videoUrl(videoIds[0]),
    title: "검사 영상",
    channelName: "검사 채널",
    channelUrl: "https://www.youtube.com/@fixture",
    bodyMarkdown: "검사 보고서 본문",
    model,
    timestampVerification: "unverified",
    createdAt: new Date(now * 1000).toISOString(),
    viewerContext: {
      requestId,
      origin: "direct",
      deliveryStatus: "not_applicable",
      savedAt: new Date(now * 1000).toISOString(),
    },
  });
});

test("목록은 본문을 빼고 상세의 나머지 값과 같게 돌려줘요", async () => {
  await saveReport(owner, videoIds[0], now);
  const [item] = (await list()).items;
  expect(item).not.toHaveProperty("bodyMarkdown");
  const detail = await (await request(`/${item?.id}`)).json<Report>();
  const { bodyMarkdown: _body, ...withoutBody } = detail;
  expect(item).toEqual(withoutBody);
});

test("리포트를 다시 읽어도 새 작업이나 보관 관계를 만들지 않아요", async () => {
  await saveReport(owner, videoIds[0], now);
  const counts = () =>
    sql(
      `SELECT (SELECT count(*) FROM analysis_jobs) AS jobs,
      (SELECT count(*) FROM analysis_attempts) AS attempts,
      (SELECT count(*) FROM summary_requests) AS requests,
      (SELECT count(*) FROM summary_admissions) AS admissions,
      (SELECT count(*) FROM report_permissions) AS permissions`,
    ).first();
  const before = await counts();
  const [item] = (await list()).items;
  await request(`/${item?.id}`);
  await list();
  expect(await counts()).toEqual(before);
});

test("A의 보관함에 B의 리포트가 섞이지 않고 권한 없는 상세는 없는 ID와 같아요", async () => {
  await saveReport(owner, videoIds[0], now);
  const [item] = (await list()).items;
  expect((await list("", otherToken)).items).toEqual([]);
  const forbidden = await request(`/${item?.id}`, otherToken);
  const missing = await request(`/${missingId}`, otherToken);
  expect(forbidden.status).toBe(404);
  expect(missing.status).toBe(404);
  expect(await forbidden.text()).toBe(await missing.text());
});

test("같은 영상을 요약한 두 사용자는 같은 보고서와 각자의 요청을 봐요", async () => {
  const a = await saveReport(owner, videoIds[0], now);
  const b = await saveReport(other, videoIds[0], now + 10);
  const [mine] = (await list()).items;
  const [theirs] = (await list("", otherToken)).items;
  expect(theirs?.id).toBe(mine?.id);
  expect(mine?.viewerContext?.requestId).toBe(a);
  expect(theirs?.viewerContext?.requestId).toBe(b);
  expect(mine?.viewerContext?.savedAt).toBe(new Date(now * 1000).toISOString());
  expect(theirs?.viewerContext?.savedAt).toBe(
    new Date((now + 10) * 1000).toISOString(),
  );
});

test("공개 규칙으로 읽은 리포트는 내 정보 없이 보이고 보관함에 들어가지 않아요", async () => {
  await saveReport(owner, videoIds[0], now);
  const [item] = (await list()).items;
  await sql(
    "INSERT INTO report_permissions (id,report_id,audience,user_id,can_read,can_comment) VALUES (?,?,'authenticated',NULL,1,1)",
    crypto.randomUUID(),
    item?.id ?? "",
  ).run();
  const response = await request(`/${item?.id}`, otherToken);
  expect(response.status).toBe(200);
  const detail = await response.json<Report>();
  expect(detail.viewerContext).toBeNull();
  expect(detail.bodyMarkdown).toBe("검사 보고서 본문");
  expect((await list("", otherToken)).items).toEqual([]);
  // 공개 규칙이 있어도 소유자의 보관 정보는 그대로예요.
  const mine = await (await request(`/${item?.id}`)).json<Report>();
  expect(mine.viewerContext?.origin).toBe("direct");
});

test("본인 보관 관계를 지우면 공개되지 않은 리포트는 더 읽을 수 없어요", async () => {
  await saveReport(owner, videoIds[0], now);
  const [item] = (await list()).items;
  await sql(
    "DELETE FROM report_permissions WHERE user_id = ? AND audience = 'user'",
    owner,
  ).run();
  expect((await list()).items).toEqual([]);
  expect((await request(`/${item?.id}`)).status).toBe(404);
});

test("본인 보관 관계를 지워도 공개 리포트는 내 정보 없이 읽어요", async () => {
  await saveReport(owner, videoIds[0], now);
  const [item] = (await list()).items;
  await env.DB.batch([
    sql(
      "INSERT INTO report_permissions (id,report_id,audience,user_id,can_read,can_comment) VALUES (?,?,'authenticated',NULL,1,1)",
      crypto.randomUUID(),
      item?.id ?? "",
    ),
    sql(
      "DELETE FROM report_permissions WHERE user_id = ? AND audience = 'user'",
      owner,
    ),
  ]);
  const response = await request(`/${item?.id}`);
  expect(response.status).toBe(200);
  expect((await response.json<Report>()).viewerContext).toBeNull();
  expect((await list()).items).toEqual([]);
});

test("목록은 보관 시각 최신순이고 페이지 사이에 누락과 중복이 없어요", async () => {
  await saveReport(owner, videoIds[0], now);
  await saveReport(owner, videoIds[1], now + 10);
  await saveReport(owner, videoIds[2], now + 20);
  const first = await list("?limit=2");
  expect(first.items.map((item) => item.videoId)).toEqual([
    videoIds[2],
    videoIds[1],
  ]);
  expect(first.nextCursor).not.toBeNull();
  const second = await list(`?limit=2&cursor=${first.nextCursor}`);
  expect(second.items.map((item) => item.videoId)).toEqual([videoIds[0]]);
  expect(second.nextCursor).toBeNull();
});

test("보관 시각이 같으면 보고서 ID 내림차순으로 끊김 없이 이어져요", async () => {
  await saveReport(owner, videoIds[0], now);
  await saveReport(owner, videoIds[1], now);
  await saveReport(owner, videoIds[2], now);
  const expected = (await list()).items.map((item) => item.id);
  expect(expected).toEqual([...expected].sort().reverse());
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const page: ReportList = await list(
      `?limit=1${cursor ? `&cursor=${cursor}` : ""}`,
    );
    seen.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
  } while (cursor);
  expect(seen).toEqual(expected);
});

test("채널 리포트에 발송 대상이 없으면 not_applicable이에요", async () => {
  await channelReport(1, 0);
  const [item] = (await list()).items;
  expect(item?.viewerContext?.origin).toBe("channel");
  expect(item?.viewerContext?.deliveryStatus).toBe("not_applicable");
});

test("채널 발송이 대기 중이면 pending, 모두 성공하면 sent예요", async () => {
  await channelReport(2);
  expect(await firstStatus()).toBe("pending");
  await send("sent");
  expect(await firstStatus()).toBe("pending");
  await send("sent");
  expect(await firstStatus()).toBe("sent");
});

test("주소 하나라도 실패하거나 결과가 불명확하면 failed예요", async () => {
  await channelReport(2);
  await send("sent");
  await send("failed");
  expect(await firstStatus()).toBe("failed");
});

test("SMTP 접수 여부가 불명확한 발송도 failed로 보여줘요", async () => {
  await channelReport(1);
  await send("ambiguous");
  expect(await firstStatus()).toBe("failed");
});

const stopRecipient = (index: number) =>
  sql(
    "UPDATE recipients SET deleted_at = ? WHERE id = ?",
    now,
    `recipient-${index}`,
  ).run();

test("취소된 발송은 빼고 나머지 결과로 계산해요", async () => {
  await channelReport(2);
  await stopRecipient(0);
  expect(await firstStatus()).toBe("pending");
  await send("sent");
  expect(await firstStatus()).toBe("sent");
});

test("발송이 전부 취소되면 not_applicable이에요", async () => {
  await channelReport(1);
  await stopRecipient(0);
  expect(await firstStatus()).toBe("not_applicable");
});

test("다른 사용자의 발송 결과는 내 상태에 섞이지 않아요", async () => {
  await channelReport(1);
  await send("failed");
  await saveReport(other, videoIds[0], now + 1);
  const [theirs] = (await list("", otherToken)).items;
  expect(theirs?.viewerContext?.origin).toBe("direct");
  expect(theirs?.viewerContext?.deliveryStatus).toBe("not_applicable");
});

test.each([
  "?limit=0",
  "?limit=101",
  "?limit=abc",
  "?limit=1.5",
  "?limit=",
  "?limit=1&limit=2",
  "?cursor=not-a-cursor",
  `?cursor=${btoa('{"createdAt":1}')}`,
  "?unknown=1",
  "?q=",
  "?q=%20%20",
  `?q=${"가".repeat(101)}`,
  "?q=a&q=b",
  "?channelUrl=",
  "?origin=unknown",
  "?deliveryStatus=cancelled",
])("잘못된 목록 입력 %s은 400이에요", async (query) => {
  const response = await request(query);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: { code: "INVALID_INPUT" } });
});

async function saveTitled() {
  metadataByVideo = {
    [videoIds[0]]: {
      title: "Gemini 100% 활용법",
      channelUrl: "https://www.youtube.com/@one",
    },
    [videoIds[1]]: {
      title: "under_score 정리",
      channelUrl: "https://www.youtube.com/@two",
    },
    [videoIds[2]]: { title: "백슬래시 a\\b 설명", channelUrl: null },
  };
  await saveReport(owner, videoIds[0], now);
  await saveReport(owner, videoIds[1], now + 10);
  await saveReport(owner, videoIds[2], now + 20);
}

const found = async (query: string) =>
  (await list(query)).items.map((item) => item.videoId);

test("제목 부분 검색은 대소문자를 가리지 않고 앞뒤 공백을 무시해요", async () => {
  await saveTitled();
  expect(await found("?q=gemini")).toEqual([videoIds[0]]);
  expect(await found("?q=%20%ED%99%9C%EC%9A%A9%20")).toEqual([videoIds[0]]);
  expect(await found("?q=없는제목")).toEqual([]);
});

test("검색어의 %·_·역슬래시는 wildcard가 아닌 문자예요", async () => {
  await saveTitled();
  expect(await found("?q=100%25")).toEqual([videoIds[0]]);
  expect(await found("?q=%25")).toEqual([videoIds[0]]);
  expect(await found("?q=_")).toEqual([videoIds[1]]);
  expect(await found("?q=a%5Cb")).toEqual([videoIds[2]]);
});

test("채널은 저장된 URL과 정확히 같을 때만 찾아요", async () => {
  await saveTitled();
  const one = encodeURIComponent("https://www.youtube.com/@one");
  expect(await found(`?channelUrl=${one}`)).toEqual([videoIds[0]]);
  const prefix = encodeURIComponent("https://www.youtube.com/@");
  expect(await found(`?channelUrl=${prefix}`)).toEqual([]);
});

test("생성 경로로 직접 요약과 채널 자동을 나눠요", async () => {
  await channelReport(1, 0);
  await saveReport(owner, videoIds[1], now + 10);
  expect(await found("?origin=direct")).toEqual([videoIds[1]]);
  expect(await found("?origin=channel")).toEqual([videoIds[0]]);
});

test("발송 상태 필터는 응답의 상태 계산과 같아요", async () => {
  // 다음 실행기가 대기 발송을 처리하지 않도록 직접 요약을 먼저 저장해요.
  await saveReport(owner, videoIds[1], now);
  await channelReport(1);
  expect(await found("?deliveryStatus=pending")).toEqual([videoIds[0]]);
  expect(await found("?deliveryStatus=not_applicable")).toEqual([videoIds[1]]);
  await send("sent");
  expect(await found("?deliveryStatus=sent")).toEqual([videoIds[0]]);
  expect(await found("?deliveryStatus=pending")).toEqual([]);
});

test("여러 조건은 모두 만족해야 하고 페이지 사이에 누락과 중복이 없어요", async () => {
  await saveTitled();
  expect(await found("?q=gemini&origin=channel")).toEqual([]);
  expect(await found("?q=gemini&origin=direct")).toEqual([videoIds[0]]);
  const first = await list("?origin=direct&limit=2");
  expect(first.items.map((item) => item.videoId)).toEqual([
    videoIds[2],
    videoIds[1],
  ]);
  const second = await list(
    `?origin=direct&limit=2&cursor=${first.nextCursor}`,
  );
  expect(second.items.map((item) => item.videoId)).toEqual([videoIds[0]]);
  expect(second.nextCursor).toBeNull();
});

test("검색은 내 보관함 안에서만 찾고 결과가 없어도 빈 목록이에요", async () => {
  await saveTitled();
  const response = await request("?q=gemini", otherToken);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ items: [], nextCursor: null });
});

test("검색과 필터는 새 작업이나 보관 관계를 만들지 않아요", async () => {
  await saveTitled();
  const counts = () =>
    sql(
      `SELECT (SELECT count(*) FROM analysis_jobs) AS jobs,
      (SELECT count(*) FROM summary_requests) AS requests,
      (SELECT count(*) FROM report_permissions) AS permissions`,
    ).first();
  const before = await counts();
  await list("?q=gemini&origin=direct&deliveryStatus=not_applicable");
  expect(await counts()).toEqual(before);
});

test("실제 로그인으로 받은 세션으로 다시 로그인해도 저장한 리포트를 읽어요", async () => {
  const email = "relogin@example.com";
  const password = "relogin password";
  const userId = "44444444-4444-4444-8444-444444444444";
  await sql(
    "INSERT INTO users (id,email,nickname,password_hash,email_verified_at) VALUES (?,?,'독자',?,?)",
    userId,
    email,
    await hashPassword(password),
    now - 1,
  ).run();
  const login = async () => {
    const response = await app.request(
      "/v1/auth/sessions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.10",
        },
        body: JSON.stringify({ email, password }),
      },
      settings,
    );
    expect(response.status).toBe(201);
    return (await response.json<{ sessionToken: string }>()).sessionToken;
  };
  metadataByVideo = { [videoIds[0]]: { title: "다시 읽을 리포트" } };
  await saveReport(userId, videoIds[0], now);

  const first = await login();
  const [saved] = (await list("", first)).items;
  expect(saved?.title).toBe("다시 읽을 리포트");
  const out = await app.request(
    "/v1/auth/session",
    { method: "DELETE", headers: { authorization: `Bearer ${first}` } },
    settings,
  );
  expect(out.status).toBe(204);
  expect((await request("", first)).status).toBe(401);

  const second = await login();
  expect((await list("", second)).items.map((item) => item.id)).toEqual([
    saved?.id,
  ]);
  const detail = await request(`/${saved?.id}`, second);
  expect(detail.status).toBe(200);
  expect((await detail.json<Report>()).bodyMarkdown).toBe("검사 보고서 본문");
});

test("채널을 삭제해도 그 채널에서 만든 리포트는 보관함에 남아요", async () => {
  await channelReport(1);
  const [before] = (await list()).items;
  await sql(
    "UPDATE channel_subscriptions SET status = 'deleted' WHERE id = 'sub'",
  ).run();
  const after = await list("?origin=channel");
  expect(after.items.map((item) => item.id)).toEqual([before?.id]);
  expect((await request(`/${before?.id}`)).status).toBe(200);
});

test("잘못된 상세 입력은 400이에요", async () => {
  for (const path of ["/not-a-uuid", `/${missingId}?extra=1`]) {
    const response = await request(path);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "INVALID_INPUT" } });
  }
});
