import { Hono } from "hono";
import { z } from "zod";
import { type AuthenticatedEnv, requireSession } from "./auth";
import {
  encodeCursor,
  InvalidInput,
  invalidInputResponse,
  keysetAfter,
  pageQuery,
  parseCursor,
  parseIdParam,
  parseQuery,
  rejectQuery,
} from "./http-input";
import { statement } from "./jobs/shared";
import { likePattern, searchText, toIso } from "./reports";
import type { PublicReportDetailRow, PublicReportRow } from "./rows";

// 삭제 표시나 보관 표시가 있는 댓글은 세지 않아요.
const publicColumns = `r.id, j.video_id AS videoId, r.title, r.channel_name AS channelName,
  r.channel_url AS channelUrl, r.model, r.timestamp_verification AS timestampVerification,
  r.created_at AS createdAt, pub.created_at AS publishedAt,
  (SELECT count(*) FROM comments cm
    WHERE cm.report_id = r.id AND cm.deleted_at IS NULL AND cm.archived_at IS NULL) AS commentCount`;

const listQuery = z.strictObject({ ...pageQuery, q: searchText.optional() });

function resource(row: PublicReportRow) {
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
    publishedAt: toIso(row.publishedAt),
    commentCount: row.commentCount,
  };
}

export const publicReports = new Hono<AuthenticatedEnv>();
publicReports.use("*", requireSession);

// 공개 규칙이 있는 리포트를 공개 시각 최신순으로 읽어요. 검색어는 제목이나 채널명에 들어 있으면 찾아요.
publicReports.get("/", async (c) => {
  const { limit, cursor, q } = parseQuery(c, listQuery);
  const search =
    q === undefined
      ? { sql: "", values: [] }
      : {
          sql: "AND (r.title LIKE ? ESCAPE '\\' OR r.channel_name LIKE ? ESCAPE '\\')",
          values: [likePattern(q), likePattern(q)],
        };
  const after = keysetAfter(
    "pub.created_at, pub.report_id",
    parseCursor(cursor),
  );
  const rows = await statement(
    c.env.DB,
    `SELECT ${publicColumns}
    FROM report_permissions pub
    JOIN reports r ON r.id = pub.report_id
    JOIN analysis_jobs j ON j.id = r.analysis_job_id
    WHERE pub.audience = 'authenticated' ${search.sql} ${after.sql}
    ORDER BY pub.created_at DESC, pub.report_id DESC LIMIT ?`,
    ...search.values,
    ...after.values,
    limit + 1,
  ).all<PublicReportRow>();
  const page = rows.results.slice(0, limit);
  const last = page.at(-1);
  return c.json({
    items: page.map(resource),
    nextCursor: encodeCursor(
      rows.results.length > limit && last
        ? { createdAt: last.publishedAt, id: last.id }
        : null,
    ),
  });
});

publicReports.get("/:id", async (c) => {
  rejectQuery(c);
  const row = await statement(
    c.env.DB,
    `SELECT ${publicColumns}, r.body_markdown AS bodyMarkdown
    FROM report_permissions pub
    JOIN reports r ON r.id = pub.report_id
    JOIN analysis_jobs j ON j.id = r.analysis_job_id
    WHERE pub.audience = 'authenticated' AND pub.report_id = ?`,
    parseIdParam(c),
  ).first<PublicReportDetailRow>();
  if (!row) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  return c.json({ ...resource(row), bodyMarkdown: row.bodyMarkdown });
});

publicReports.onError((error, c) =>
  error instanceof InvalidInput
    ? invalidInputResponse(c, error)
    : c.json({ error: { code: "INTERNAL_ERROR" } }, 500),
);
