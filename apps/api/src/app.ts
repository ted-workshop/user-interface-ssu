import { Hono } from "hono";

export function createApp() {
  const app = new Hono();
  app.get("/health", (c) => c.json({ status: "ok", service: "qletter-api" }));
  app.notFound((c) => c.json({ error: { code: "NOT_FOUND" } }, 404));
  app.onError((_error, c) =>
    c.json({ error: { code: "INTERNAL_ERROR" } }, 500),
  );
  return app;
}
