import { Hono } from "hono";
import { z } from "zod";
import { type AuthenticatedEnv, requireSession } from "./auth";
import {
  encodeCursor,
  InvalidInput,
  pageQuery,
  parseCursor,
  parseIdParam,
  parseQuery,
  rejectQuery,
} from "./http-input";
import { statement } from "./jobs/shared";
import type { ReportDetailRow, ReportRow } from "./rows";

// 취소된 발송은 상태 계산에서 빼요. 대상이 없으면 합계가 NULL이어도 ELSE로 떨어져 deliveryStatus는 NULL이 되지 않아요.
// 응답 값과 발송 상태 필터가 같은 식을 쓰도록 상수로 둬요.
const deliveryStatusSql = `(SELECT CASE
    WHEN sum(d.status IN ('failed', 'ambiguous')) > 0 THEN 'failed'
    WHEN sum(d.status IN ('queued', 'sending')) > 0 THEN 'pending'
    WHEN sum(d.status = 'sent') > 0 THEN 'sent'
    ELSE 'not_applicable' END
  FROM deliveries d WHERE d.user_id = q.user_id AND d.report_id = r.id)`;

const reportColumns = `r.id, j.video_id AS videoId, r.title, r.channel_name AS channelName,
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

const toIso = (seconds: number) => new Date(seconds * 1000).toISOString();

function resource(row: ReportRow) {
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
reports.use("*", requireSession);

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

reports.onError((error, c) =>
  error instanceof InvalidInput
    ? c.json({ error: { code: "INVALID_INPUT" } }, 400)
    : c.json({ error: { code: "INTERNAL_ERROR" } }, 500),
);
