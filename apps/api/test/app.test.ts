import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

describe("Worker API contract", () => {
  test("health identifies the running API without a provider key or schema", async () => {
    const response = await exports.default.fetch("http://localhost/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-qletter-revision")).toBe("local");
    expect(await response.json()).toEqual({
      status: "ok",
      service: "qletter-api",
    });
  });

  test("unknown routes return a JSON 404", async () => {
    const response = await exports.default.fetch("http://localhost/missing");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND" } });
  });

  test("unexpected failures do not expose internal error details", async () => {
    const app = createApp();
    app.get("/failure", () => {
      throw new Error("private-detail");
    });
    const response = await app.request("/failure", undefined, env);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR" },
    });
  });

  test("a handler can query its D1 binding and repeat migrations safely", async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

    const app = createApp();
    app.get("/database", async (c) => {
      const result = await c.env.DB.prepare(
        "SELECT name FROM d1_migrations ORDER BY id",
      ).all();
      return c.json(result.results);
    });
    const response = await app.request("/database", undefined, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ name: "0001_initialize.sql" }]);

    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'",
    ).all();
    expect(tables.results).toEqual([]);
  });

  test("a D1 query failure keeps the common error contract", async () => {
    const app = createApp();
    app.get("/database-failure", async (c) => {
      await c.env.DB.prepare("SELECT * FROM private_missing_table").all();
      return c.json({ status: "ok" });
    });
    const response = await app.request("/database-failure", undefined, env);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR" },
    });
  });
});
