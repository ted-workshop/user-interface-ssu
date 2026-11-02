import { Buffer } from "node:buffer";
import { authKeyBytes } from "./auth-mail";
import { statement } from "./jobs/shared";
import type { RateLimitRow } from "./rows";

export type RateRule = {
  scope: string;
  value: string;
  limit: number;
  window: number;
};

async function bucketKey(env: Env, rule: RateRule) {
  const key = await crypto.subtle.importKey(
    "raw",
    authKeyBytes(env),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${rule.scope}:${rule.value}`),
  );
  return `${rule.scope}:${Buffer.from(signature).toString("hex")}`;
}

// 모든 규칙을 한 batch로 세고, 넘친 규칙이 있으면 기다릴 초를 돌려줘요.
export async function consumeRateLimits(
  env: Env,
  rules: RateRule[],
  now: number,
) {
  const statements = await Promise.all(
    rules.map(async (rule) => {
      // 첫 요청부터 윈도우를 세서 시계 경계에서 연달아 통과하지 않아요.
      return statement(
        env.DB,
        `INSERT INTO auth_rate_limits (key, window_end, count) VALUES (?, ?, 1)
        ON CONFLICT(key) DO UPDATE SET
          count = CASE WHEN window_end > ? THEN count + 1 ELSE 1 END,
          window_end = CASE WHEN window_end > ? THEN window_end ELSE excluded.window_end END
        RETURNING count, window_end AS windowEnd`,
        await bucketKey(env, rule),
        now + rule.window,
        now,
        now,
      );
    }),
  );
  const rows = await env.DB.batch<RateLimitRow>(statements);
  let retryAfter = 0;
  rows.forEach((result, index) => {
    const row = result.results[0];
    const rule = rules[index];
    if (row && rule && row.count > rule.limit)
      retryAfter = Math.max(retryAfter, row.windowEnd - now);
  });
  return retryAfter;
}
