import { describe, expect, test } from "bun:test";
import { createApp } from "./app";

describe("API contract", () => {
  test("health identifies the running API without requiring a Gemini key", async () => {
    const response = await createApp().request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "qletter-api",
    });
  });

  test("unknown routes return a JSON 404", async () => {
    const response = await createApp().request("/missing");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND" } });
  });

  test("unexpected failures do not expose internal error details", async () => {
    const app = createApp();
    app.get("/failure", () => {
      throw new Error("private-detail");
    });
    const response = await app.request("/failure");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR" },
    });
  });
});
