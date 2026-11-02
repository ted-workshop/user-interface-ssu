import { Buffer } from "node:buffer";
import { EmailError, type sendEmail } from "./email";
import { statement } from "./jobs/shared";
import type { AuthMailRow } from "./rows";

export type TokenPurpose = "verify_email" | "reset_password";

const TOKEN_LIFETIME: Record<TokenPurpose, number> = {
  verify_email: 86_400,
  reset_password: 1_800,
};
const LEASE_SECONDS = 120;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [60, 300];

export class AuthConfigError extends Error {}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Buffer.from(digest).toString("hex");
}

export function randomToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
}

export function authKeyBytes(env: Env) {
  const bytes = Buffer.from(env.AUTH_TOKEN_KEY ?? "", "base64url");
  if (bytes.length !== 32) throw new AuthConfigError();
  return bytes;
}

function aesKey(env: Env) {
  return crypto.subtle.importKey("raw", authKeyBytes(env), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encrypt(env: Env, plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(env),
    new TextEncoder().encode(plain),
  );
  return `${Buffer.from(iv).toString("base64url")}.${Buffer.from(sealed).toString("base64url")}`;
}

async function decrypt(env: Env, sealed: string) {
  const [iv, data] = sealed.split(".");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(iv ?? "", "base64url") },
    await aesKey(env),
    Buffer.from(data ?? "", "base64url"),
  );
  return new TextDecoder().decode(plain);
}

// 대상의 이전 토큰을 폐기하고 새 토큰과 발송 작업을 만들어요.
// 대상이 없으면 아무 행도 바뀌지 않아 호출부가 계정 유무로 분기하지 않아요.
export async function issueTokenStatements(
  env: Env,
  target: { where: string; value: string },
  purpose: TokenPurpose,
  now: number,
) {
  const db = env.DB;
  const token = randomToken();
  const tokenId = crypto.randomUUID();
  const expiresAt = now + TOKEN_LIFETIME[purpose];
  const user = `(SELECT id FROM users u WHERE ${target.where})`;
  return [
    statement(
      db,
      `DELETE FROM auth_mail_outbox WHERE token_id IN (
        SELECT id FROM account_tokens WHERE purpose = ? AND user_id = ${user})`,
      purpose,
      target.value,
    ),
    statement(
      db,
      `UPDATE account_tokens SET consumed_at = ?
      WHERE purpose = ? AND consumed_at IS NULL AND expires_at > ? AND user_id = ${user}`,
      now,
      purpose,
      now,
      target.value,
    ),
    statement(
      db,
      `INSERT INTO account_tokens (id, user_id, purpose, token_hash, created_at, expires_at)
      SELECT ?, u.id, ?, ?, ?, ? FROM users u WHERE ${target.where}`,
      tokenId,
      purpose,
      await sha256Hex(token),
      now,
      expiresAt,
      target.value,
    ),
    statement(
      db,
      `INSERT INTO auth_mail_outbox (id, token_id, token_ciphertext, available_at, expires_at, created_at)
      SELECT ?, id, ?, ?, ?, ? FROM account_tokens WHERE id = ?`,
      crypto.randomUUID(),
      await encrypt(env, token),
      now,
      expiresAt,
      now,
      tokenId,
    ),
  ];
}

function authMailLog(event: string, id: string, reason: string | null = null) {
  // 주소·토큰은 로그에 남기지 않아요.
  console.info(JSON.stringify({ event: `auth_mail.${event}`, id, reason }));
}

function message(purpose: string, token: string) {
  const verify = purpose === "verify_email";
  const guide = verify
    ? "앱의 이메일 확인 화면에 아래 코드와 가입한 비밀번호를 입력해 주세요. 24시간 동안 사용할 수 있어요."
    : "앱의 비밀번호 재설정 화면에 아래 코드와 새 비밀번호를 입력해 주세요. 30분 동안 사용할 수 있어요.";
  const ignore = "직접 요청하지 않았다면 이 메일을 무시해 주세요.";
  return {
    subject: verify ? "Qletter 이메일 확인" : "Qletter 비밀번호 재설정",
    text: `${guide}\n\n${token}\n\n${ignore}`,
    html: `<p>${guide}</p><p><code>${token}</code></p><p>${ignore}</p>`,
  };
}

// 대기 중인 인증 메일 한 통을 보내고, 끝난 행은 암호문과 함께 지워요.
export async function runAuthMail(
  env: Env,
  send: typeof sendEmail,
  now: number,
) {
  const db = env.DB;
  const lease = crypto.randomUUID();
  const claimed = await db.batch<AuthMailRow>([
    // 호출 후 중단은 접수 여부를 알 수 없어요. 자동 재발송 없이 지우고 사용자 재요청에 맡겨요.
    statement(
      db,
      "DELETE FROM auth_mail_outbox WHERE expires_at <= ? OR lease_expires_at <= ?",
      now,
      now,
    ),
    statement(db, "DELETE FROM auth_rate_limits WHERE window_end <= ?", now),
    statement(
      db,
      `UPDATE auth_mail_outbox SET lease_token = ?, lease_expires_at = ?, attempts = attempts + 1
      WHERE id = (SELECT id FROM auth_mail_outbox WHERE lease_token IS NULL AND available_at <= ?
        ORDER BY available_at, id LIMIT 1)`,
      lease,
      now + LEASE_SECONDS,
      now,
    ),
    statement(
      db,
      `SELECT o.id, o.token_ciphertext AS tokenCiphertext, o.attempts, t.purpose, u.email
      FROM auth_mail_outbox o JOIN account_tokens t ON t.id = o.token_id JOIN users u ON u.id = t.user_id
      WHERE o.lease_token = ?`,
      lease,
    ),
  ]);
  const row = claimed[3]?.results[0];
  if (!row) return;
  const remove = () =>
    statement(db, "DELETE FROM auth_mail_outbox WHERE id = ?", row.id).run();
  try {
    const token = await decrypt(env, row.tokenCiphertext);
    await send(
      { user: env.SMTP_USER, appPassword: env.SMTP_APP_PASSWORD },
      { deliveryId: row.id, to: row.email, ...message(row.purpose, token) },
    );
    await remove();
    authMailLog("sent", row.id);
  } catch (error) {
    const reason = error instanceof EmailError ? error.reason : "unknown";
    const delay = RETRY_DELAYS[row.attempts - 1];
    if (reason === "temporary" && row.attempts < MAX_ATTEMPTS && delay) {
      await statement(
        db,
        "UPDATE auth_mail_outbox SET lease_token = NULL, lease_expires_at = NULL, available_at = ? WHERE id = ?",
        now + delay,
        row.id,
      ).run();
      authMailLog("retry", row.id, reason);
      return;
    }
    await remove();
    authMailLog("dropped", row.id, reason);
  }
}
