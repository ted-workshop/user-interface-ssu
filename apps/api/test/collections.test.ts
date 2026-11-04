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

type Collection = {
  id: string;
  name: string;
  reportCount: number;
  containsReport?: boolean;
  createdAt: string;
};
type Page<T> = { items: T[]; nextCursor: string | null };
type CollectionReport = {
  id: string;
  title: string;
  addedAt: string;
  viewerContext: { savedAt: string } | null;
};

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

const call = (
  method: string,
  path: string,
  body?: unknown,
  secret: string | null = token,
) =>
  app.request(
    `/v1${path}`,
    {
      method,
      headers: {
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    settings,
  );

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

// 생성 시각을 구분하려고 만들 때마다 시계를 1초씩 옮겨요.
let clock = now;
async function create(name: string, secret = token) {
  clock += 1;
  vi.spyOn(Date, "now").mockReturnValue(clock * 1000);
  const response = await call("POST", "/collections", { name }, secret);
  expect(response.status).toBe(201);
  return response.json<Collection>();
}

async function collectionsOf(query = "", secret = token) {
  const response = await call("GET", `/collections${query}`, undefined, secret);
  expect(response.status).toBe(200);
  return response.json<Page<Collection>>();
}

async function reportsIn(id: string, query = "", secret = token) {
  const response = await call(
    "GET",
    `/collections/${id}/reports${query}`,
    undefined,
    secret,
  );
  expect(response.status).toBe(200);
  return response.json<Page<CollectionReport>>();
}

async function add(id: string, reportId: string, secret = token) {
  clock += 1;
  vi.spyOn(Date, "now").mockReturnValue(clock * 1000);
  return call(
    "PUT",
    `/collections/${id}/reports/${reportId}`,
    undefined,
    secret,
  );
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  clock = now;
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

test("로그인하지 않으면 모음을 읽거나 만들 수 없어요", async () => {
  expect((await call("GET", "/collections", undefined, null)).status).toBe(401);
  expect(
    (await call("POST", "/collections", { name: "공부" }, null)).status,
  ).toBe(401);
});

test("모음을 만들고 이름을 바꾸고 지우면 다시 읽어도 결과가 유지돼요", async () => {
  const response = await call("POST", "/collections", { name: "  AI 공부 " });
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const created = await response.json<Collection>();
  expect(response.headers.get("location")).toBe(
    `/v1/collections/${created.id}`,
  );
  expect(created).toEqual({
    id: created.id,
    name: "AI 공부",
    reportCount: 0,
    createdAt: new Date(now * 1000).toISOString(),
  });

  const renamed = await call("PATCH", `/collections/${created.id}`, {
    name: "머신러닝",
  });
  expect(renamed.status).toBe(200);
  expect((await renamed.json<Collection>()).name).toBe("머신러닝");
  expect((await collectionsOf()).items).toEqual([
    { ...created, name: "머신러닝" },
  ]);

  expect((await call("DELETE", `/collections/${created.id}`)).status).toBe(204);
  expect((await collectionsOf()).items).toEqual([]);
  expect((await call("DELETE", `/collections/${created.id}`)).status).toBe(404);
});

test("모음 목록은 만든 시각 최신순이고 페이지 사이에 누락과 중복이 없어요", async () => {
  for (const name of ["하나", "둘", "셋"]) await create(name);
  const first = await collectionsOf("?limit=2");
  expect(first.items.map((item) => item.name)).toEqual(["셋", "둘"]);
  const second = await collectionsOf(`?limit=2&cursor=${first.nextCursor}`);
  expect(second.items.map((item) => item.name)).toEqual(["하나"]);
  expect(second.nextCursor).toBeNull();
});

test("빈 이름과 중복 이름을 구분해서 알려줘요", async () => {
  await create("공부");
  for (const name of ["", "   ", "가".repeat(31), "줄\n바꿈", 3])
    expect(await (await call("POST", "/collections", { name })).json()).toEqual(
      {
        error: {
          code: "INVALID_INPUT",
          fields: { name: "모음 이름은 1~30자로 입력해 주세요." },
        },
      },
    );
  expect(
    await (
      await call("POST", "/collections", { name: "공부", color: "red" })
    ).json(),
  ).toEqual({ error: { code: "INVALID_INPUT" } });

  // 조합형으로 입력해도 NFC로 바꿔 같은 이름으로 봐요.
  for (const name of ["공부", " 공부", "공부".normalize("NFD")]) {
    const duplicate = await call("POST", "/collections", { name });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({
      error: { code: "COLLECTION_EXISTS" },
    });
  }
  expect((await create("가".repeat(30))).name).toBe("가".repeat(30));
  // 대소문자가 다르면 다른 이름이에요.
  await create("AI");
  expect((await create("ai")).name).toBe("ai");
});

test("다른 모음과 같은 이름으로는 바꿀 수 없고 지금 이름으로 바꾸는 건 그대로 성공해요", async () => {
  const study = await create("공부");
  await create("취미");
  const duplicate = await call("PATCH", `/collections/${study.id}`, {
    name: "취미",
  });
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({
    error: { code: "COLLECTION_EXISTS" },
  });
  expect(
    (await call("PATCH", `/collections/${study.id}`, { name: "공부" })).status,
  ).toBe(200);
  expect(
    (await call("PATCH", `/collections/${study.id}`, { name: "" })).status,
  ).toBe(400);
  expect(
    (await call("PATCH", `/collections/${missingId}`, { name: "새 이름" }))
      .status,
  ).toBe(404);
});

test("한 리포트를 여러 모음에 넣고 빼며 같은 모음에는 한 번만 들어가요", async () => {
  const reportId = await saveReport(owner, videoIds[0]);
  const study = await create("공부");
  const later = await create("나중에");
  for (const id of [study.id, study.id, later.id])
    expect((await add(id, reportId)).status).toBe(204);

  const marked = await collectionsOf(`?reportId=${reportId}`);
  expect(
    marked.items.map(({ name, reportCount, containsReport }) => ({
      name,
      reportCount,
      containsReport,
    })),
  ).toEqual([
    { name: "나중에", reportCount: 1, containsReport: true },
    { name: "공부", reportCount: 1, containsReport: true },
  ]);

  const removed = await call(
    "DELETE",
    `/collections/${study.id}/reports/${reportId}`,
  );
  expect(removed.status).toBe(204);
  expect(
    (await call("DELETE", `/collections/${study.id}/reports/${reportId}`))
      .status,
  ).toBe(204);
  expect(
    (await collectionsOf(`?reportId=${reportId}`)).items.map(
      (item) => item.containsReport,
    ),
  ).toEqual([true, false]);
  expect((await reportsIn(study.id)).items).toEqual([]);
  expect((await reportsIn(later.id)).items.map((item) => item.id)).toEqual([
    reportId,
  ]);
});

test("모음 안 리포트는 담은 시각 최신순이고 보관함 항목과 같은 형식이에요", async () => {
  const reportIds: string[] = [];
  for (const videoId of videoIds)
    reportIds.push(await saveReport(owner, videoId));
  const study = await create("공부");
  for (const reportId of reportIds) await add(study.id, reportId);

  const first = await reportsIn(study.id, "?limit=2");
  expect(first.items.map((item) => item.id)).toEqual([
    reportIds[2],
    reportIds[1],
  ]);
  const second = await reportsIn(
    study.id,
    `?limit=2&cursor=${first.nextCursor}`,
  );
  expect(second.items.map((item) => item.id)).toEqual([reportIds[0]]);
  expect(second.nextCursor).toBeNull();

  const library = await call("GET", "/reports", undefined);
  const saved = (
    await library.json<Page<Record<string, unknown>>>()
  ).items.find((item) => item.id === reportIds[0]);
  const [item] = second.items;
  expect(item).toEqual({
    ...saved,
    addedAt: new Date((now + 2) * 1000).toISOString(),
  });
});

test("모음을 지워도 안에 있던 리포트는 보관함에 남아요", async () => {
  const reportId = await saveReport(owner, videoIds[0]);
  const study = await create("공부");
  await add(study.id, reportId);
  expect((await call("DELETE", `/collections/${study.id}`)).status).toBe(204);

  const library = await call("GET", "/reports", undefined);
  expect(
    (await library.json<Page<{ id: string }>>()).items.map((item) => item.id),
  ).toEqual([reportId]);
  expect(
    (await sql("SELECT count(*) AS n FROM collection_items").first(
      "n",
    )) as number,
  ).toBe(0);
});

test("보관 관계가 지워지면 모음에서도 빠지고 오류가 나지 않아요", async () => {
  const kept = await saveReport(owner, videoIds[0]);
  const removed = await saveReport(owner, videoIds[1]);
  const study = await create("공부");
  await add(study.id, kept);
  await add(study.id, removed);

  await sql(
    "DELETE FROM report_permissions WHERE report_id = ? AND user_id = ?",
    removed,
    owner,
  ).run();
  expect((await reportsIn(study.id)).items.map((item) => item.id)).toEqual([
    kept,
  ]);
  expect((await collectionsOf()).items[0]?.reportCount).toBe(1);
  // 보관함에 없는 리포트는 다시 담을 수 없어요.
  expect((await add(study.id, removed)).status).toBe(404);
});

test("다른 사용자의 모음은 읽거나 바꿀 수 없고 남의 리포트는 담을 수 없어요", async () => {
  const mine = await saveReport(owner, videoIds[0]);
  const theirs = await saveReport(other, videoIds[1]);
  const study = await create("공부");
  await add(study.id, mine);
  const otherCollection = await create("남의 모음", otherToken);

  expect(
    (await collectionsOf("", otherToken)).items.map((item) => item.id),
  ).toEqual([otherCollection.id]);
  for (const [method, path, body] of [
    ["GET", `/collections/${study.id}/reports`, undefined],
    ["PATCH", `/collections/${study.id}`, { name: "가로채기" }],
    ["DELETE", `/collections/${study.id}`, undefined],
    ["PUT", `/collections/${study.id}/reports/${theirs}`, undefined],
    ["DELETE", `/collections/${study.id}/reports/${mine}`, undefined],
  ] as const) {
    const response = await call(method, path, body, otherToken);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND" } });
  }
  // 내 모음이어도 내 보관함에 없는 리포트는 없는 ID와 같아요.
  expect((await add(study.id, theirs)).status).toBe(404);
  expect((await add(study.id, missingId)).status).toBe(404);
  expect((await reportsIn(study.id)).items.map((item) => item.id)).toEqual([
    mine,
  ]);
  expect((await collectionsOf()).items[0]?.name).toBe("공부");

  // 다른 사용자도 같은 리포트를 보관하면 각자의 모음에 따로 담아요.
  await saveReport(other, videoIds[0]);
  expect((await add(otherCollection.id, mine, otherToken)).status).toBe(204);
  expect((await reportsIn(study.id)).items).toHaveLength(1);
});

test("DB도 다른 사용자의 보관 행을 내 모음에 연결하지 못하게 막아요", async () => {
  const theirs = await saveReport(other, videoIds[0]);
  const study = await create("공부");
  const permission = await sql(
    "SELECT id FROM report_permissions WHERE report_id = ? AND user_id = ?",
    theirs,
    other,
  ).first<{ id: string }>();
  await expect(
    sql(
      "INSERT INTO collection_items (collection_id, permission_id) VALUES (?, ?)",
      study.id,
      permission?.id ?? "",
    ).run(),
  ).rejects.toThrow(/collection_item_owner_required/);
});

test("잘못된 ID·query·본문은 400이에요", async () => {
  const study = await create("공부");
  for (const [method, path, body] of [
    ["GET", "/collections?limit=0", undefined],
    ["GET", "/collections?reportId=not-a-uuid", undefined],
    ["GET", "/collections?unknown=1", undefined],
    ["GET", "/collections/not-a-uuid/reports", undefined],
    ["PATCH", "/collections/not-a-uuid", { name: "이름" }],
    ["DELETE", `/collections/${study.id}?force=1`, undefined],
    ["PUT", `/collections/${study.id}/reports/not-a-uuid`, undefined],
  ] as const)
    expect((await call(method, path, body)).status).toBe(400);
  expect(
    (
      await app.request(
        "/v1/collections",
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: "이름",
        },
        settings,
      )
    ).status,
  ).toBe(400);
  expect((await call("GET", `/collections/${missingId}/reports`)).status).toBe(
    404,
  );
});

test("모음을 읽고 담아도 새 요약 작업이나 보관 관계를 만들지 않아요", async () => {
  const reportId = await saveReport(owner, videoIds[0]);
  const count = async () =>
    sql(
      "SELECT (SELECT count(*) FROM analysis_jobs) AS jobs, (SELECT count(*) FROM summary_requests) AS requests, (SELECT count(*) FROM report_permissions) AS permissions",
    ).first();
  const before = await count();
  const study = await create("공부");
  await add(study.id, reportId);
  await reportsIn(study.id);
  await collectionsOf(`?reportId=${reportId}`);
  expect(await count()).toEqual(before);
});
