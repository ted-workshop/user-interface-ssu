import { Hono } from "hono";
import { z } from "zod";
import { type AuthenticatedEnv, requireSession } from "./auth";
import {
  InvalidInput,
  invalidInputResponse,
  jsonBodyLimit,
  jsonInput,
  parseIdParam,
  rejectQuery,
} from "./http-input";
import { retryDelivery } from "./jobs/delivery";
import { JobError } from "./jobs/shared";
import type { DeliveryRow } from "./rows";

export function deliveryResource(row: DeliveryRow & { retryable: boolean }) {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    attempt: row.attempt,
    failureCode: row.failureCode,
    retryable: row.retryable,
  };
}

const retry = z.strictObject({
  attempt: z.number().int().min(1).max(3),
});

export const deliveries = new Hono<AuthenticatedEnv>();
deliveries.use("/:id/retry", requireSession, jsonBodyLimit);

deliveries.post("/:id/retry", async (c) => {
  rejectQuery(c);
  const input = await jsonInput(c, retry);
  const result = await retryDelivery(
    c.env.DB,
    c.get("userId"),
    parseIdParam(c),
    input.attempt,
  );
  return c.json(deliveryResource(result), result.accepted ? 202 : 200);
});

deliveries.onError((error, c) => {
  if (error instanceof InvalidInput) return invalidInputResponse(c, error);
  if (error instanceof JobError) {
    switch (error.code) {
      case "NOT_FOUND":
        return c.json({ error: { code: "NOT_FOUND" } }, 404);
      case "RETRY_NOT_ALLOWED":
        return c.json({ error: { code: "RETRY_NOT_ALLOWED" } }, 409);
    }
  }
  return c.json({ error: { code: "INTERNAL_ERROR" } }, 500);
});
