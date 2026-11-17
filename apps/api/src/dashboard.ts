import { Hono } from "hono";
import { type AuthenticatedEnv, requireSession } from "./auth";
import {
  InvalidInput,
  invalidInputResponse,
  jsonBodyLimit,
  rejectQuery,
} from "./http-input";
import { statement } from "./jobs/shared";
import {
  personalReportSource,
  reportColumns,
  resource,
  toIso,
} from "./reports";
import type { DashboardRow, ReportRow } from "./rows";

export const dashboard = new Hono<AuthenticatedEnv>();
dashboard.use("*", requireSession, jsonBodyLimit);

dashboard.get("/", async (c) => {
  rejectQuery(c);
  const db = c.env.DB;
  const userId = c.get("userId");
  // 각각 한 행으로 집계한 뒤 결합해야 구독·요약·발송 건수가 서로 곱해지지 않아요.
  const [totals, recent] = (await db.batch([
    statement(
      db,
      `SELECT * FROM
      (SELECT count(*) FILTER (WHERE status = 'active') AS activeChannelCount,
        max(last_checked_at) AS lastCheckedAt,
        min(next_check_at) FILTER (WHERE status = 'active') AS nextCheckAt
        FROM channel_subscriptions WHERE user_id = ? AND status != 'deleted')
      CROSS JOIN (SELECT count(*) FILTER (WHERE status = 'queued') AS queued,
        count(*) FILTER (WHERE status = 'running') AS running,
        count(*) FILTER (WHERE status = 'failed') AS failedSummaries
        FROM summary_requests WHERE user_id = ? AND status != 'completed')
      CROSS JOIN (SELECT count(*) FILTER (WHERE status IN ('queued', 'sending')) AS pending,
        count(*) FILTER (WHERE status IN ('failed', 'ambiguous')) AS failedDeliveries
        FROM deliveries WHERE user_id = ? AND status IN ('queued', 'sending', 'failed', 'ambiguous'))`,
      userId,
      userId,
      userId,
    ),
    statement(
      db,
      `SELECT ${reportColumns} ${personalReportSource}
      ORDER BY p.created_at DESC, p.report_id DESC LIMIT 5`,
      userId,
    ),
  ])) as [D1Result<DashboardRow>, D1Result<ReportRow>];
  const row = totals.results[0];
  if (!row) throw new Error("홈 집계 행이 없어요.");
  return c.json({
    recentReports: recent.results.map(resource),
    activeChannelCount: row.activeChannelCount,
    summaryCounts: {
      queued: row.queued,
      running: row.running,
      failed: row.failedSummaries,
    },
    deliveryCounts: { pending: row.pending, failed: row.failedDeliveries },
    lastCheckedAt: row.lastCheckedAt === null ? null : toIso(row.lastCheckedAt),
    nextCheckAt: row.nextCheckAt === null ? null : toIso(row.nextCheckAt),
  });
});

dashboard.onError((error, c) =>
  error instanceof InvalidInput
    ? invalidInputResponse(c, error)
    : c.json({ error: { code: "INTERNAL_ERROR" } }, 500),
);
