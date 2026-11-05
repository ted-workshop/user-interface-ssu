import { Hono } from "hono";
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
import type {
  CommentRow,
  IdRow,
  PublicationRow,
  ReportDetailRow,
  ReportRow,
} from "./rows";

// 취소된 발송은 상태 계산에서 빼요. 대상이 없으면 합계가 NULL이어도 ELSE로 떨어져 deliveryStatus는 NULL이 되지 않아요.
// 응답 값과 발송 상태 필터가 같은 식을 쓰도록 상수로 둬요.
const deliveryStatusSql = `(SELECT CASE
    WHEN sum(d.status IN ('failed', 'ambiguous')) > 0 THEN 'failed'
    WHEN sum(d.status IN ('queued', 'sending')) > 0 THEN 'pending'
    WHEN sum(d.status = 'sent') > 0 THEN 'sent'
    ELSE 'not_applicable' END
  FROM deliveries d WHERE d.user_id = q.user_id AND d.report_id = r.id)`;

export const reportColumns = `r.id, j.video_id AS videoId, r.title, r.channel_name AS channelName,
  r.channel_url AS channelUrl, r.model, r.timestamp_verification AS timestampVerification,
  r.created_at AS createdAt, q.id AS requestId, q.origin, p.created_at AS savedAt,
  ${deliveryStatusSql} AS deliveryStatus`;

const MAX_SEARCH_LENGTH = 100;
const MAX_CHANNEL_URL_LENGTH = 2048;

// 보관함과 공개 목록이 같은 검색어 규칙을 써요.
export const searchText = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => {
    const length = Array.from(value).length;
    return length >= 1 && length <= MAX_SEARCH_LENGTH;
  });

const listQuery = z.strictObject({
  ...pageQuery,
  q: searchText.optional(),
  channelUrl: z.string().min(1).max(MAX_CHANNEL_URL_LENGTH).optional(),
  origin: z.enum(["direct", "channel"]).optional(),
  deliveryStatus: z
    .enum(["not_applicable", "pending", "sent", "failed"])
    .optional(),
});

// LIKE의 wildcard를 일반 문자로 검색하도록 escape해요.
export const likePattern = (value: string) =>
  `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

export const toIso = (seconds: number) =>
  new Date(seconds * 1000).toISOString();

export function resource(row: ReportRow) {
  return {
    id: row.id,
    videoId: row.videoId,
    url: `https://www.youtube.com/watch?v=${row.videoId}`,
    title: row.title,
    channelName: row.channelName,
    channelUrl: row.channelUrl,
    model: row.model,
    timestampVerification: row.timestampVerification,
    createdAt: toIso(row.createdAt),
    viewerContext:
      row.requestId !== null && row.origin !== null && row.savedAt !== null
        ? {
            requestId: row.requestId,
            origin: row.origin,
            deliveryStatus: row.deliveryStatus,
            savedAt: toIso(row.savedAt),
          }
        : null,
  };
}

export const reports = new Hono<AuthenticatedEnv>();
reports.use("*", requireSession, jsonBodyLimit);

reports.get("/", async (c) => {
  const { limit, cursor, q, channelUrl, origin, deliveryStatus } = parseQuery(
    c,
    listQuery,
  );
  const position = parseCursor(cursor);
  // 조건 SQL과 bind 값을 한 번에 넣어 순서·개수가 어긋나지 않게 해요.
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  const addCondition = (sql: string, ...bound: (string | number)[]) => {
    conditions.push(sql);
    values.push(...bound);
  };
  if (q !== undefined)
    addCondition("r.title LIKE ? ESCAPE '\\'", likePattern(q));
  if (channelUrl !== undefined) addCondition("r.channel_url = ?", channelUrl);
  if (origin !== undefined) addCondition("q.origin = ?", origin);
  if (deliveryStatus !== undefined)
    addCondition(`${deliveryStatusSql} = ?`, deliveryStatus);
  if (position)
    addCondition(
      "(p.created_at, p.report_id) < (?, ?)",
      position.createdAt,
      position.id,
    );
  const rows = await statement(
    c.env.DB,
    `SELECT ${reportColumns}
    FROM report_permissions p
    JOIN reports r ON r.id = p.report_id
    JOIN analysis_jobs j ON j.id = r.analysis_job_id
    -- 개인 권한 행은 항상 본인 요청에서 만들어지므로 요청 행이 함께 있다고 가정해요.
    JOIN summary_requests q ON q.user_id = p.user_id AND q.analysis_job_id = r.analysis_job_id
    WHERE p.audience = 'user' AND p.user_id = ?
    ${conditions.map((condition) => `AND ${condition}`).join("\n    ")}
    ORDER BY p.created_at DESC, p.report_id DESC LIMIT ?`,
    c.get("userId"),
    ...values,
    limit + 1,
  ).all<ReportRow>();
  const page = rows.results.slice(0, limit);
  const last = page.at(-1);
  return c.json({
    items: page.map(resource),
    nextCursor: encodeCursor(
      rows.results.length > limit && last?.savedAt != null
        ? { createdAt: last.savedAt, id: last.id }
        : null,
    ),
  });
});

reports.get("/:id", async (c) => {
  rejectQuery(c);
  const userId = c.get("userId");
  const row = await statement(
    c.env.DB,
    `SELECT ${reportColumns}, r.body_markdown AS bodyMarkdown
    FROM reports r
    JOIN analysis_jobs j ON j.id = r.analysis_job_id
    LEFT JOIN report_permissions p ON p.report_id = r.id AND p.audience = 'user' AND p.user_id = ?
    LEFT JOIN summary_requests q ON q.user_id = p.user_id AND q.analysis_job_id = r.analysis_job_id
    WHERE r.id = ? AND (p.id IS NOT NULL OR EXISTS (
      SELECT 1 FROM report_permissions WHERE report_id = r.id AND audience = 'authenticated'))`,
    userId,
    parseIdParam(c),
  ).first<ReportDetailRow>();
  if (!row) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  return c.json({ ...resource(row), bodyMarkdown: row.bodyMarkdown });
});

// 순번 중 가장 먼저 공개를 누른 사용자가 현재 공개한 사람이에요.
const publisherSql = `(SELECT user_id FROM report_permissions
  WHERE report_id = ? AND audience = 'user' AND publish_requested_at IS NOT NULL
  ORDER BY publish_requested_at, id LIMIT 1)`;

function publicationState(db: D1Database, reportId: string, userId: string) {
  return statement(
    db,
    `SELECT
      EXISTS (SELECT 1 FROM report_permissions WHERE report_id = ? AND user_id = ? AND audience = 'user') AS saved,
      (SELECT created_at FROM report_permissions WHERE report_id = ? AND audience = 'authenticated') AS publishedAt,
      coalesce(${publisherSql} = ?, 0) AS isPublisher`,
    reportId,
    userId,
    reportId,
    reportId,
    userId,
  );
}

function publication(row: PublicationRow) {
  return {
    published: row.publishedAt !== null,
    publishedAt: row.publishedAt === null ? null : toIso(row.publishedAt),
    isPublisher: row.isPublisher === 1,
  };
}

// 보관함에 있는 리포트를 공개해요. 이미 공개돼 있으면 다음 순번으로 등록해요.
reports.put("/:id/publication", async (c) => {
  rejectQuery(c);
  const id = parseIdParam(c);
  const userId = c.get("userId");
  const now = unixNow();
  const [, , state] = await c.env.DB.batch([
    statement(
      c.env.DB,
      `UPDATE report_permissions SET publish_requested_at = ?
      WHERE report_id = ? AND user_id = ? AND audience = 'user' AND publish_requested_at IS NULL`,
      now,
      id,
      userId,
    ),
    statement(
      c.env.DB,
      `INSERT INTO report_permissions (id, report_id, audience, user_id, can_read, can_comment, created_at)
      SELECT ?, ?, 'authenticated', NULL, 1, 1, ?
      WHERE EXISTS (SELECT 1 FROM report_permissions WHERE report_id = ? AND user_id = ? AND audience = 'user')
      ON CONFLICT DO NOTHING`,
      crypto.randomUUID(),
      id,
      now,
      id,
      userId,
    ),
    publicationState(c.env.DB, id, userId),
  ]);
  const row = state?.results[0] as PublicationRow | undefined;
  if (!row?.saved) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  return c.json(publication(row));
});

// 현재 공개한 사람만 철회하고, 순번과 상관없이 공개 전체를 닫아요. 댓글은 남겨 다시 공개하면 보여요.
reports.delete("/:id/publication", async (c) => {
  rejectQuery(c);
  const id = parseIdParam(c);
  const userId = c.get("userId");
  const [revoked, , state] = await c.env.DB.batch([
    statement(
      c.env.DB,
      `DELETE FROM report_permissions WHERE report_id = ? AND audience = 'authenticated' AND ${publisherSql} = ?`,
      id,
      id,
      userId,
    ),
    statement(
      c.env.DB,
      `UPDATE report_permissions SET publish_requested_at = NULL
      WHERE report_id = ? AND audience = 'user' AND publish_requested_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM report_permissions WHERE report_id = ? AND audience = 'authenticated')`,
      id,
      id,
    ),
    publicationState(c.env.DB, id, userId),
  ]);
  const row = state?.results[0] as PublicationRow | undefined;
  if (!row?.saved) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  if (revoked?.meta.changes || row.publishedAt === null)
    return c.body(null, 204);
  return c.json({ error: { code: "PUBLICATION_FORBIDDEN" } }, 403);
});

reports.get("/:id/publication", async (c) => {
  rejectQuery(c);
  const row = await publicationState(
    c.env.DB,
    parseIdParam(c),
    c.get("userId"),
  ).first<PublicationRow>();
  if (!row?.saved) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  return c.json(publication(row));
});

const MAX_COMMENT_LENGTH = 2000;
const COMMENT_GUIDE = `댓글은 1~${MAX_COMMENT_LENGTH}자로 입력해 주세요.`;
const commentInput = z.strictObject({
  body: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => {
      const length = Array.from(value).length;
      return length >= 1 && length <= MAX_COMMENT_LENGTH;
    }),
});

// 삭제·보관 표시가 없는 댓글만 보여요. 작성자는 닉네임만 담고 삭제 가능 여부는 ID로 정해요.
const visibleComment = "cm.deleted_at IS NULL AND cm.archived_at IS NULL";
const publicRule = `EXISTS (SELECT 1 FROM report_permissions
  WHERE report_id = ? AND audience = 'authenticated' AND can_comment = 1)`;

function commentResource(reportId: string, row: CommentRow) {
  return {
    id: row.id,
    reportId,
    body: row.body,
    author: { nickname: row.nickname },
    createdAt: toIso(row.createdAt),
    canDelete: row.canDelete === 1,
  };
}

function commentSelect(userId: string) {
  return {
    sql: `SELECT cm.id, cm.body, u.nickname, cm.created_at AS createdAt, cm.user_id = ? AS canDelete
    FROM comments cm JOIN users u ON u.id = cm.user_id`,
    values: [userId],
  };
}

// 공개 규칙이 없는 리포트의 댓글은 없는 리포트와 같은 404예요.
reports.get("/:id/comments", async (c) => {
  const id = parseIdParam(c);
  const { limit, cursor } = parseQuery(c, z.strictObject(pageQuery));
  const after = keysetAfter("cm.created_at, cm.id", parseCursor(cursor));
  const open = await statement(
    c.env.DB,
    `SELECT ? AS id WHERE ${publicRule}`,
    id,
    id,
  ).first<IdRow>();
  if (!open) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  const select = commentSelect(c.get("userId"));
  const rows = await statement(
    c.env.DB,
    `${select.sql}
    WHERE cm.report_id = ? AND ${visibleComment} ${after.sql}
    ORDER BY cm.created_at DESC, cm.id DESC LIMIT ?`,
    ...select.values,
    id,
    ...after.values,
    limit + 1,
  ).all<CommentRow>();
  const page = rows.results.slice(0, limit);
  const last = page.at(-1);
  return c.json({
    items: page.map((row) => commentResource(id, row)),
    nextCursor: encodeCursor(
      rows.results.length > limit && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
    ),
  });
});

reports.post("/:id/comments", async (c) => {
  rejectQuery(c);
  const id = parseIdParam(c);
  const parsed = commentInput.safeParse(await jsonInput(c, z.unknown()));
  if (!parsed.success)
    throw new FieldError(
      parsed.error.issues.some((issue) => issue.path[0] === "body")
        ? { body: COMMENT_GUIDE }
        : {},
    );
  const userId = c.get("userId");
  const commentId = crypto.randomUUID();
  const select = commentSelect(userId);
  const [inserted, created] = await c.env.DB.batch([
    statement(
      c.env.DB,
      `INSERT INTO comments (id, report_id, user_id, body, created_at)
      SELECT ?, ?, ?, ?, ? WHERE ${publicRule}`,
      commentId,
      id,
      userId,
      parsed.data.body,
      unixNow(),
      id,
    ),
    statement(
      c.env.DB,
      `${select.sql} WHERE cm.id = ?`,
      ...select.values,
      commentId,
    ),
  ]);
  const row = created?.results[0] as CommentRow | undefined;
  if (!inserted?.meta.changes || !row)
    return c.json({ error: { code: "NOT_FOUND" } }, 404);
  c.header("Location", `/v1/reports/${id}/comments/${commentId}`);
  return c.json(commentResource(id, row), 201);
});

// 본인 댓글만 삭제 표시를 남겨요. 다른 사람의 댓글과 이미 숨긴 댓글은 같은 404예요.
reports.delete("/:id/comments/:commentId", async (c) => {
  rejectQuery(c);
  const id = parseIdParam(c);
  const commentId = z.uuid().safeParse(c.req.param("commentId"));
  if (!commentId.success) throw new InvalidInput();
  const deleted = await statement(
    c.env.DB,
    `UPDATE comments AS cm SET deleted_at = ?
    WHERE cm.id = ? AND cm.report_id = ? AND cm.user_id = ? AND ${visibleComment} AND ${publicRule}`,
    unixNow(),
    commentId.data,
    id,
    c.get("userId"),
    id,
  ).run();
  if (!deleted.meta.changes)
    return c.json({ error: { code: "NOT_FOUND" } }, 404);
  return c.body(null, 204);
});

reports.onError((error, c) =>
  error instanceof InvalidInput
    ? invalidInputResponse(c, error)
    : c.json({ error: { code: "INTERNAL_ERROR" } }, 500),
);
