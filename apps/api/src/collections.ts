import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AuthenticatedEnv, requireSession } from "./auth";
import {
  encodeCursor,
  FieldError,
  InvalidInput,
  invalidInputResponse,
  jsonBodyLimit,
  jsonInput,
  keysetAfter,
  pageQuery,
  parseCursor,
  parseIdParam,
  parseQuery,
  rejectQuery,
} from "./http-input";
import { statement, unixNow } from "./jobs/shared";
import { reportColumns, resource as reportResource, toIso } from "./reports";
import type { CollectionReportRow, CollectionRow, IdRow } from "./rows";

const MAX_NAME_LENGTH = 30;
const NAME_GUIDE = `모음 이름은 1~${MAX_NAME_LENGTH}자로 입력해 주세요.`;

const name = z
  .string()
  .transform((value) => value.normalize("NFC").trim())
  .refine((value) => {
    const length = Array.from(value).length;
    // 제어문자·줄바꿈은 표시 이름에 허용하지 않아요.
    return length >= 1 && length <= MAX_NAME_LENGTH && !/\p{Cc}/u.test(value);
  });
const collectionInput = z.strictObject({ name });
const listQuery = z.strictObject({
  ...pageQuery,
  reportId: z.uuid().optional(),
});

async function nameInput(c: Context) {
  rejectQuery(c);
  const parsed = collectionInput.safeParse(await jsonInput(c, z.unknown()));
  if (parsed.success) return parsed.data.name;
  const named = parsed.error.issues.some((issue) => issue.path[0] === "name");
  throw new FieldError(named ? { name: NAME_GUIDE } : {});
}

function parseReportIdParam(c: Context) {
  const parsed = z.uuid().safeParse(c.req.param("reportId"));
  if (!parsed.success) throw new InvalidInput();
  return parsed.data;
}

function resource(row: CollectionRow) {
  return {
    id: row.id,
    name: row.name,
    reportCount: row.reportCount,
    ...(row.containsReport === null
      ? {}
      : { containsReport: row.containsReport === 1 }),
    createdAt: toIso(row.createdAt),
  };
}

const collectionColumns = `c.id, c.name, c.created_at AS createdAt,
  (SELECT count(*) FROM collection_items i WHERE i.collection_id = c.id) AS reportCount`;

function getCollection(db: D1Database, userId: string, id: string) {
  return statement(
    db,
    `SELECT ${collectionColumns}, NULL AS containsReport
    FROM collections c WHERE c.id = ? AND c.user_id = ?`,
    id,
    userId,
  ).first<CollectionRow>();
}

// 본인 모음에 본인 보관함의 리포트가 있는지 확인해요. 둘 중 하나라도 아니면 같은 404예요.
function ownedTarget(
  db: D1Database,
  userId: string,
  id: string,
  reportId: string,
) {
  return statement(
    db,
    `SELECT c.id FROM collections c
    JOIN report_permissions p ON p.user_id = c.user_id AND p.audience = 'user' AND p.report_id = ?
    WHERE c.id = ? AND c.user_id = ?`,
    reportId,
    id,
    userId,
  );
}

const notFound = (c: Context) => c.json({ error: { code: "NOT_FOUND" } }, 404);

export const collections = new Hono<AuthenticatedEnv>();
collections.use("*", requireSession, jsonBodyLimit);

collections.get("/", async (c) => {
  const { limit, cursor, reportId } = parseQuery(c, listQuery);
  // SQL 조각과 bind 값을 함께 두어 순서·개수가 어긋나지 않게 해요.
  const contains = reportId
    ? {
        sql: `EXISTS (SELECT 1 FROM collection_items i JOIN report_permissions p ON p.id = i.permission_id
      WHERE i.collection_id = c.id AND p.report_id = ?)`,
        values: [reportId],
      }
    : { sql: "NULL", values: [] };
  const after = keysetAfter("c.created_at, c.id", parseCursor(cursor));
  const rows = await statement(
    c.env.DB,
    `SELECT ${collectionColumns}, ${contains.sql} AS containsReport
    FROM collections c
    WHERE c.user_id = ? ${after.sql}
    ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
    ...contains.values,
    c.get("userId"),
    ...after.values,
    limit + 1,
  ).all<CollectionRow>();
  const page = rows.results.slice(0, limit);
  const last = page.at(-1);
  return c.json({
    items: page.map(resource),
    nextCursor: encodeCursor(
      rows.results.length > limit && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
    ),
  });
});

collections.post("/", async (c) => {
  const value = await nameInput(c);
  const id = crypto.randomUUID();
  const createdAt = unixNow();
  const inserted = await statement(
    c.env.DB,
    `INSERT INTO collections (id, user_id, name, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, name) DO NOTHING`,
    id,
    c.get("userId"),
    value,
    createdAt,
  ).run();
  if (inserted.meta.changes !== 1)
    return c.json({ error: { code: "COLLECTION_EXISTS" } }, 409);
  c.header("Location", `/v1/collections/${id}`);
  return c.json(
    resource({
      id,
      name: value,
      reportCount: 0,
      containsReport: null,
      createdAt,
    }),
    201,
  );
});

collections.patch("/:id", async (c) => {
  const id = parseIdParam(c);
  const value = await nameInput(c);
  const userId = c.get("userId");
  // 같은 이름의 다른 모음이 있으면 바꾸지 않고, 남은 행으로 404와 409를 구분해요.
  const updated = await statement(
    c.env.DB,
    "UPDATE OR IGNORE collections SET name = ? WHERE id = ? AND user_id = ?",
    value,
    id,
    userId,
  ).run();
  const row = await getCollection(c.env.DB, userId, id);
  if (!row) return notFound(c);
  if (updated.meta.changes !== 1)
    return c.json({ error: { code: "COLLECTION_EXISTS" } }, 409);
  return c.json(resource(row));
});

collections.delete("/:id", async (c) => {
  rejectQuery(c);
  const deleted = await statement(
    c.env.DB,
    "DELETE FROM collections WHERE id = ? AND user_id = ?",
    parseIdParam(c),
    c.get("userId"),
  ).run();
  // 담긴 항목이 함께 지워지면 changes가 1보다 클 수 있어요.
  if (deleted.meta.changes === 0) return notFound(c);
  return c.body(null, 204);
});

collections.get("/:id/reports", async (c) => {
  const id = parseIdParam(c);
  const { limit, cursor } = parseQuery(c, z.strictObject(pageQuery));
  const after = keysetAfter("i.created_at, r.id", parseCursor(cursor));
  const userId = c.get("userId");
  const owned = await statement(
    c.env.DB,
    "SELECT id FROM collections WHERE id = ? AND user_id = ?",
    id,
    userId,
  ).first<IdRow>();
  if (!owned) return notFound(c);
  const rows = await statement(
    c.env.DB,
    `SELECT ${reportColumns}, i.created_at AS addedAt
      FROM collections c
      JOIN collection_items i ON i.collection_id = c.id
      JOIN report_permissions p ON p.id = i.permission_id
      JOIN reports r ON r.id = p.report_id
      JOIN analysis_jobs j ON j.id = r.analysis_job_id
      -- 보관 권한 행은 항상 본인 요청에서 만들어지므로 요청 행이 함께 있다고 가정해요.
      JOIN summary_requests q ON q.user_id = p.user_id AND q.analysis_job_id = r.analysis_job_id
      WHERE c.id = ? AND c.user_id = ? ${after.sql}
      ORDER BY i.created_at DESC, r.id DESC LIMIT ?`,
    id,
    userId,
    ...after.values,
    limit + 1,
  ).all<CollectionReportRow>();
  const results = rows.results;
  const page = results.slice(0, limit);
  const last = page.at(-1);
  return c.json({
    items: page.map((row) => ({
      ...reportResource(row),
      addedAt: toIso(row.addedAt),
    })),
    nextCursor: encodeCursor(
      results.length > limit && last
        ? { createdAt: last.addedAt, id: last.id }
        : null,
    ),
  });
});

collections.put("/:id/reports/:reportId", async (c) => {
  rejectQuery(c);
  const id = parseIdParam(c);
  const reportId = parseReportIdParam(c);
  const userId = c.get("userId");
  // 이미 담긴 리포트는 그대로 두고 같은 성공 응답을 돌려줘요.
  const [, owned] = await c.env.DB.batch([
    statement(
      c.env.DB,
      `INSERT INTO collection_items (collection_id, permission_id, created_at)
      SELECT c.id, p.id, ? FROM collections c
      JOIN report_permissions p ON p.user_id = c.user_id AND p.audience = 'user' AND p.report_id = ?
      WHERE c.id = ? AND c.user_id = ?
      ON CONFLICT DO NOTHING`,
      unixNow(),
      reportId,
      id,
      userId,
    ),
    ownedTarget(c.env.DB, userId, id, reportId),
  ]);
  if (!owned?.results.length) return notFound(c);
  return c.body(null, 204);
});

collections.delete("/:id/reports/:reportId", async (c) => {
  rejectQuery(c);
  const id = parseIdParam(c);
  const reportId = parseReportIdParam(c);
  const userId = c.get("userId");
  const [, owned] = await c.env.DB.batch([
    statement(
      c.env.DB,
      `DELETE FROM collection_items
      WHERE collection_id = (SELECT id FROM collections WHERE id = ? AND user_id = ?)
      AND permission_id = (SELECT id FROM report_permissions WHERE report_id = ? AND user_id = ? AND audience = 'user')`,
      id,
      userId,
      reportId,
      userId,
    ),
    ownedTarget(c.env.DB, userId, id, reportId),
  ]);
  if (!owned?.results.length) return notFound(c);
  return c.body(null, 204);
});

collections.onError((error, c) => {
  if (error instanceof InvalidInput) return invalidInputResponse(c, error);
  return c.json({ error: { code: "INTERNAL_ERROR" } }, 500);
});
