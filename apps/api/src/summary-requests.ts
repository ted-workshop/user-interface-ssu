import { Buffer } from "node:buffer";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { type AuthenticatedEnv, requireSession } from "./auth";
import {
  canAdmitAnalysis,
  enqueueAnalysis,
  getAnalysisRequest,
  listAnalysisRequests,
  retryAnalysis,
} from "./jobs/analysis";
import { JobError, unixNow } from "./jobs/shared";
import { SummaryError, summaryConfigSchema } from "./summary";

const submission = z.strictObject({ url: z.string().trim().min(1).max(2048) });
const retry = z.strictObject({ attempt: z.number().int().min(1).max(3) });
const cursorSchema = z.strictObject({
  createdAt: z.number().int().min(0).max(253402300799),
  id: z.uuid(),
});
const querySchema = z.strictObject({
  status: z.enum(["queued", "running", "completed", "failed"]).optional(),
  // 정수의 십진 표기만 허용해 빈 값·소수·지수 표기를 거부해요.
  limit: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().max(100))
    .default(20),
  cursor: z.string().min(1).max(512).optional(),
});

class InvalidInput extends Error {}

async function jsonInput<T>(
  c: Context<AuthenticatedEnv>,
  schema: z.ZodType<T>,
) {
  if (
    c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    throw new InvalidInput();
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new InvalidInput();
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new InvalidInput();
  return parsed.data;
}

function parseCursor(encoded: string | undefined) {
  if (encoded === undefined) return undefined;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) throw new InvalidInput();
    return cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
  } catch {
    throw new InvalidInput();
  }
}

function requestId(c: Context<AuthenticatedEnv>) {
  const parsed = z.uuid().safeParse(c.req.param("id"));
  if (!parsed.success) throw new InvalidInput();
  return parsed.data;
}

function admissionLimit(env: Env) {
  const config = summaryConfigSchema.safeParse({
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
  });
  // 새 분석·재시도의 하루 3회 정책은 ADR-0024를 따라요.
  return config.success ? 3 : 0;
}

function resource(
  request: Awaited<ReturnType<typeof getAnalysisRequest>>,
  available: boolean,
) {
  return {
    id: request.id,
    videoId: request.videoId,
    url: `https://www.youtube.com/watch?v=${request.videoId}`,
    origin: request.origin,
    status: request.status,
    attempt: request.attempt,
    reportId: request.reportId,
    failureCode: request.failureCode,
    retryable: request.retryable && available,
    createdAt: new Date(request.createdAt * 1000).toISOString(),
    updatedAt: new Date(request.updatedAt * 1000).toISOString(),
  };
}

export const summaryRequests = new Hono<AuthenticatedEnv>();
summaryRequests.use(
  "*",
  requireSession,
  bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) => c.json({ error: { code: "PAYLOAD_TOO_LARGE" } }, 413),
  }),
);

summaryRequests.post("/", async (c) => {
  if (Object.keys(c.req.query()).length) throw new InvalidInput();
  const input = await jsonInput(c, submission);
  const limit = admissionLimit(c.env);
  const result = await enqueueAnalysis(c.env.DB, {
    userId: c.get("userId"),
    url: input.url,
    model: c.env.GEMINI_MODEL,
    admissionLimit: limit,
  });
  c.header("Location", `/v1/summary-requests/${result.id}`);
  const available =
    result.retryable &&
    (await canAdmitAnalysis(c.env.DB, c.get("userId"), limit));
  return c.json(resource(result, available), result.accepted ? 202 : 200);
});

summaryRequests.get("/", async (c) => {
  const query = c.req.queries();
  if (Object.values(query).some((values) => values.length !== 1))
    throw new InvalidInput();
  const parsed = querySchema.safeParse(
    Object.fromEntries(
      Object.entries(query).map(([key, values]) => [key, values[0]]),
    ),
  );
  if (!parsed.success) throw new InvalidInput();
  const { cursor, ...filters } = parsed.data;
  const result = await listAnalysisRequests(c.env.DB, c.get("userId"), {
    ...filters,
    cursor: parseCursor(cursor),
  });
  const available =
    result.items.some((item) => item.retryable) &&
    (await canAdmitAnalysis(c.env.DB, c.get("userId"), admissionLimit(c.env)));
  return c.json({
    items: result.items.map((item) => resource(item, available)),
    nextCursor: result.cursor
      ? Buffer.from(JSON.stringify(result.cursor)).toString("base64url")
      : null,
  });
});

summaryRequests.get("/:id", async (c) => {
  if (Object.keys(c.req.query()).length) throw new InvalidInput();
  const result = await getAnalysisRequest(
    c.env.DB,
    c.get("userId"),
    requestId(c),
  );
  const available =
    result.retryable &&
    (await canAdmitAnalysis(c.env.DB, c.get("userId"), admissionLimit(c.env)));
  return c.json(resource(result, available));
});

summaryRequests.post("/:id/retry", async (c) => {
  if (Object.keys(c.req.query()).length) throw new InvalidInput();
  const input = await jsonInput(c, retry);
  const limit = admissionLimit(c.env);
  const result = await retryAnalysis(
    c.env.DB,
    c.get("userId"),
    requestId(c),
    input.attempt,
    unixNow(),
    limit,
  );
  c.header("Location", `/v1/summary-requests/${result.id}`);
  const available =
    result.retryable &&
    (await canAdmitAnalysis(c.env.DB, c.get("userId"), limit));
  return c.json(resource(result, available), result.accepted ? 202 : 200);
});

summaryRequests.onError((error, c) => {
  if (
    error instanceof InvalidInput ||
    (error instanceof SummaryError && error.reason === "invalid_url")
  )
    return c.json({ error: { code: "INVALID_INPUT" } }, 400);
  if (
    error instanceof z.ZodError ||
    (error instanceof SummaryError && error.reason === "configuration")
  )
    return c.json({ error: { code: "SUMMARY_UNAVAILABLE" } }, 503);
  if (error instanceof JobError) {
    switch (error.code) {
      case "NOT_FOUND":
        return c.json({ error: { code: error.code } }, 404);
      case "RETRY_NOT_ALLOWED":
        return c.json({ error: { code: error.code } }, 409);
      case "SUMMARY_UNAVAILABLE":
        return c.json({ error: { code: error.code } }, 503);
      case "USAGE_LIMIT_REACHED":
        c.header("Retry-After", String(86_400 - (unixNow() % 86_400)));
        return c.json({ error: { code: error.code } }, 429);
    }
  }
  return c.json({ error: { code: "INTERNAL_ERROR" } }, 500);
});
