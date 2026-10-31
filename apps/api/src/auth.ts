import { createMiddleware } from "hono/factory";
import { statement, unixNow } from "./jobs/shared";

export type AuthenticatedEnv = {
  Bindings: Env;
  Variables: { userId: string };
};

export const requireSession = createMiddleware<AuthenticatedEnv>(
  async (c, next) => {
    c.header("Cache-Control", "no-store");
    // 32바이트 세션 토큰의 padding 없는 base64url만 받아요.
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(
      c.req.header("Authorization") ?? "",
    )?.[1];
    if (!token)
      return c.json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(token),
    );
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const session = await statement(
      c.env.DB,
      `SELECT s.user_id FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.email_verified_at IS NOT NULL`,
      hash,
      unixNow(),
    ).first<{ user_id: string }>();
    if (!session)
      return c.json({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
    c.set("userId", session.user_id);
    await next();
  },
);
