import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          SMTP_USER: "fixture-sender@gmail.com",
          SMTP_APP_PASSWORD: "fixture-app-password",
          GEMINI_API_KEY: "fixture-binding-key",
          GEMINI_MODEL: "gemini-3.5-flash-lite",
        },
      },
    })),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
