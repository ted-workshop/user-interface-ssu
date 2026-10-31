import { Buffer } from "node:buffer";
import type { Context } from "hono";
import { z } from "zod";

export class InvalidInput extends Error {}

const cursorSchema = z.strictObject({
  createdAt: z.number().int().min(0).max(253402300799),
  id: z.uuid(),
});

export const pageQuery = {
  // 정수의 십진 표기만 허용해 빈 값·소수·지수 표기를 거부해요.
  limit: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().max(100))
    .default(20),
  cursor: z.string().min(1).max(512).optional(),
};

export function parseCursor(encoded: string | undefined) {
  if (encoded === undefined) return undefined;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) throw new InvalidInput();
    return cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
  } catch {
    throw new InvalidInput();
  }
}

export function encodeCursor(cursor: { createdAt: number; id: string } | null) {
  return cursor
    ? Buffer.from(JSON.stringify(cursor)).toString("base64url")
    : null;
}

export function parseQuery<T>(c: Context, schema: z.ZodType<T>) {
  const query = c.req.queries();
  if (Object.values(query).some((values) => values.length !== 1))
    throw new InvalidInput();
  const parsed = schema.safeParse(
    Object.fromEntries(
      Object.entries(query).map(([key, values]) => [key, values[0]]),
    ),
  );
  if (!parsed.success) throw new InvalidInput();
  return parsed.data;
}

export function parseIdParam(c: Context) {
  const parsed = z.uuid().safeParse(c.req.param("id"));
  if (!parsed.success) throw new InvalidInput();
  return parsed.data;
}
