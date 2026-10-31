import { Hono } from "hono";
import { reports } from "./reports";
import { summaryRequests } from "./summary-requests";

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.get("/health", (c) => {
    c.header("X-Qletter-Revision", c.env.BUILD_REVISION);
    return c.json({ status: "ok", service: "qletter-api" });
  });
  app.route("/v1/summary-requests", summaryRequests);
  app.route("/v1/reports", reports);
  app.notFound((c) => c.json({ error: { code: "NOT_FOUND" } }, 404));
  app.onError((_error, c) =>
    c.json({ error: { code: "INTERNAL_ERROR" } }, 500),
  );
  return app;
}
