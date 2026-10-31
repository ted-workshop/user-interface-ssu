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

describe("Worker API 응답 규약", () => {
  test("공급자 키나 제품 스키마 없이 실행 중인 API를 확인해요", async () => {
    const response = await exports.default.fetch("http://localhost/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-qletter-revision")).toBe("local");
    expect(await response.json()).toEqual({
      status: "ok",
      service: "qletter-api",
    });
  });

  test("없는 경로는 JSON 404를 반환해요", async () => {
    const response = await exports.default.fetch("http://localhost/missing");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND" } });
  });

  test("예상하지 못한 실패에서도 내부 오류 내용을 노출하지 않아요", async () => {
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

  test("핸들러에서 D1을 조회하고 마이그레이션을 안전하게 반복해요", async () => {
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
    expect(await response.json()).toEqual([
      { name: "0001_initialize.sql" },
      { name: "0002_product_schema.sql" },
      { name: "0003_shared_reports.sql" },
      { name: "0004_job_leases.sql" },
      { name: "0005_summary_admissions.sql" },
    ]);
  });

  test("D1 조회가 실패해도 공통 오류 응답 규약을 유지해요", async () => {
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
