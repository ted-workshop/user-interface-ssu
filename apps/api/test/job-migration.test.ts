import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";
import { recoverAnalysis } from "../src/jobs/analysis";

test("기존 실행 중 시도는 미호출로 추정하지 않고 새 열을 추가해 이력을 보존해요", async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, 3));
  const sql = (query: string) => env.DB.prepare(query);
  await env.DB.batch([
    sql(
      "INSERT INTO users (id,email,nickname,password_hash) VALUES ('a','a@example.com','독자','fixture')",
    ),
    sql("INSERT INTO videos (id) VALUES ('jNQXAC9IVRw')"),
    sql(
      `INSERT INTO analysis_jobs (id,video_id,generation_key,generation_config_json) VALUES ('job','jNQXAC9IVRw','legacy','{"model":"legacy"}')`,
    ),
    sql(
      "INSERT INTO summary_requests (id,user_id,analysis_job_id,origin) VALUES ('request','a','job','direct')",
    ),
    sql("UPDATE summary_requests SET status='running'"),
    sql("UPDATE analysis_jobs SET status='running'"),
    sql(
      "INSERT INTO analysis_attempts (id,analysis_job_id,attempt_number,started_at) VALUES ('attempt','job',1,1800000000)",
    ),
  ]);
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  expect(
    await sql("SELECT dispatched_at FROM analysis_attempts").first(
      "dispatched_at",
    ),
  ).toBe(1_800_000_000);
  await recoverAnalysis(env.DB, 1_800_000_001);
  expect(
    (
      await sql(
        "SELECT status,failure_code,attempt_number,started_at FROM analysis_attempts",
      ).all()
    ).results,
  ).toEqual([
    {
      status: "ambiguous",
      failure_code: "provider_outcome_unknown",
      attempt_number: 1,
      started_at: 1_800_000_000,
    },
  ]);
  expect(
    await sql("SELECT failure_code FROM summary_requests").first(
      "failure_code",
    ),
  ).toBe("provider_outcome_unknown");
  expect((await sql("PRAGMA foreign_key_check").all()).results).toEqual([]);
});
