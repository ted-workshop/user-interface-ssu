import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AuthenticatedEnv, requireSession } from "./auth";
import { deliveryResource } from "./deliveries";
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
import { listDeliveries } from "./jobs/delivery";
import { statement, unixNow } from "./jobs/shared";
import type { CommentRow, ReportDetailRow, ReportRow } from "./rows";

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

const listQuery = z.strictObject({
  ...pageQuery,
  q: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => {
      const length = Array.from(value).length;
      return length >= 1 && length <= MAX_SEARCH_LENGTH;
    })
    .optional(),
  channelUrl: z.string().min(1).max(MAX_CHANNEL_URL_LENGTH).optional(),
  origin: z.enum(["direct", "channel"]).optional(),
  deliveryStatus: z
    .enum(["not_applicable", "pending", "sent", "failed"])
    .optional(),
});

// LIKE의 wildcard를 일반 문자로 검색하도록 escape해요.
const likePattern = (value: string) =>
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
    WHERE r.id = ? AND p.id IS NOT NULL`,
    userId,
    parseIdParam(c),
  ).first<ReportDetailRow>();
  if (!row) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  return c.json({ ...resource(row), bodyMarkdown: row.bodyMarkdown });
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

// 리포트의 개인 권한 행이 있는 사용자만 댓글을 읽고 쓰고 지워요. 리포트 ID와 사용자 ID를 차례로 bind해요.
const readerSql = `EXISTS (SELECT 1 FROM report_permissions
  WHERE report_id = ? AND audience = 'user' AND user_id = ?)`;

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

// 작성자는 닉네임만 담고, 삭제 가능 여부는 닉네임이 아니라 사용자 ID로 정해요.
const commentSelect = `SELECT cm.id, cm.body, u.nickname, cm.created_at AS createdAt, cm.user_id = ? AS canDelete
  FROM comments cm JOIN users u ON u.id = cm.user_id`;

const notFound = (c: Context) => c.json({ error: { code: "NOT_FOUND" } }, 404);

reports.get("/:id/deliveries", async (c) => {
  const id = parseIdParam(c);
  const { limit, cursor } = parseQuery(c, z.strictObject(pageQuery));
  const userId = c.get("userId");
  const allowed = await statement(
    c.env.DB,
    "SELECT 1 AS allowed FROM report_permissions WHERE report_id = ? AND user_id = ? AND audience = 'user'",
    id,
    userId,
  ).first<{ allowed: number }>();
  if (!allowed) return notFound(c);
  const result = await listDeliveries(c.env.DB, userId, id, {
    limit,
    after: parseCursor(cursor),
  });
  return c.json({
    items: result.items.map(deliveryResource),
    nextCursor: encodeCursor(result.cursor),
  });
});

reports.get("/:id/comments", async (c) => {
  const id = parseIdParam(c);
  const { limit, cursor } = parseQuery(c, z.strictObject(pageQuery));
  const after = keysetAfter("cm.created_at, cm.id", parseCursor(cursor));
  const userId = c.get("userId");
  const [reader, rows] = await c.env.DB.batch([
    statement(c.env.DB, `SELECT ${readerSql} AS allowed`, id, userId),
    statement(
      c.env.DB,
      `${commentSelect}
      WHERE cm.report_id = ? AND cm.deleted_at IS NULL AND ${readerSql} ${after.sql}
      ORDER BY cm.created_at DESC, cm.id DESC LIMIT ?`,
      userId,
      id,
      id,
      userId,
      ...after.values,
      limit + 1,
    ),
  ]);
  if ((reader?.results[0] as { allowed: number } | undefined)?.allowed !== 1)
    return notFound(c);
  const results = (rows?.results ?? []) as CommentRow[];
  const page = results.slice(0, limit);
  const last = page.at(-1);
  return c.json({
    items: page.map((row) => commentResource(id, row)),
    nextCursor: encodeCursor(
      results.length > limit && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
    ),
  });
});

// 권한 확인과 저장을 한 문장으로 해서 그 사이에 권한이 사라져도 500이 아니라 404예요.
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
  const [inserted, created] = await c.env.DB.batch([
    statement(
      c.env.DB,
      `INSERT INTO comments (id, report_id, user_id, body, created_at)
      SELECT ?, ?, ?, ?, ? WHERE ${readerSql}`,
      commentId,
      id,
      userId,
      parsed.data.body,
      unixNow(),
      id,
      userId,
    ),
    statement(c.env.DB, `${commentSelect} WHERE cm.id = ?`, userId, commentId),
  ]);
  const row = created?.results[0] as CommentRow | undefined;
  if (!inserted?.meta.changes || !row) return notFound(c);
  c.header("Location", `/v1/reports/${id}/comments/${commentId}`);
  return c.json(commentResource(id, row), 201);
});

// 지금 권한이 있는 작성자 본인만 삭제 표시를 남겨요. 그 외와 이미 지운 댓글은 같은 404예요.
reports.delete("/:id/comments/:commentId", async (c) => {
  rejectQuery(c);
  const id = parseIdParam(c);
  const commentId = z.uuid().safeParse(c.req.param("commentId"));
  if (!commentId.success) throw new InvalidInput();
  const userId = c.get("userId");
  const deleted = await statement(
    c.env.DB,
    `UPDATE comments SET deleted_at = ?
    WHERE id = ? AND report_id = ? AND user_id = ? AND deleted_at IS NULL AND ${readerSql}`,
    unixNow(),
    commentId.data,
    id,
    userId,
    id,
    userId,
  ).run();
  if (!deleted.meta.changes) return notFound(c);
  return c.body(null, 204);
});

reports.onError((error, c) =>
  error instanceof InvalidInput
    ? invalidInputResponse(c, error)
    : c.json({ error: { code: "INTERNAL_ERROR" } }, 500),
);
