import { Buffer } from "node:buffer";
import { scrypt, timingSafeEqual } from "node:crypto";

// OWASP scrypt 권고 중 메모리가 가장 적은 구성이에요. 선택 근거는 ADR-0028에 있어요.
const N = 8192;
const R = 8;
const P = 10;
const KEY_LENGTH = 32;
const MAX_MEMORY = 32 * 1024 * 1024;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

// 없는 계정의 로그인도 같은 비용으로 검증해 처리 시간 차이를 줄여요.
const DUMMY_HASH = `scrypt$${N}$${R}$${P}$${"A".repeat(22)}$${"A".repeat(43)}`;

function derive(
  password: string,
  salt: Buffer,
  cost: { n: number; r: number; p: number },
) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: cost.n, r: cost.r, p: cost.p, maxmem: MAX_MEMORY },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export function isAcceptablePassword(password: string) {
  const points = Array.from(password);
  if (points.length < MIN_PASSWORD_LENGTH) return false;
  if (points.length > MAX_PASSWORD_LENGTH) return false;
  return new Set(points).size > 1;
}

export async function hashPassword(password: string) {
  const salt = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
  const key = await derive(password, salt, { n: N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string | null) {
  const [scheme, n, r, p, salt, expected] = (stored ?? DUMMY_HASH).split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !expected) return false;
  const key = await derive(password, Buffer.from(salt, "base64url"), {
    n: Number(n),
    r: Number(r),
    p: Number(p),
  });
  const matches = timingSafeEqual(key, Buffer.from(expected, "base64url"));
  return stored !== null && matches;
}
