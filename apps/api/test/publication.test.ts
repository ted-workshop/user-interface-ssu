import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createApp } from "../src/app";
import { enqueueAnalysis } from "../src/jobs/analysis";
import { runBackgroundJobs } from "../src/jobs/runner";

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
const videoIds = ["jNQXAC9IVRw", "dQw4w9WgXcQ", "9bZkp7q19f0"] as const;

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

const call = (method: string, path: string, secret = token) =>
  app.request(
    `/v1/reports${path}`,
    { method, headers: { authorization: `Bearer ${secret}` } },
    settings,
  );

type Publication = {
  published: boolean;
  publishedAt: string | null;
  isPublisher: boolean;
};

async function publish(reportId: string, secret = token, at = now) {
  vi.spyOn(Date, "now").mockReturnValue(at * 1000);
  const response = await call("PUT", `/${reportId}/publication`, secret);
  expect(response.status).toBe(200);
  return response.json<Publication>();
}

const revoke = (reportId: string, secret = token) =>
  call("DELETE", `/${reportId}/publication`, secret);
const readStatus = async (reportId: string, secret = otherToken) =>
  (await call("GET", `/${reportId}`, secret)).status;
const leave = (reportId: string, userId: string) =>
  sql(
    "DELETE FROM report_permissions WHERE report_id = ? AND user_id = ? AND audience = 'user'",
    reportId,
    userId,
  ).run();
const comment = (reportId: string, userId: string) =>
  sql(
    "INSERT INTO comments (id, report_id, user_id, body) VALUES (?, ?, ?, '생각을 나눠요')",
    crypto.randomUUID(),
    reportId,
    userId,
  ).run();
const visibleComments = async (reportId: string) =>
  sql(
    "SELECT count(*) AS n FROM comments WHERE report_id = ? AND archived_at IS NULL AND deleted_at IS NULL",
    reportId,
  ).first("n");

// 공급자만 fixture로 바꾸고 접수·실행·저장은 실제 작업 흐름을 그대로 사용해요.
async function saveReport(userId: string, videoId: string) {
  await enqueueAnalysis(
    env.DB,
    { userId, url: `https://www.youtube.com/watch?v=${videoId}`, model },
    now,
  );
  await runBackgroundJobs(settings, {
    now: () => now,
    metadata: async (url: string) => ({
      videoId: new URL(url).searchParams.get("v") ?? "",
      url,
      title: `영상 ${videoId}`,
      channel: "검사 채널",
      channelUrl: "https://www.youtube.com/@fixture",
      metadataSource: "https://www.youtube.com/oembed",
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
  const row = await sql(
    "SELECT r.id FROM reports r JOIN analysis_jobs j ON j.id = r.analysis_job_id WHERE j.video_id = ?",
    videoId,
  ).first<{ id: string }>();
  if (!row) throw new Error("보고서를 저장하지 못했어요.");
  return row.id;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  vi.spyOn(Date, "now").mockReturnValue(now * 1000);
  for (const table of [
    "collection_items",
    "collections",
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

test("공개하면 다른 사용자가 읽고 공개한 사람이 철회하면 다시 볼 수 없어요", async () => {
  const reportId = await saveReport(owner, videoIds[0]);
  expect(await readStatus(reportId)).toBe(404);
  expect(await publish(reportId)).toEqual({
    published: true,
    publishedAt: new Date(now * 1000).toISOString(),
    isPublisher: true,
  });
  expect(await readStatus(reportId)).toBe(200);
  expect((await revoke(reportId)).status).toBe(204);
  expect(await readStatus(reportId)).toBe(404);
  // 이미 닫힌 공개를 다시 철회해도 같은 결과예요.
  expect((await revoke(reportId)).status).toBe(204);
});

test("이미 공개된 리포트를 공개하면 순번이 되고 공개한 사람만 전체를 닫아요", async () => {
  const reportId = await saveReport(owner, videoIds[0]);
  await saveReport(other, videoIds[0]);
  await publish(reportId);
  const queued = await publish(reportId, otherToken, now + 5);
  expect(queued).toEqual({
    published: true,
    publishedAt: new Date(now * 1000).toISOString(),
    isPublisher: false,
  });
  const denied = await revoke(reportId, otherToken);
  expect(denied.status).toBe(403);
  expect(await denied.json()).toEqual({
    error: { code: "PUBLICATION_FORBIDDEN" },
  });
  expect((await revoke(reportId)).status).toBe(204);
  expect((await publish(reportId, otherToken, now + 10)).isPublisher).toBe(
    true,
  );
});

test("공개한 사람이 보관함에서 빼면 다음 순번이 철회 권한을 받고 공개 시각은 유지돼요", async () => {
  const reportId = await saveReport(owner, videoIds[0]);
  await saveReport(other, videoIds[0]);
  await publish(reportId);
  await publish(reportId, otherToken, now + 5);
  await leave(reportId, owner);
  const state = await publish(reportId, otherToken, now + 9);
  expect(state).toEqual({
    published: true,
    publishedAt: new Date(now * 1000).toISOString(),
    isPublisher: true,
  });
  expect((await revoke(reportId, otherToken)).status).toBe(204);
});

test("순번 없이 공개가 사라지면 다시 공개할 때 이전 댓글 없이 새로 시작해요", async () => {
  const reportId = await saveReport(owner, videoIds[0]);
  await saveReport(other, videoIds[0]);
  await publish(reportId);
  await comment(reportId, other);
  await leave(reportId, owner);
  expect(await readStatus(reportId, otherToken)).toBe(200);
  expect(
    await sql(
      "SELECT count(*) AS n FROM report_permissions WHERE report_id = ? AND audience = 'authenticated'",
      reportId,
    ).first("n"),
  ).toBe(0);
  expect(await visibleComments(reportId)).toBe(0);
  expect(
    await sql(
      "SELECT count(*) AS n FROM comments WHERE report_id = ?",
      reportId,
    ).first("n"),
  ).toBe(1);
  const reopened = await publish(reportId, otherToken, now + 30);
  expect(reopened.publishedAt).toBe(new Date((now + 30) * 1000).toISOString());
  expect(await visibleComments(reportId)).toBe(0);
});

test("직접 철회하면 댓글은 남고 다시 공개하면 그대로 보여요", async () => {
  const reportId = await saveReport(owner, videoIds[0]);
  await publish(reportId);
  await comment(reportId, owner);
  expect((await revoke(reportId)).status).toBe(204);
  await publish(reportId, token, now + 20);
  expect(await visibleComments(reportId)).toBe(1);
});

test("보관함에 없는 리포트는 공개하거나 철회할 수 없어요", async () => {
  const reportId = await saveReport(owner, videoIds[0]);
  await publish(reportId);
  for (const method of ["PUT", "DELETE"]) {
    const response = await call(method, `/${reportId}/publication`, otherToken);
    expect(response.status).toBe(404);
  }
  expect((await call("PUT", `/${missingId}/publication`)).status).toBe(404);
  expect((await call("PUT", "/not-a-uuid/publication")).status).toBe(400);
});

test("DB는 공개 규칙 행의 순번 기록과 숨긴 댓글 되돌리기를 거부해요", async () => {
  const reportId = await saveReport(owner, videoIds[0]);
  await publish(reportId);
  await expect(
    sql(
      "UPDATE report_permissions SET publish_requested_at = 1 WHERE report_id = ? AND audience = 'authenticated'",
      reportId,
    ).run(),
  ).rejects.toThrow(/publish_request_user_rule_required/);
  await comment(reportId, owner);
  await sql(
    "UPDATE comments SET deleted_at = 1 WHERE report_id = ?",
    reportId,
  ).run();
  await expect(
    sql(
      "UPDATE comments SET deleted_at = NULL WHERE report_id = ?",
      reportId,
    ).run(),
  ).rejects.toThrow(/comment_hidden_final/);
  await expect(
    sql(
      "UPDATE comments SET body = '바꾼 댓글' WHERE report_id = ?",
      reportId,
    ).run(),
  ).rejects.toThrow(/comment_immutable/);
});

const api = (method: string, path: string, body?: unknown, secret = token) =>
  app.request(
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

type PublicReport = {
  id: string;
  title: string;
  publishedAt: string;
  commentCount: number;
};
type CommentItem = {
  id: string;
  reportId: string;
  body: string;
  author: { nickname: string };
  createdAt: string;
  canDelete: boolean;
};

async function publicList(query = "", secret = otherToken) {
  const response = await api(
    "GET",
    `/public-reports${query}`,
    undefined,
    secret,
  );
  expect(response.status).toBe(200);
  return response.json<{ items: PublicReport[]; nextCursor: string | null }>();
}

async function write(
  reportId: string,
  body: string,
  secret = otherToken,
  at = now,
) {
  vi.spyOn(Date, "now").mockReturnValue(at * 1000);
  return api("POST", `/reports/${reportId}/comments`, { body }, secret);
}

test("공개 목록은 공개 시각 최신순이고 비공개 리포트는 나오지 않아요", async () => {
  const first = await saveReport(owner, videoIds[0]);
  const second = await saveReport(owner, videoIds[1]);
  await saveReport(owner, videoIds[2]);
  await publish(second, token, now + 1);
  await publish(first, token, now + 2);
  const page = await publicList("?limit=1");
  expect(page.items.map((item) => item.id)).toEqual([first]);
  const next = await publicList(`?limit=1&cursor=${page.nextCursor}`);
  expect(next.items.map((item) => item.id)).toEqual([second]);
  expect(next.nextCursor).toBeNull();
  expect(Object.keys(page.items[0] ?? {})).not.toContain("viewerContext");
  // 공개 리포트 상세는 보관함과 같은 리포트 상세 경로로 읽어요.
  const detail = await api("GET", `/reports/${first}`, undefined, otherToken);
  expect(detail.status).toBe(200);
  expect(await detail.json()).toMatchObject({
    bodyMarkdown: "검사 보고서 본문",
    viewerContext: null,
  });
  await revoke(first);
  expect(
    (await api("GET", `/reports/${first}`, undefined, otherToken)).status,
  ).toBe(404);
  expect((await publicList()).items.map((item) => item.id)).toEqual([second]);
});

test("공개 목록은 제목이나 채널명으로 찾아요", async () => {
  const reportId = await saveReport(owner, videoIds[0]);
  await saveReport(owner, videoIds[1]);
  await publish(reportId);
  expect(
    (await publicList(`?q=${videoIds[0]}`)).items.map((item) => item.id),
  ).toEqual([reportId]);
  expect((await publicList("?q=검사%20채널")).items).toHaveLength(1);
  expect((await publicList(`?q=${videoIds[1]}`)).items).toEqual([]);
  expect(
    (await api("GET", "/public-reports?q=%20", undefined, otherToken)).status,
  ).toBe(400);
});

test("공개 리포트에 댓글을 쓰고 읽으며 댓글 수가 함께 바뀌어요", async () => {
  const reportId = await saveReport(owner, videoIds[0]);
  expect((await write(reportId, "비공개에는 못 써요")).status).toBe(404);
  expect(
    (await api("GET", `/reports/${reportId}/comments`, undefined, otherToken))
      .status,
  ).toBe(404);
  await publish(reportId);
  const created = await write(reportId, "  좋은 정리예요 ");
  expect(created.status).toBe(201);
  const comment = await created.json<CommentItem>();
  expect(created.headers.get("location")).toBe(
    `/v1/reports/${reportId}/comments/${comment.id}`,
  );
  expect(comment).toEqual({
    id: comment.id,
    reportId,
    body: "좋은 정리예요",
    author: { nickname: "독자" },
    createdAt: new Date(now * 1000).toISOString(),
    canDelete: true,
  });
  expect(JSON.stringify(comment)).not.toContain("@example.com");
  await write(reportId, "두 번째", token, now + 1);
  expect((await publicList()).items[0]?.commentCount).toBe(2);

  const listed = await api(
    "GET",
    `/reports/${reportId}/comments?limit=1`,
    undefined,
    otherToken,
  );
  const page = await listed.json<{
    items: CommentItem[];
    nextCursor: string | null;
  }>();
  expect(page.items.map((item) => [item.body, item.canDelete])).toEqual([
    ["두 번째", false],
  ]);
  const rest = await api(
    "GET",
    `/reports/${reportId}/comments?limit=1&cursor=${page.nextCursor}`,
    undefined,
    otherToken,
  );
  expect(
    (await rest.json<{ items: CommentItem[] }>()).items.map(
      (item) => item.body,
    ),
  ).toEqual(["좋은 정리예요"]);
});

test("본인 댓글만 삭제하고 삭제한 댓글은 목록과 댓글 수에서 빠져요", async () => {
  const reportId = await saveReport(owner, videoIds[0]);
  await publish(reportId);
  const mine = await (await write(reportId, "지울 댓글")).json<CommentItem>();
  const path = `/reports/${reportId}/comments/${mine.id}`;
  expect((await api("DELETE", path, undefined, token)).status).toBe(404);
  expect((await api("DELETE", path, undefined, otherToken)).status).toBe(204);
  expect((await api("DELETE", path, undefined, otherToken)).status).toBe(404);
  expect((await publicList()).items[0]?.commentCount).toBe(0);
  expect(
    await sql(
      "SELECT count(*) AS n FROM comments WHERE id = ? AND deleted_at IS NOT NULL",
      mine.id,
    ).first("n"),
  ).toBe(1);
});

test("철회하면 댓글 접근을 막고 다시 공개하면 복구해요", async () => {
  const reportId = await saveReport(owner, videoIds[0]);
  await publish(reportId);
  await write(reportId, "남을 댓글");
  await revoke(reportId);
  expect(
    (await api("GET", `/reports/${reportId}/comments`, undefined, otherToken))
      .status,
  ).toBe(404);
  await publish(reportId, token, now + 10);
  const listed = await api(
    "GET",
    `/reports/${reportId}/comments`,
    undefined,
    otherToken,
  );
  expect((await listed.json<{ items: CommentItem[] }>()).items).toHaveLength(1);
});

test("공개 상태는 보관한 사용자만 읽고 잘못된 댓글 입력은 400이에요", async () => {
  const reportId = await saveReport(owner, videoIds[0]);
  const state = await api("GET", `/reports/${reportId}/publication`);
  expect(await state.json()).toEqual({
    published: false,
    publishedAt: null,
    isPublisher: false,
  });
  expect(
    (
      await api(
        "GET",
        `/reports/${reportId}/publication`,
        undefined,
        otherToken,
      )
    ).status,
  ).toBe(404);
  await publish(reportId);
  for (const body of ["", "   ", "가".repeat(2001)])
    expect(await (await write(reportId, body)).json()).toEqual({
      error: {
        code: "INVALID_INPUT",
        fields: { body: "댓글은 1~2000자로 입력해 주세요." },
      },
    });
  expect((await write(reportId, "가".repeat(2000))).status).toBe(201);
  expect(
    (
      await api(
        "POST",
        `/reports/${reportId}/comments`,
        { body: "a", extra: 1 },
        otherToken,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await api(
        "DELETE",
        `/reports/${reportId}/comments/not-a-uuid`,
        undefined,
        otherToken,
      )
    ).status,
  ).toBe(400);
});
