import { type Context, Hono } from "hono";
import { type AuthenticatedEnv, requireSession } from "./auth";
import {
  InvalidInput,
  invalidInputResponse,
  jsonBodyLimit,
  parseIdParam,
  rejectQuery,
} from "./http-input";
import {
  automationConfigured,
  createManualCheck,
  getChannelCheck,
  getNextCheckId,
  listCheckResults,
} from "./jobs/channels";
import { unixNow } from "./jobs/shared";
import type { ChannelCheckResultRow, ChannelCheckRow } from "./rows";

const iso = (time: number | null) =>
  time === null ? null : new Date(time * 1000).toISOString();

function resource(
  check: ChannelCheckRow,
  results: ChannelCheckResultRow[],
  nextCheckId: string | null,
) {
  return {
    id: check.id,
    status: check.status,
    failureCode: check.failureCode,
    nextCheckId,
    createdAt: iso(check.createdAt),
    finishedAt: iso(check.finishedAt),
    channels: results.map((result) => ({
      subscriptionId: result.subscriptionId,
      title: result.title,
      status: result.status,
      failureCode: result.failureCode,
      lastCheckedAt: iso(result.lastCheckedAt),
    })),
  };
}

// 지금 확인은 본문이 없거나 빈 JSON 객체예요.
async function emptyBody(c: Context) {
  rejectQuery(c);
  const text = await c.req.text();
  if (!text.trim()) return;
  if (
    (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    throw new InvalidInput();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InvalidInput();
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length
  )
    throw new InvalidInput();
}

export const channelChecks = new Hono<AuthenticatedEnv>();
for (const path of ["/channel-checks", "/channel-checks/*"])
  channelChecks.use(path, requireSession, jsonBodyLimit);

channelChecks.post("/channel-checks", async (c) => {
  await emptyBody(c);
  if (!automationConfigured(c.env))
    return c.json({ error: { code: "AUTOMATION_UNAVAILABLE" } }, 503);
  const result = await createManualCheck(c.env.DB, c.get("userId"), unixNow());
  if (result.status === "not_ready")
    return c.json({ error: { code: "AUTOMATION_NOT_READY" } }, 409);
  if (result.status === "rate_limited") {
    c.header("Retry-After", String(result.retryAfter));
    return c.json({ error: { code: "RATE_LIMITED" } }, 429);
  }
  const results = await listCheckResults(c.env.DB, result.check.id);
  if (result.status === "created")
    c.header("Location", `/v1/channel-checks/${result.check.id}`);
  return c.json(
    resource(
      result.check,
      results,
      await getNextCheckId(c.env.DB, c.get("userId"), result.check),
    ),
    result.status === "created" ? 202 : 200,
  );
});

channelChecks.get("/channel-checks/:id", async (c) => {
  rejectQuery(c);
  const check = await getChannelCheck(
    c.env.DB,
    c.get("userId"),
    parseIdParam(c),
  );
  if (!check) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  return c.json(
    resource(
      check,
      await listCheckResults(c.env.DB, check.id),
      await getNextCheckId(c.env.DB, c.get("userId"), check),
    ),
  );
});

channelChecks.onError((error, c) =>
  error instanceof InvalidInput
    ? invalidInputResponse(c, error)
    : c.json({ error: { code: "INTERNAL_ERROR" } }, 500),
);
