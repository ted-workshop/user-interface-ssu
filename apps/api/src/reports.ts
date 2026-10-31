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
} from "./http-input";
import { statement } from "./jobs/shared";

type ReportRow = {
  id: string;
  videoId: string;
  title: string;
  channelName: string;
  channelUrl: string | null;
  model: string;
  timestampVerification: string;
  createdAt: number;
  requestId: string | null;
  origin: string | null;
  deliveryStatus: string | null;
  savedAt: number | null;
};

// 취소된 발송은 상태 계산에서 빼요. 대상이 없거나 전부 취소되면 합계가 0 또는 NULL이에요.
const reportColumns = `r.id, j.video_id AS videoId, r.title, r.channel_name AS channelName,
  r.channel_url AS channelUrl, r.model, r.timestamp_verification AS timestampVerification,
  r.created_at AS createdAt, q.id AS requestId, q.origin, p.created_at AS savedAt,
  (SELECT CASE
    WHEN sum(d.status IN ('failed', 'ambiguous')) > 0 THEN 'failed'
    WHEN sum(d.status IN ('queued', 'sending')) > 0 THEN 'pending'
    WHEN sum(d.status = 'sent') > 0 THEN 'sent'
    ELSE 'not_applicable' END
  FROM deliveries d WHERE d.user_id = q.user_id AND d.report_id = r.id) AS deliveryStatus`;

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
      row.requestId !== null && row.savedAt !== null
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
  // 검색·필터는 아직 없으므로 strict 검사로 거부해 전체 목록을 결과로 착각하지 않게 해요.
  const { limit, cursor } = parseQuery(c, z.strictObject(pageQuery));
  const position = parseCursor(cursor);
  const rows = await statement(
    c.env.DB,
    `SELECT ${reportColumns}
    FROM report_permissions p
    JOIN reports r ON r.id = p.report_id
    JOIN analysis_jobs j ON j.id = r.analysis_job_id
    JOIN summary_requests q ON q.user_id = p.user_id AND q.analysis_job_id = r.analysis_job_id
    WHERE p.audience = 'user' AND p.user_id = ?
    ${position ? "AND (p.created_at, p.report_id) < (?, ?)" : ""}
    ORDER BY p.created_at DESC, p.report_id DESC LIMIT ?`,
    c.get("userId"),
    ...(position ? [position.createdAt, position.id] : []),
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
  if (Object.keys(c.req.query()).length) throw new InvalidInput();
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
  ).first<ReportRow & { bodyMarkdown: string }>();
  if (!row) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  return c.json({ ...resource(row), bodyMarkdown: row.bodyMarkdown });
});

reports.onError((error, c) =>
  error instanceof InvalidInput
    ? c.json({ error: { code: "INVALID_INPUT" } }, 400)
    : c.json({ error: { code: "INTERNAL_ERROR" } }, 500),
);
