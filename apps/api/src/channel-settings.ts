import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AuthenticatedEnv, requireSession, sha256Hex } from "./auth";
import { AuthConfigError, issueRecipientTokenStatements } from "./auth-mail";
import {
  encodeCursor,
  InvalidInput,
  jsonBodyLimit,
  jsonInput,
  pageQuery,
  parseCursor,
  parseIdParam,
  parseQuery,
  rejectQuery,
} from "./http-input";
import { statement, unixNow } from "./jobs/shared";
import { consumeRateLimits } from "./rate-limit";
import type { RecipientRow, RecipientTokenRow, SubscriptionRow } from "./rows";
import {
  ChannelInputError,
  ChannelLookupError,
  lookupChannel,
  parseChannelInput,
  youtubeChannelId,
} from "./youtube-channels";

const page = z.strictObject(pageQuery);
const email = z
  .string()
  .transform((value) =>
    value.trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase()),
  )
  .pipe(z.email().max(254));
const subscriptionColumns = `s.id, c.youtube_channel_id AS youtubeChannelId, c.title, c.url, s.status,
  s.baseline_initialized_at AS baselineInitializedAt, s.last_checked_at AS lastCheckedAt,
  s.next_check_at AS nextCheckAt, s.created_at AS createdAt`;
const recipientColumns =
  "id, email, verified_at AS verifiedAt, created_at AS createdAt";
const iso = (time: number | null) =>
  time === null ? null : new Date(time * 1000).toISOString();
const channelResource = (row: SubscriptionRow) => ({
  ...row,
  baselineInitializedAt: iso(row.baselineInitializedAt),
  lastCheckedAt: iso(row.lastCheckedAt),
  nextCheckAt: iso(row.nextCheckAt),
  createdAt: iso(row.createdAt),
});
const recipientResource = (row: RecipientRow) => ({
  ...row,
  verifiedAt: iso(row.verifiedAt),
  createdAt: iso(row.createdAt),
});

class FieldError extends InvalidInput {
  constructor(readonly fields: Record<string, string>) {
    super();
  }
}
const guides: Record<string, string> = {
  input:
    "@핸들 또는 https://www.youtube.com/channel/…, /@…, /user/… 주소를 입력해 주세요.",
  youtubeChannelId: "채널 확인에서 받은 YouTube 채널 ID를 입력해 주세요.",
  email: "254자 이내의 이메일 주소를 입력해 주세요.",
  status: "active 또는 paused를 선택해 주세요.",
  checkIntervalMinutes: "확인 주기는 60·360·1440분 중 하나를 선택해 주세요.",
  token: "수신 주소 확인 메일의 코드를 입력해 주세요.",
};
async function body<T>(c: Context, schema: z.ZodType<T>) {
  rejectQuery(c);
  const parsed = schema.safeParse(await jsonInput(c, z.unknown()));
  if (parsed.success) return parsed.data;
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0]);
    if (guides[field]) fields[field] = guides[field];
  }
  throw new FieldError(fields);
}

export const channelSettings = new Hono<AuthenticatedEnv>();
// 인증 미들웨어를 설정 경로에만 적용해 가입·공개 404 동작을 유지해요.
for (const path of [
  "/channel-previews",
  "/channels",
  "/channels/*",
  "/settings",
  "/recipients",
  "/recipients/*",
  "/recipient-verifications/confirm",
])
  channelSettings.use(path, requireSession, jsonBodyLimit);

channelSettings.post("/channel-previews", async (c) => {
  const input = await body(
    c,
    z.strictObject({ input: z.string().min(1).max(2048) }),
  );
  return c.json(await lookupChannel(c.env, parseChannelInput(input.input)));
});

channelSettings.post("/channels", async (c) => {
  const input = await body(c, z.strictObject({ youtubeChannelId }));
  const found = await lookupChannel(c.env, {
    name: "id",
    value: input.youtubeChannelId,
  });
  const id = crypto.randomUUID();
  const now = unixNow();
  const db = c.env.DB;
  const rows = await db.batch<SubscriptionRow>([
    statement(
      db,
      `INSERT INTO channels (id, youtube_channel_id, title, url, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(youtube_channel_id) DO UPDATE SET title = excluded.title, url = excluded.url`,
      crypto.randomUUID(),
      found.youtubeChannelId,
      found.title,
      found.url,
      now,
    ),
    statement(
      db,
      `INSERT INTO channel_subscriptions (id, user_id, channel_id, created_at)
      SELECT ?, ?, id, ? FROM channels WHERE youtube_channel_id = ?
      ON CONFLICT(user_id, channel_id) WHERE status != 'deleted' DO NOTHING`,
      id,
      c.get("userId"),
      now,
      found.youtubeChannelId,
    ),
    statement(
      db,
      `SELECT ${subscriptionColumns} FROM channel_subscriptions s JOIN channels c ON c.id = s.channel_id WHERE s.id = ? AND s.user_id = ?`,
      id,
      c.get("userId"),
    ),
  ]);
  const row = rows[2]?.results[0];
  if (!row) return c.json({ error: { code: "CHANNEL_EXISTS" } }, 409);
  c.header("Location", `/v1/channels/${id}`);
  return c.json(channelResource(row), 201);
});

channelSettings.get("/channels", async (c) => {
  const { limit, cursor } = parseQuery(c, page);
  const after = parseCursor(cursor);
  const rows = await statement(
    c.env.DB,
    `SELECT ${subscriptionColumns}
    FROM channel_subscriptions s JOIN channels c ON c.id = s.channel_id
    WHERE s.user_id = ? AND s.status != 'deleted'
    ${after ? "AND (s.created_at < ? OR (s.created_at = ? AND s.id < ?))" : ""}
    ORDER BY s.created_at DESC, s.id DESC LIMIT ?`,
    c.get("userId"),
    ...(after ? [after.createdAt, after.createdAt, after.id] : []),
    limit + 1,
  ).all<SubscriptionRow>();
  const items = rows.results.slice(0, limit);
  const last = items.at(-1);
  return c.json({
    items: items.map(channelResource),
    nextCursor: encodeCursor(
      rows.results.length > limit && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
    ),
  });
});

channelSettings.patch("/channels/:id", async (c) => {
  const id = parseIdParam(c);
  const input = await body(
    c,
    z.strictObject({ status: z.enum(["active", "paused"]) }),
  );
  const rows = await c.env.DB.batch<SubscriptionRow>([
    statement(
      c.env.DB,
      `UPDATE channel_subscriptions SET status = ?, next_check_at = CASE
      WHEN ? = 'active' AND last_checked_at IS NOT NULL THEN last_checked_at +
        60 * COALESCE((SELECT check_interval_minutes FROM user_settings WHERE user_id = ?), 360)
      ELSE NULL END WHERE id = ? AND user_id = ? AND status != 'deleted'`,
      input.status,
      input.status,
      c.get("userId"),
      id,
      c.get("userId"),
    ),
    statement(
      c.env.DB,
      `SELECT ${subscriptionColumns} FROM channel_subscriptions s JOIN channels c ON c.id = s.channel_id WHERE s.id = ? AND s.user_id = ? AND s.status != 'deleted'`,
      id,
      c.get("userId"),
    ),
  ]);
  const row = rows[1]?.results[0];
  return row
    ? c.json(channelResource(row))
    : c.json({ error: { code: "NOT_FOUND" } }, 404);
});

channelSettings.delete("/channels/:id", async (c) => {
  rejectQuery(c);
  const id = parseIdParam(c);
  const result = await statement(
    c.env.DB,
    "UPDATE channel_subscriptions SET status = 'deleted', next_check_at = NULL WHERE id = ? AND user_id = ? AND status != 'deleted'",
    id,
    c.get("userId"),
  ).run();
  return result.meta.changes
    ? c.body(null, 204)
    : c.json({ error: { code: "NOT_FOUND" } }, 404);
});

channelSettings.get("/settings", async (c) => {
  rejectQuery(c);
  const minutes = await statement(
    c.env.DB,
    "SELECT check_interval_minutes AS checkIntervalMinutes FROM user_settings WHERE user_id = ?",
    c.get("userId"),
  ).first<number>("checkIntervalMinutes");
  return c.json({ checkIntervalMinutes: minutes ?? 360 });
});

channelSettings.patch("/settings", async (c) => {
  const input = await body(
    c,
    z.strictObject({
      checkIntervalMinutes: z.union([
        z.literal(60),
        z.literal(360),
        z.literal(1440),
      ]),
    }),
  );
  await c.env.DB.batch([
    statement(
      c.env.DB,
      `INSERT INTO user_settings (user_id, check_interval_minutes) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET check_interval_minutes = excluded.check_interval_minutes`,
      c.get("userId"),
      input.checkIntervalMinutes,
    ),
    statement(
      c.env.DB,
      "UPDATE channel_subscriptions SET next_check_at = last_checked_at + ? * 60 WHERE user_id = ? AND status = 'active' AND last_checked_at IS NOT NULL",
      input.checkIntervalMinutes,
      c.get("userId"),
    ),
  ]);
  return c.json(input);
});

channelSettings.get("/recipients", async (c) => {
  const { limit, cursor } = parseQuery(c, page);
  const after = parseCursor(cursor);
  const rows = await statement(
    c.env.DB,
    `SELECT ${recipientColumns} FROM recipients WHERE user_id = ? AND deleted_at IS NULL
    ${after ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""}
    ORDER BY created_at DESC, id DESC LIMIT ?`,
    c.get("userId"),
    ...(after ? [after.createdAt, after.createdAt, after.id] : []),
    limit + 1,
  ).all<RecipientRow>();
  const items = rows.results.slice(0, limit);
  const last = items.at(-1);
  return c.json({
    items: items.map(recipientResource),
    nextCursor: encodeCursor(
      rows.results.length > limit && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
    ),
  });
});

channelSettings.post("/recipients", async (c) => {
  const input = await body(c, z.strictObject({ email }));
  const id = crypto.randomUUID();
  const row = await statement(
    c.env.DB,
    `INSERT INTO recipients (id, user_id, email, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, email) WHERE deleted_at IS NULL DO NOTHING RETURNING ${recipientColumns}`,
    id,
    c.get("userId"),
    input.email,
    unixNow(),
  ).first<RecipientRow>();
  if (!row) return c.json({ error: { code: "RECIPIENT_EXISTS" } }, 409);
  c.header("Location", `/v1/recipients/${id}`);
  return c.json(recipientResource(row), 201);
});

channelSettings.post("/recipients/:id/verifications", async (c) => {
  rejectQuery(c);
  if ((await c.req.text()).length) throw new InvalidInput();
  const id = parseIdParam(c);
  const row = await statement(
    c.env.DB,
    `SELECT ${recipientColumns} FROM recipients WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    id,
    c.get("userId"),
  ).first<RecipientRow>();
  if (!row) return c.json({ error: { code: "NOT_FOUND" } }, 404);
  if (row.verifiedAt !== null)
    throw new FieldError({ email: "이미 확인한 수신 주소예요." });
  const now = unixNow();
  const retryAfter = await consumeRateLimits(
    c.env,
    [
      {
        scope: "mail-ip",
        value: c.req.header("cf-connecting-ip") ?? "unknown",
        limit: 10,
        window: 3600,
      },
      { scope: "mail-target", value: row.email, limit: 3, window: 3600 },
      { scope: "mail-gap", value: row.email, limit: 1, window: 60 },
    ],
    now,
  );
  if (retryAfter) {
    c.header("Retry-After", String(retryAfter));
    return c.json({ error: { code: "RATE_LIMITED" } }, 429);
  }
  const rows = await c.env.DB.batch(
    await issueRecipientTokenStatements(c.env, c.get("userId"), id, now),
  );
  // 조회 뒤 삭제·확인된 주소에는 발송을 접수했다고 응답하지 않아요.
  if (rows[2]?.meta.changes !== 1)
    return c.json({ error: { code: "NOT_FOUND" } }, 404);
  return c.json({ status: "accepted" }, 202);
});

channelSettings.post("/recipient-verifications/confirm", async (c) => {
  const input = await body(
    c,
    z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
  );
  const now = unixNow();
  const row = await statement(
    c.env.DB,
    `SELECT t.id, t.recipient_id AS recipientId FROM account_tokens t JOIN recipients r ON r.id = t.recipient_id AND r.user_id = t.user_id
    WHERE t.token_hash = ? AND t.user_id = ? AND t.purpose = 'verify_recipient' AND t.consumed_at IS NULL AND t.expires_at > ? AND r.deleted_at IS NULL AND r.verified_at IS NULL`,
    await sha256Hex(input.token),
    c.get("userId"),
    now,
  ).first<RecipientTokenRow>();
  if (!row) return c.json({ error: { code: "INVALID_TOKEN" } }, 400);
  const rows = await c.env.DB.batch([
    statement(
      c.env.DB,
      `UPDATE recipients SET verified_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND verified_at IS NULL
      AND EXISTS (SELECT 1 FROM account_tokens WHERE id = ? AND consumed_at IS NULL AND expires_at > ?)`,
      now,
      row.recipientId,
      c.get("userId"),
      row.id,
      now,
    ),
    statement(
      c.env.DB,
      "DELETE FROM auth_mail_outbox WHERE token_id = ?",
      row.id,
    ),
    statement(
      c.env.DB,
      "UPDATE account_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?",
      now,
      row.id,
      now,
    ),
  ]);
  if (rows[0]?.meta.changes !== 1 || rows[2]?.meta.changes !== 1)
    return c.json({ error: { code: "INVALID_TOKEN" } }, 400);
  return c.body(null, 204);
});

channelSettings.delete("/recipients/:id", async (c) => {
  rejectQuery(c);
  const id = parseIdParam(c);
  const rows = await c.env.DB.batch([
    // recipient_stop이 토큰을 지우기 전에 FK로 묶인 암호화 메일을 먼저 지워요.
    statement(
      c.env.DB,
      "DELETE FROM auth_mail_outbox WHERE token_id IN (SELECT id FROM account_tokens WHERE recipient_id = ? AND user_id = ?)",
      id,
      c.get("userId"),
    ),
    statement(
      c.env.DB,
      "UPDATE recipients SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
      unixNow(),
      id,
      c.get("userId"),
    ),
  ]);
  return rows[1]?.meta.changes
    ? c.body(null, 204)
    : c.json({ error: { code: "NOT_FOUND" } }, 404);
});

channelSettings.onError((error, c) => {
  if (error instanceof FieldError)
    return c.json(
      { error: { code: "INVALID_INPUT", fields: error.fields } },
      400,
    );
  if (error instanceof ChannelInputError) {
    const field = c.req.path.endsWith("channel-previews")
      ? "input"
      : "youtubeChannelId";
    return c.json(
      { error: { code: "INVALID_INPUT", fields: { [field]: guides[field] } } },
      400,
    );
  }
  if (error instanceof InvalidInput)
    return c.json({ error: { code: "INVALID_INPUT" } }, 400);
  if (error instanceof ChannelLookupError || error instanceof AuthConfigError)
    return c.json({ error: { code: "SERVICE_UNAVAILABLE" } }, 503);
  return c.json({ error: { code: "INTERNAL_ERROR" } }, 500);
});
