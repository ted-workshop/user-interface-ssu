import { type Context, Hono } from "hono";
import { z } from "zod";
import { requireSession } from "./auth";
import {
  AuthConfigError,
  issueTokenStatements,
  randomToken,
  sha256Hex,
  type TokenPurpose,
} from "./auth-mail";
import { InvalidInput, jsonBodyLimit, jsonInput } from "./http-input";
import { statement, unixNow } from "./jobs/shared";
import { hashPassword, isAcceptablePassword, verifyPassword } from "./password";
import { consumeRateLimits, type RateRule } from "./rate-limit";
import type { AccountRow, AccountTokenRow, LoginUserRow } from "./rows";

const SESSION_SECONDS = 30 * 86_400;
const MINUTE = 60;
const HOUR = 3_600;
// 계약의 초기 방어 수치예요. 확인 경로는 해시 남용을 줄이려고 추가했어요(ADR-0028).
const LOGIN_PER_IP_PER_MINUTE = 5;
const LOGIN_PER_EMAIL_PER_MINUTE = 5;
const CONFIRM_PER_IP_PER_MINUTE = 5;
const REGISTER_PER_IP_PER_HOUR = 10;
const MAIL_PER_IP_PER_HOUR = 10;
const MAIL_PER_TARGET_PER_HOUR = 3;
const MAIL_PER_TARGET_PER_MINUTE = 1;
const MAX_EMAIL_LENGTH = 254;
const MIN_NICKNAME_LENGTH = 2;
const MAX_NICKNAME_LENGTH = 20;
// 로그인은 비밀번호 정책을 다시 검사하지 않고 해시할 입력 길이만 제한해요.
const MAX_LOGIN_PASSWORD_LENGTH = 1024;
// 32바이트 토큰의 padding 없는 base64url만 받아요.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REVOKABLE = "('verify_email', 'reset_password')";

const email = z
  .string()
  .transform((value) =>
    value.trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase()),
  )
  .pipe(z.email().max(MAX_EMAIL_LENGTH));
const newPassword = z.string().refine(isAcceptablePassword);
const nickname = z
  .string()
  .transform((value) => value.normalize("NFC").trim())
  .refine((value) => {
    const length = Array.from(value).length;
    // 제어문자·줄바꿈은 표시 이름에 허용하지 않아요.
    return (
      length >= MIN_NICKNAME_LENGTH &&
      length <= MAX_NICKNAME_LENGTH &&
      !/\p{Cc}/u.test(value)
    );
  });
const token = z.string().regex(TOKEN_PATTERN);
const anyPassword = z.string().min(1).max(MAX_LOGIN_PASSWORD_LENGTH);

const FIELD_GUIDE: Record<string, string> = {
  email: "이메일 주소를 확인해 주세요.",
  password: "비밀번호는 8~128자이고 한 글자만 반복할 수 없어요.",
  nickname: "닉네임은 2~20자로 입력해 주세요.",
  token: "확인 코드를 확인해 주세요.",
};

class FieldError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super("INVALID_INPUT");
  }
}
class RateLimited extends Error {
  constructor(readonly retryAfter: number) {
    super("RATE_LIMITED");
  }
}
class InvalidToken extends Error {}

async function body<T>(c: Context, schema: z.ZodType<T>) {
  rejectQuery(c);
  const parsed = schema.safeParse(await jsonInput(c, z.unknown()));
  if (parsed.success) return parsed.data;
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const guide = FIELD_GUIDE[String(issue.path[0])];
    if (guide) fields[String(issue.path[0])] = guide;
  }
  throw new FieldError(fields);
}

function rejectQuery(c: Context) {
  if (Object.keys(c.req.query()).length) throw new InvalidInput();
}

async function limit(c: Context<{ Bindings: Env }>, rules: RateRule[]) {
  const retryAfter = await consumeRateLimits(c.env, rules, unixNow());
  if (retryAfter > 0) throw new RateLimited(retryAfter);
}

const ipRule = (
  c: Context,
  scope: string,
  max: number,
  window: number,
): RateRule => ({
  scope,
  value: c.req.header("cf-connecting-ip") ?? "unknown",
  limit: max,
  window,
});

function requestMail(purpose: TokenPurpose, where: string) {
  return async (c: Context<{ Bindings: Env }>) => {
    const input = await body(c, z.strictObject({ email }));
    await limit(c, [
      ipRule(c, "mail-ip", MAIL_PER_IP_PER_HOUR, HOUR),
      {
        scope: "mail-target",
        value: input.email,
        limit: MAIL_PER_TARGET_PER_HOUR,
        window: HOUR,
      },
      {
        scope: "mail-gap",
        value: input.email,
        limit: MAIL_PER_TARGET_PER_MINUTE,
        window: MINUTE,
      },
    ]);
    await c.env.DB.batch(
      await issueTokenStatements(
        c.env,
        { where, value: input.email },
        purpose,
        unixNow(),
      ),
    );
    return c.json({ status: "accepted" }, 202);
  };
}

async function findToken(
  c: Context<{ Bindings: Env }>,
  value: string,
  purpose: TokenPurpose,
  now: number,
) {
  const row = await statement(
    c.env.DB,
    "SELECT id, user_id AS userId FROM account_tokens WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?",
    await sha256Hex(value),
    purpose,
    now,
  ).first<AccountTokenRow>();
  if (!row) throw new InvalidToken();
  return row;
}

export const accounts = new Hono<{ Bindings: Env }>();
accounts.use("/auth/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});
accounts.use("/auth/*", jsonBodyLimit);

accounts.post("/auth/registrations", async (c) => {
  const input = await body(
    c,
    z.strictObject({ email, password: newPassword, nickname }),
  );
  await limit(c, [ipRule(c, "register-ip", REGISTER_PER_IP_PER_HOUR, HOUR)]);
  // 중복 여부와 상관없이 먼저 해시해 계정 유무에 따른 처리 시간 차이를 줄여요.
  const passwordHash = await hashPassword(input.password);
  const id = crypto.randomUUID();
  const now = unixNow();
  await c.env.DB.batch([
    statement(
      c.env.DB,
      `INSERT INTO users (id, email, nickname, password_hash, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(email) DO NOTHING`,
      id,
      input.email,
      input.nickname,
      passwordHash,
      now,
    ),
    // 새로 넣은 ID로만 찾으므로 중복 가입은 기존 계정과 메일을 건드리지 않아요.
    ...(await issueTokenStatements(
      c.env,
      { where: "u.id = ?", value: id },
      "verify_email",
      now,
    )),
  ]);
  return c.json({ status: "verification_required" }, 202);
});

accounts.post(
  "/auth/email-verifications",
  requestMail("verify_email", "u.email = ? AND u.email_verified_at IS NULL"),
);

accounts.post("/auth/email-verifications/confirm", async (c) => {
  const input = await body(c, z.strictObject({ token, password: anyPassword }));
  await limit(c, [ipRule(c, "confirm-ip", CONFIRM_PER_IP_PER_MINUTE, MINUTE)]);
  const now = unixNow();
  const found = await findToken(c, input.token, "verify_email", now);
  const stored = await statement(
    c.env.DB,
    "SELECT password_hash AS passwordHash FROM users WHERE id = ?",
    found.userId,
  ).first<string>("passwordHash");
  // 메일 코드만으로 남이 등록한 계정을 활성화하지 못하게 가입 비밀번호도 확인해요.
  if (!(await verifyPassword(input.password, stored))) throw new InvalidToken();
  const db = c.env.DB;
  const rows = await db.batch([
    statement(
      db,
      `UPDATE users SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL
      AND EXISTS (SELECT 1 FROM account_tokens WHERE id = ? AND consumed_at IS NULL)`,
      now,
      found.userId,
      found.id,
    ),
    statement(db, "DELETE FROM auth_mail_outbox WHERE token_id = ?", found.id),
    statement(
      db,
      "UPDATE account_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?",
      now,
      found.id,
      now,
    ),
  ]);
  if (rows[2]?.meta.changes !== 1) throw new InvalidToken();
  return c.body(null, 204);
});

accounts.post("/auth/sessions", async (c) => {
  const input = await body(c, z.strictObject({ email, password: anyPassword }));
  await limit(c, [
    ipRule(c, "login-ip", LOGIN_PER_IP_PER_MINUTE, MINUTE),
    {
      scope: "login-email",
      value: input.email,
      limit: LOGIN_PER_EMAIL_PER_MINUTE,
      window: MINUTE,
    },
  ]);
  const user = await statement(
    c.env.DB,
    "SELECT id, email, nickname, password_hash AS passwordHash, email_verified_at AS emailVerifiedAt FROM users WHERE email = ?",
    input.email,
  ).first<LoginUserRow>();
  const matches = await verifyPassword(
    input.password,
    user?.passwordHash ?? null,
  );
  if (!user || !matches)
    return c.json({ error: { code: "INVALID_CREDENTIALS" } }, 401);
  if (user.emailVerifiedAt === null)
    return c.json({ error: { code: "EMAIL_VERIFICATION_REQUIRED" } }, 403);
  const now = unixNow();
  const sessionToken = randomToken();
  const expiresAt = now + SESSION_SECONDS;
  await statement(
    c.env.DB,
    "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    crypto.randomUUID(),
    user.id,
    await sha256Hex(sessionToken),
    now,
    expiresAt,
  ).run();
  return c.json(
    {
      sessionToken,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      user: { id: user.id, email: user.email, nickname: user.nickname },
    },
    201,
  );
});

accounts.delete("/auth/session", requireSession, async (c) => {
  rejectQuery(c);
  await statement(
    c.env.DB,
    "DELETE FROM sessions WHERE token_hash = ?",
    c.get("sessionTokenHash"),
  ).run();
  return c.body(null, 204);
});

accounts.get("/me", requireSession, async (c) => {
  rejectQuery(c);
  const user = await statement(
    c.env.DB,
    "SELECT id, email, nickname FROM users WHERE id = ?",
    c.get("userId"),
  ).first<AccountRow>();
  if (!user) return c.json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
  // requireSession이 이메일 확인을 이미 검사해요.
  return c.json({ ...user, emailVerified: true });
});

accounts.post(
  "/auth/password-resets",
  requestMail("reset_password", "u.email = ?"),
);

accounts.post("/auth/password-resets/confirm", async (c) => {
  const input = await body(c, z.strictObject({ token, password: newPassword }));
  await limit(c, [ipRule(c, "confirm-ip", CONFIRM_PER_IP_PER_MINUTE, MINUTE)]);
  const now = unixNow();
  const found = await findToken(c, input.token, "reset_password", now);
  const passwordHash = await hashPassword(input.password);
  const db = c.env.DB;
  // 모든 변경은 이 토큰이 살아 있을 때만 적용하고 소비를 마지막에 둬서 동시 요청은 한 번만 성공해요.
  const live =
    "EXISTS (SELECT 1 FROM account_tokens WHERE id = ? AND consumed_at IS NULL AND expires_at > ?)";
  const rows = await db.batch([
    statement(
      db,
      `UPDATE users SET password_hash = ? WHERE id = ? AND ${live}`,
      passwordHash,
      found.userId,
      found.id,
      now,
    ),
    statement(
      db,
      `DELETE FROM sessions WHERE user_id = ? AND ${live}`,
      found.userId,
      found.id,
      now,
    ),
    statement(
      db,
      `DELETE FROM auth_mail_outbox WHERE token_id IN (
        SELECT id FROM account_tokens WHERE user_id = ? AND purpose IN ${REVOKABLE}) AND ${live}`,
      found.userId,
      found.id,
      now,
    ),
    statement(
      db,
      `UPDATE account_tokens SET consumed_at = ?
      WHERE user_id = ? AND purpose IN ${REVOKABLE} AND consumed_at IS NULL AND expires_at > ? AND id != ? AND ${live}`,
      now,
      found.userId,
      now,
      found.id,
      found.id,
      now,
    ),
    statement(
      db,
      "UPDATE account_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?",
      now,
      found.id,
      now,
    ),
  ]);
  if (rows[4]?.meta.changes !== 1) throw new InvalidToken();
  return c.body(null, 204);
});

accounts.onError((error, c) => {
  if (error instanceof FieldError)
    return c.json(
      {
        error: {
          code: "INVALID_INPUT",
          ...(Object.keys(error.fields).length ? { fields: error.fields } : {}),
        },
      },
      400,
    );
  if (error instanceof InvalidInput)
    return c.json({ error: { code: "INVALID_INPUT" } }, 400);
  if (error instanceof InvalidToken)
    return c.json({ error: { code: "INVALID_TOKEN" } }, 400);
  if (error instanceof RateLimited) {
    c.header("Retry-After", String(error.retryAfter));
    return c.json({ error: { code: "RATE_LIMITED" } }, 429);
  }
  if (error instanceof AuthConfigError)
    return c.json({ error: { code: "SERVICE_UNAVAILABLE" } }, 503);
  return c.json({ error: { code: "INTERNAL_ERROR" } }, 500);
});
