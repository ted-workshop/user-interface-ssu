import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, test } from "vitest";

test("기존 본문이 있으면 전환 전체를 중단하고 계정·토큰을 보존한 빈 제품 DB만 전환해요", async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, 2));
  const sql = (query: string) => env.DB.prepare(query);
  await env.DB.batch([
    sql(
      "INSERT INTO users (id,email,nickname,password_hash) VALUES ('legacy','legacy@example.com','기존 독자','fixture-hash')",
    ),
    sql(
      "INSERT INTO sessions (id,user_id,token_hash,created_at,expires_at) VALUES ('session','legacy',printf('%064d',1),1800000000,1800000060)",
    ),
    sql(
      "INSERT INTO recipients (id,user_id,email) VALUES ('address','legacy','recipient@example.com')",
    ),
    sql(
      "INSERT INTO account_tokens (id,user_id,purpose,recipient_id,token_hash,created_at,expires_at) VALUES ('token','legacy','verify_recipient','address',printf('%064d',2),1800000000,1800000060)",
    ),
    sql("INSERT INTO user_settings VALUES ('legacy',360)"),
    sql(
      "INSERT INTO summary_requests (id,user_id,video_id,origin) VALUES ('old-request','legacy','jNQXAC9IVRw','direct')",
    ),
    sql("UPDATE summary_requests SET status='running' WHERE id='old-request'"),
    sql(
      "INSERT INTO summary_attempts (id,request_id,user_id,attempt_number,started_at) VALUES ('old-attempt','old-request','legacy',1,1800000000)",
    ),
    sql(
      "UPDATE summary_attempts SET status='succeeded',finished_at=1800000001 WHERE id='old-attempt'",
    ),
    sql(
      "INSERT INTO reports (id,request_id,attempt_id,user_id,video_id,origin,title,channel_name,body_markdown,model) VALUES ('old-report','old-request','old-attempt','legacy','jNQXAC9IVRw','direct','기존 제목','기존 채널','절대로 잃으면 안 되는 본문','legacy-fixture')",
    ),
    sql(
      "UPDATE summary_requests SET status='completed' WHERE id='old-request'",
    ),
  ]);

  await expect(
    applyD1Migrations(env.DB, env.TEST_MIGRATIONS),
  ).rejects.toThrow();
  expect(
    await sql("SELECT body_markdown FROM reports WHERE id='old-report'").first(
      "body_markdown",
    ),
  ).toBe("절대로 잃으면 안 되는 본문");
  expect(
    (await sql("SELECT name FROM d1_migrations ORDER BY id").all()).results,
  ).toHaveLength(2);
  expect(
    await sql(
      "SELECT name FROM sqlite_schema WHERE name='shared_report_migration_guard' OR name='analysis_jobs'",
    ).first(),
  ).toBeNull();

  // 위에서 만든 과거 제품 fixture만 지우고 계정·세션·주소·토큰은 남겨요.
  await env.DB.batch([
    sql("DELETE FROM reports"),
    sql("DELETE FROM summary_attempts"),
    sql("DELETE FROM summary_requests"),
  ]);
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  expect(
    await sql("SELECT password_hash FROM users WHERE id='legacy'").first(
      "password_hash",
    ),
  ).toBe("fixture-hash");
  expect(
    await sql("SELECT recipient_id FROM account_tokens WHERE id='token'").first(
      "recipient_id",
    ),
  ).toBe("address");
  expect((await sql("SELECT id FROM sessions").all()).results).toEqual([
    { id: "session" },
  ]);
  expect((await sql("PRAGMA foreign_key_check").all()).results).toEqual([]);

  await expect(
    applyD1Migrations(env.DB, [
      {
        name: "9999_failure_probe.sql",
        queries: [
          "CREATE TABLE migration_probe (id TEXT)",
          "INSERT INTO missing_probe VALUES (1)",
        ],
      },
    ]),
  ).rejects.toThrow();
  expect(
    await sql(
      "SELECT name FROM sqlite_schema WHERE name='migration_probe'",
    ).first(),
  ).toBeNull();
  expect(
    await sql(
      "SELECT name FROM d1_migrations WHERE name='9999_failure_probe.sql'",
    ).first(),
  ).toBeNull();
});
