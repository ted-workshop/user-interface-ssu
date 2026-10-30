import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

const now = 1_800_000_000;
const video = "jNQXAC9IVRw";
const hash = "a".repeat(64);
const tables = [
  "delivery_attempts",
  "deliveries",
  "comments",
  "report_permissions",
  "reports",
  "analysis_attempts",
  "summary_requests",
  "analysis_jobs",
  "subscription_videos",
  "channel_subscriptions",
  "videos",
  "channels",
  "account_tokens",
  "recipients",
  "user_settings",
  "sessions",
  "users",
];
function sql(query: string, ...values: (string | number | null)[]) {
  return env.DB.prepare(query).bind(...values);
}
async function job(id = "job", key = "profile-1", vid = video) {
  await sql(
    "INSERT OR IGNORE INTO channels (id, youtube_channel_id, title, url) VALUES ('channel', 'UC_fixture', '채널', 'https://www.youtube.com/channel/UC_fixture')",
  ).run();
  await sql(
    "INSERT OR IGNORE INTO videos (id, channel_id) VALUES (?, 'channel')",
    vid,
  ).run();
  await sql(
    "INSERT INTO analysis_jobs (id, video_id, generation_key, generation_config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(video_id, generation_key) DO NOTHING",
    id,
    vid,
    key,
    JSON.stringify({ model: "fixture", prompt: key }),
    now,
    now,
  ).run();
}
async function subscription(owner = "a", baseline = true) {
  await job();
  await sql(
    "INSERT INTO channel_subscriptions (id, user_id, channel_id, baseline_initialized_at, next_check_at) VALUES (?, ?, 'channel', ?, ?)",
    `sub-${owner}`,
    owner,
    baseline ? now : null,
    now,
  ).run();
  await sql(
    "INSERT INTO subscription_videos (subscription_id, video_id, is_baseline) VALUES (?, ?, ?)",
    `sub-${owner}`,
    video,
    baseline ? 0 : 1,
  ).run();
}
async function recipient(owner = "a", id = `recipient-${owner}`) {
  await sql(
    "INSERT INTO recipients (id, user_id, email, verified_at) VALUES (?, ?, 'receiver@example.com', ?)",
    id,
    owner,
    now,
  ).run();
}
async function request(
  owner = "a",
  source: string | null = null,
  jid = "job",
  id = `request-${owner}`,
) {
  await sql(
    "INSERT INTO summary_requests (id, user_id, analysis_job_id, origin, subscription_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id,
    owner,
    jid,
    source ? "channel" : "direct",
    source,
    now,
    now,
  ).run();
}
async function start(owner = "a") {
  await sql(
    "UPDATE summary_requests SET status = 'running' WHERE id = ?",
    `request-${owner}`,
  ).run();
}
async function finish(jid = "job", rid = "report", attempt = "attempt") {
  await sql(
    "UPDATE analysis_jobs SET status = 'running' WHERE id = ?",
    jid,
  ).run();
  await sql(
    "INSERT INTO analysis_attempts (id, analysis_job_id, attempt_number, started_at) VALUES (?, ?, 1, ?)",
    attempt,
    jid,
    now,
  ).run();
  await env.DB.batch([
    sql(
      "UPDATE analysis_attempts SET status = 'succeeded', finished_at = ? WHERE id = ?",
      now + 1,
      attempt,
    ),
    sql(
      "INSERT INTO reports (id, analysis_job_id, successful_attempt_id, title, channel_name, body_markdown, model) VALUES (?, ?, ?, '원본 영상', '채널', '# 공통 본문', 'fixture')",
      rid,
      jid,
      attempt,
    ),
    sql("UPDATE analysis_jobs SET status = 'completed' WHERE id = ?", jid),
  ]);
}
async function grant(owner = "a", rid = "report") {
  await sql(
    "INSERT INTO report_permissions (id, report_id, audience, user_id, can_read, can_comment, created_at) VALUES (?, ?, 'user', ?, 1, 0, ?)",
    `grant-${owner}-${rid}`,
    rid,
    owner,
    now,
  ).run();
}
async function complete(owner = "a") {
  await grant(owner);
  await sql(
    "UPDATE summary_requests SET status = 'completed' WHERE id = ?",
    `request-${owner}`,
  ).run();
}
async function report() {
  await job();
  await request();
  await start();
  await finish();
  await complete();
}
async function publish() {
  await sql(
    "INSERT INTO report_permissions (id, report_id, audience, can_read, can_comment) VALUES ('public', 'report', 'authenticated', 1, 1)",
  ).run();
}
async function delivery(owner = "a", id = `delivery-${owner}`, rid = "report") {
  return sql(
    "INSERT INTO deliveries (id, user_id, request_id, report_id, subscription_id, recipient_id, recipient_email) VALUES (?, ?, ?, ?, ?, ?, 'receiver@example.com')",
    id,
    owner,
    `request-${owner}`,
    rid,
    `sub-${owner}`,
    `recipient-${owner}`,
  ).run();
}
async function automaticBoth() {
  for (const owner of ["a", "b"]) {
    await subscription(owner);
    await recipient(owner);
    await request(owner, `sub-${owner}`);
    await start(owner);
  }
  await finish();
  await complete("a");
  await complete("b");
}
function readReport(owner: string) {
  return sql(
    "SELECT r.id FROM reports r WHERE r.id = 'report' AND EXISTS (SELECT 1 FROM report_permissions p WHERE p.report_id = r.id AND (p.user_id = ? OR p.audience = 'authenticated') AND p.can_read = 1)",
    owner,
  ).all();
}
function readComments() {
  return sql(
    "SELECT c.id, u.nickname FROM comments c JOIN users u ON u.id = c.user_id WHERE c.report_id = 'report' AND EXISTS (SELECT 1 FROM report_permissions p WHERE p.report_id = c.report_id AND p.audience = 'authenticated' AND p.can_comment = 1) ORDER BY c.created_at, c.id",
  ).all();
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  for (const table of tables)
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  await env.DB.batch(
    ["a", "b"].map((id) =>
      sql(
        "INSERT INTO users (id, email, nickname, password_hash, created_at) VALUES (?, ?, ?, 'fixture', ?)",
        id,
        `${id}@example.com`,
        `독자-${id}`,
        now,
      ),
    ),
  );
});

describe("공통 보고서 D1 저장 규칙", () => {
  test("네 마이그레이션을 반복 적용하고 17개 제품 테이블과 FK를 재현해요", async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    expect(
      (
        await sql("SELECT name FROM d1_migrations ORDER BY id").all<{
          name: string;
        }>()
      ).results.map((r) => r.name),
    ).toEqual([
      "0001_initialize.sql",
      "0002_product_schema.sql",
      "0003_shared_reports.sql",
      "0004_job_leases.sql",
    ]);
    expect((await sql("PRAGMA foreign_key_check").all()).results).toEqual([]);
    const names = await sql(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations', '_cf_METADATA')",
    ).all<{ name: string }>();
    expect(names.results.map((row) => row.name).sort()).toEqual(
      [...tables].sort(),
    );
  });
  test("정규화 이메일·세션 FK·원문 토큰 저장을 검사해요", async () => {
    for (const email of ["A@example.com", " a@example.com", "a@example.com"])
      await expect(
        sql(
          "INSERT INTO users (id, email, nickname, password_hash) VALUES ('c', ?, '독자', 'fixture')",
          email,
        ).run(),
      ).rejects.toThrow();
    await expect(
      sql(
        "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES ('s', 'missing', ?, ?, ?)",
        hash,
        now,
        now + 60,
      ).run(),
    ).rejects.toThrow();
    await expect(
      sql(
        "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES ('s', 'a', 'raw', ?, ?)",
        now,
        now + 60,
      ).run(),
    ).rejects.toThrow();
  });
  test("복구 토큰은 만료와 일회 소비를 지키고 수신 주소 소유자를 검사해요", async () => {
    await sql(
      "INSERT INTO account_tokens (id, user_id, purpose, token_hash, created_at, expires_at) VALUES ('token', 'a', 'reset_password', ?, ?, ?)",
      hash,
      now,
      now + 60,
    ).run();
    const consume = (time: number) =>
      sql(
        "UPDATE account_tokens SET consumed_at = ? WHERE id = 'token' AND consumed_at IS NULL AND expires_at > ? RETURNING user_id",
        time,
        time,
      ).all();
    expect((await consume(now + 60)).results).toEqual([]);
    expect((await consume(now + 1)).results).toEqual([{ user_id: "a" }]);
    expect((await consume(now + 2)).results).toEqual([]);
    await expect(
      sql(
        "UPDATE account_tokens SET consumed_at = NULL WHERE id = 'token'",
      ).run(),
    ).rejects.toThrow();
    await recipient("b");
    await expect(
      sql(
        "INSERT INTO account_tokens (id, user_id, purpose, recipient_id, token_hash, created_at, expires_at) VALUES ('cross', 'a', 'verify_recipient', 'recipient-b', ?, ?, ?)",
        "b".repeat(64),
        now,
        now + 60,
      ).run(),
    ).rejects.toThrow();
  });
  test("A와 B의 개인 요청 두 개가 작업·보고서 하나와 같은 ID를 사용해요", async () => {
    await job();
    await job("duplicate");
    await request("a");
    await request("b");
    await start();
    await finish();
    await complete("a");
    await complete("b");
    expect((await sql("SELECT id FROM analysis_jobs").all()).results).toEqual([
      { id: "job" },
    ]);
    expect(
      (
        await sql(
          "SELECT r.id FROM summary_requests q JOIN reports r ON r.analysis_job_id = q.analysis_job_id ORDER BY q.user_id",
        ).all()
      ).results,
    ).toEqual([{ id: "report" }, { id: "report" }]);
    expect(
      (await sql("SELECT id FROM analysis_attempts").all()).results,
    ).toHaveLength(1);
    expect((await readReport("a")).results).toEqual([{ id: "report" }]);
    expect((await readReport("b")).results).toEqual([{ id: "report" }]);
    await expect(
      request("a", null, "job", "duplicate-request"),
    ).rejects.toThrow();
  });
  test("다른 생성 설정은 새 작업이고 원래 입력·본문은 불변이에요", async () => {
    await report();
    await job("version-2", "profile-2");
    expect(
      (await sql("SELECT id FROM analysis_jobs").all()).results,
    ).toHaveLength(2);
    await expect(
      sql(
        "UPDATE analysis_jobs SET generation_key = 'changed' WHERE id = 'job'",
      ).run(),
    ).rejects.toThrow();
    await expect(
      sql(
        "UPDATE reports SET body_markdown = '변경' WHERE id = 'report'",
      ).run(),
    ).rejects.toThrow();
    await sql(
      "UPDATE reports SET timestamp_verification = 'verified' WHERE id = 'report'",
    ).run();
    expect(
      await sql("SELECT channel_url FROM reports").first("channel_url"),
    ).toBeNull();
  });
  test("타인 구독·다른 채널·최초 기준 영상으로 자동 요청을 만들지 못해요", async () => {
    await subscription("b");
    await expect(request("a", "sub-b")).rejects.toThrow();
    await sql(
      "INSERT INTO channels (id, youtube_channel_id, title, url) VALUES ('other', 'UC_other', '다른 채널', 'https://example.com')",
    ).run();
    await sql(
      "INSERT INTO channel_subscriptions (id, user_id, channel_id, baseline_initialized_at) VALUES ('sub-a', 'a', 'other', ?)",
      now,
    ).run();
    await expect(request("a", "sub-a")).rejects.toThrow();
    await sql("DELETE FROM channel_subscriptions WHERE id = 'sub-a'").run();
    await subscription("a", false);
    await sql(
      "UPDATE channel_subscriptions SET baseline_initialized_at = ? WHERE id = 'sub-a'",
      now,
    ).run();
    await expect(request("a", "sub-a")).rejects.toThrow();
  });
  test("빈 채널의 기준 완료와 개인별 최초 관찰 집합을 보존해요", async () => {
    await job();
    await sql(
      "INSERT INTO channel_subscriptions (id, user_id, channel_id) VALUES ('sub-a', 'a', 'channel')",
    ).run();
    await sql(
      "UPDATE channel_subscriptions SET baseline_initialized_at = ? WHERE id = 'sub-a'",
      now,
    ).run();
    await expect(
      sql(
        "UPDATE channel_subscriptions SET baseline_initialized_at = NULL WHERE id = 'sub-a'",
      ).run(),
    ).rejects.toThrow();
    await expect(
      sql(
        "INSERT INTO subscription_videos VALUES ('sub-a', ?, 1, ?)",
        video,
        now,
      ).run(),
    ).rejects.toThrow();
    await sql(
      "INSERT INTO subscription_videos VALUES ('sub-a', ?, 0, ?)",
      video,
      now + 1,
    ).run();
    await subscription("b", false);
    expect(
      (
        await sql(
          "SELECT is_baseline FROM subscription_videos ORDER BY subscription_id",
        ).all()
      ).results,
    ).toEqual([{ is_baseline: 0 }, { is_baseline: 1 }]);
  });
  test("경합한 claim 한 개만 성공하고 같은 작업의 동시 시도를 막아요", async () => {
    await job();
    await request();
    await request("b");
    await start();
    await start("b");
    const claims = await Promise.all(
      [1, 2].map(() =>
        sql(
          "UPDATE analysis_jobs SET status = 'running' WHERE id = 'job' AND status = 'queued'",
        ).run(),
      ),
    );
    expect(claims.map((r) => r.meta.changes).sort()).toEqual([0, 1]);
    const attempts = await Promise.allSettled(
      ["one", "two"].map((id) =>
        sql(
          "INSERT INTO analysis_attempts (id, analysis_job_id, attempt_number, started_at) VALUES (?, 'job', 1, ?)",
          id,
          now,
        ).run(),
      ),
    );
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await job("other", "other", "2lv5xHjLx1c");
    await request("a", null, "other", "second-request");
    await expect(
      sql(
        "UPDATE summary_requests SET status = 'running' WHERE id = 'second-request'",
      ).run(),
    ).rejects.toThrow();
  });
  test("분석 재시도는 순서·세 번 상한·종료 이력을 유지해요", async () => {
    await job();
    await request();
    await start();
    await sql("UPDATE analysis_jobs SET status = 'running'").run();
    for (let n = 1; n <= 3; n++) {
      await sql(
        "INSERT INTO analysis_attempts (id, analysis_job_id, attempt_number, started_at) VALUES (?, 'job', ?, ?)",
        `attempt-${n}`,
        n,
        now,
      ).run();
      await sql(
        "UPDATE analysis_attempts SET status = 'failed', failure_code = 'temporary', finished_at = ? WHERE id = ?",
        now + 1,
        `attempt-${n}`,
      ).run();
    }
    await expect(
      sql(
        "INSERT INTO analysis_attempts (id, analysis_job_id, attempt_number) VALUES ('fourth', 'job', 4)",
      ).run(),
    ).rejects.toThrow();
    await expect(
      sql(
        "UPDATE analysis_attempts SET status = 'running', failure_code = NULL, finished_at = NULL WHERE id = 'attempt-1'",
      ).run(),
    ).rejects.toThrow();
    expect(
      (await sql("SELECT id FROM analysis_attempts").all()).results,
    ).toHaveLength(3);
  });
  test("중지한 자동 요청만 있으면 실행을 거부하고 다른 직접 요청은 계속할 수 있어요", async () => {
    await subscription();
    await recipient();
    await request("a", "sub-a");
    await start();
    await sql("UPDATE channel_subscriptions SET status = 'paused'").run();
    await sql("UPDATE analysis_jobs SET status = 'running'").run();
    await expect(
      sql(
        "INSERT INTO analysis_attempts (id, analysis_job_id, attempt_number) VALUES ('attempt', 'job', 1)",
      ).run(),
    ).rejects.toThrow();
    await request("b");
    await start("b");
    await sql(
      "INSERT INTO analysis_attempts (id, analysis_job_id, attempt_number) VALUES ('attempt', 'job', 1)",
    ).run();
  });
  test("성공 시도·보고서·개인 권한 없이 완료를 기록하지 못해요", async () => {
    await job();
    await request();
    await start();
    await expect(
      sql("UPDATE analysis_jobs SET status = 'completed'").run(),
    ).rejects.toThrow();
    await expect(
      sql("UPDATE summary_requests SET status = 'completed'").run(),
    ).rejects.toThrow();
    await finish();
    await expect(
      sql("UPDATE summary_requests SET status = 'completed'").run(),
    ).rejects.toThrow();
    await complete();
    await expect(
      sql("UPDATE summary_requests SET status = 'queued'").run(),
    ).rejects.toThrow();
  });
  test("보고서를 다른 작업의 성공 시도에 연결하지 못해요", async () => {
    await report();
    await job("other", "other");
    await sql(
      "UPDATE analysis_jobs SET status = 'running' WHERE id = 'other'",
    ).run();
    await expect(
      sql(
        "INSERT INTO reports (id, analysis_job_id, successful_attempt_id, title, channel_name, body_markdown, model) VALUES ('wrong', 'other', 'attempt', '제목', '채널', '본문', 'fixture')",
      ).run(),
    ).rejects.toThrow();
  });
  test("공급자 결과 불명은 새 분석 시도로 우회하지 못해요", async () => {
    await job();
    await request();
    await start();
    await sql("UPDATE analysis_jobs SET status='running'").run();
    await sql(
      "INSERT INTO analysis_attempts (id,analysis_job_id,attempt_number,started_at) VALUES ('unknown','job',1,?)",
      now,
    ).run();
    await sql(
      "UPDATE analysis_attempts SET status='ambiguous',failure_code='provider_outcome_unknown',finished_at=?",
      now + 1,
    ).run();
    await expect(
      sql(
        "INSERT INTO analysis_attempts (id,analysis_job_id,attempt_number) VALUES ('retry','job',2)",
      ).run(),
    ).rejects.toThrow();
  });
  test("권한 없는 비공개 조회·댓글과 중복·잘못된 대상의 규칙을 거부해요", async () => {
    await report();
    expect((await readReport("b")).results).toEqual([]);
    await expect(
      sql(
        "INSERT INTO comments (id, report_id, user_id, body) VALUES ('c', 'report', 'b', '댓글')",
      ).run(),
    ).rejects.toThrow();
    await expect(grant()).rejects.toThrow();
    await expect(
      sql(
        "INSERT INTO report_permissions (id, report_id, audience, can_read, can_comment) VALUES ('bad', 'report', 'user', 1, 0)",
      ).run(),
    ).rejects.toThrow();
    await expect(
      sql(
        "UPDATE report_permissions SET audience = 'authenticated', user_id = NULL, can_comment = 1",
      ).run(),
    ).rejects.toThrow();
    await publish();
    await expect(
      sql(
        "INSERT INTO report_permissions (id, report_id, audience, can_read, can_comment) VALUES ('duplicate', 'report', 'authenticated', 1, 1)",
      ).run(),
    ).rejects.toThrow();
  });
  test("A와 B가 보고서 하나의 댓글 목록을 보고 본인 댓글만 삭제해요", async () => {
    await report();
    await publish();
    for (const owner of ["a", "b"])
      await sql(
        "INSERT INTO comments (id, report_id, user_id, body, created_at) VALUES (?, 'report', ?, '같은 보고서의 댓글', ?)",
        owner,
        owner,
        now,
      ).run();
    expect((await readComments()).results).toEqual([
      { id: "a", nickname: "독자-a" },
      { id: "b", nickname: "독자-b" },
    ]);
    expect(
      (
        await sql(
          "DELETE FROM comments WHERE id = 'a' AND user_id = ?",
          "b",
        ).run()
      ).meta.changes,
    ).toBe(0);
    expect(
      (
        await sql(
          "DELETE FROM comments WHERE id = 'b' AND user_id = ?",
          "b",
        ).run()
      ).meta.changes,
    ).toBe(1);
    await expect(
      sql("UPDATE comments SET body = '수정' WHERE id = 'a'").run(),
    ).rejects.toThrow();
    await expect(
      sql(
        "INSERT INTO comments (id, report_id, user_id, body) VALUES ('empty', 'report', 'a', ' ')",
      ).run(),
    ).rejects.toThrow();
    await expect(
      sql(
        "INSERT INTO comments (id, report_id, user_id, body) VALUES ('long', 'report', 'a', ?)",
        "가".repeat(2001),
      ).run(),
    ).rejects.toThrow();
  });
  test("공개 열람은 보관 관계를 만들지 않고 공개 철회는 댓글 접근을 차단해요", async () => {
    await report();
    await publish();
    expect((await readReport("b")).results).toEqual([{ id: "report" }]);
    expect(
      (await sql("SELECT id FROM report_permissions WHERE user_id = 'b'").all())
        .results,
    ).toEqual([]);
    await sql(
      "INSERT INTO comments (id, report_id, user_id, body) VALUES ('comment', 'report', 'b', '의견')",
    ).run();
    await sql(
      "DELETE FROM report_permissions WHERE audience = 'authenticated'",
    ).run();
    expect((await readComments()).results).toEqual([]);
    expect((await sql("SELECT id FROM comments").all()).results).toHaveLength(
      1,
    );
    await expect(
      sql(
        "INSERT INTO comments (id, report_id, user_id, body) VALUES ('new', 'report', 'a', '의견')",
      ).run(),
    ).rejects.toThrow();
  });
  test("직접 요청 A와 자동 요청 B는 같은 보고서를 쓰고 B에게만 발송해요", async () => {
    await subscription("b");
    await recipient("b");
    await request();
    await request("b", "sub-b");
    await start();
    await finish();
    await complete();
    await complete("b");
    await delivery("b");
    await subscription("a");
    await recipient("a");
    await expect(delivery()).rejects.toThrow();
    expect(
      (await sql("SELECT user_id, report_id FROM deliveries").all()).results,
    ).toEqual([{ user_id: "b", report_id: "report" }]);
    await expect(
      sql(
        "UPDATE summary_requests SET origin = 'channel', subscription_id = 'sub-a' WHERE id = 'request-a'",
      ).run(),
    ).rejects.toThrow();
  });
  test("같은 보고서·같은 주소도 다른 계정 발송을 막지 않고 계정 내 중복은 막아요", async () => {
    await automaticBoth();
    await delivery("a");
    await delivery("b");
    await expect(delivery("a", "duplicate")).rejects.toThrow();
    await sql(
      "UPDATE recipients SET deleted_at = ? WHERE id = 'recipient-a'",
      now,
    ).run();
    await recipient("a", "new-address");
    await expect(
      sql(
        "INSERT INTO deliveries (id,user_id,request_id,report_id,subscription_id,recipient_id,recipient_email) VALUES ('again','a','request-a','report','sub-a','new-address','receiver@example.com')",
      ).run(),
    ).rejects.toThrow();
    expect((await sql("SELECT id FROM deliveries").all()).results).toHaveLength(
      2,
    );
  });
  test("타인 주소·다른 작업 보고서를 개인 발송에 붙이지 못해요", async () => {
    await automaticBoth();
    await expect(
      sql(
        "INSERT INTO deliveries (id,user_id,request_id,report_id,subscription_id,recipient_id,recipient_email) VALUES ('wrong','a','request-a','report','sub-a','recipient-b','receiver@example.com')",
      ).run(),
    ).rejects.toThrow();
    await job("other", "other");
    await request("b", null, "other", "other-request");
    await sql(
      "UPDATE summary_requests SET status = 'running' WHERE id = 'other-request'",
    ).run();
    await finish("other", "other-report", "other-attempt");
    await expect(
      delivery("a", "wrong-report", "other-report"),
    ).rejects.toThrow();
  });
  test("A의 중지·보관 해제가 B의 발송·권한·댓글과 공통 보고서를 지우지 않아요", async () => {
    await automaticBoth();
    await delivery("a");
    await delivery("b");
    await publish();
    await sql(
      "INSERT INTO comments (id,report_id,user_id,body) VALUES ('c','report','b','보존')",
    ).run();
    await sql(
      "UPDATE channel_subscriptions SET status = 'paused' WHERE id = 'sub-a'",
    ).run();
    await sql("DELETE FROM report_permissions WHERE user_id = 'a'").run();
    expect(
      (
        await sql(
          "SELECT user_id,status FROM deliveries ORDER BY user_id",
        ).all()
      ).results,
    ).toEqual([
      { user_id: "a", status: "cancelled" },
      { user_id: "b", status: "queued" },
    ]);
    expect((await readReport("b")).results).toEqual([{ id: "report" }]);
    expect((await readComments()).results).toHaveLength(1);
    await sql(
      "UPDATE channel_subscriptions SET status = 'deleted' WHERE id = 'sub-a'",
    ).run();
    await expect(
      sql(
        "UPDATE channel_subscriptions SET status = 'active' WHERE id = 'sub-a'",
      ).run(),
    ).rejects.toThrow();
  });
  test("개인 권한이나 주소 폐기는 대기 발송을 취소하고 claim에서 다시 확인해요", async () => {
    await automaticBoth();
    await delivery("a");
    await delivery("b");
    await sql("DELETE FROM report_permissions WHERE user_id = 'a'").run();
    await sql(
      "UPDATE recipients SET verified_at = NULL WHERE id = 'recipient-b'",
    ).run();
    expect((await sql("SELECT status FROM deliveries").all()).results).toEqual([
      { status: "cancelled" },
      { status: "cancelled" },
    ]);
    await expect(
      sql(
        "UPDATE deliveries SET status = 'sending' WHERE id = 'delivery-b'",
      ).run(),
    ).rejects.toThrow();
  });
  test("성공한 메일·시도는 덮어쓰지 않고 중지해도 성공 이력을 유지해요", async () => {
    await automaticBoth();
    await delivery();
    await sql(
      "UPDATE deliveries SET status = 'sending' WHERE id = 'delivery-a'",
    ).run();
    await expect(
      sql(
        "UPDATE deliveries SET status = 'sent' WHERE id = 'delivery-a'",
      ).run(),
    ).rejects.toThrow();
    await sql(
      "INSERT INTO delivery_attempts (id,delivery_id,attempt_number,started_at) VALUES ('send','delivery-a',1,?)",
      now,
    ).run();
    await sql(
      "UPDATE delivery_attempts SET status = 'accepted',finished_at = ? WHERE id = 'send'",
      now + 1,
    ).run();
    await sql(
      "UPDATE deliveries SET status = 'sent' WHERE id = 'delivery-a'",
    ).run();
    await expect(
      sql(
        "UPDATE deliveries SET status = 'queued' WHERE id = 'delivery-a'",
      ).run(),
    ).rejects.toThrow();
    await expect(
      sql(
        "UPDATE delivery_attempts SET status = 'rejected',failure_code = 'permanent' WHERE id = 'send'",
      ).run(),
    ).rejects.toThrow();
    await sql(
      "UPDATE channel_subscriptions SET status = 'paused' WHERE id = 'sub-a'",
    ).run();
    expect(await sql("SELECT status FROM deliveries").first("status")).toBe(
      "sent",
    );
  });
  test("결과 불명 메일은 재발송하지 않고 근거가 있어야 성공으로 정정해요", async () => {
    await automaticBoth();
    await delivery();
    await sql("UPDATE deliveries SET status = 'sending'").run();
    await sql("UPDATE deliveries SET status = 'ambiguous'").run();
    await expect(
      sql("UPDATE deliveries SET status = 'queued'").run(),
    ).rejects.toThrow();
    await expect(
      sql("UPDATE deliveries SET status = 'sent'").run(),
    ).rejects.toThrow();
    await sql(
      "UPDATE deliveries SET status = 'sent',resolution_evidence = 'fixture-manual-proof'",
    ).run();
  });
  test("batch 제약 위반이면 앞선 저장도 되돌리고 외래키 검사가 유효해요", async () => {
    await expect(
      env.DB.batch([
        sql("INSERT INTO user_settings VALUES ('a',60)"),
        sql("INSERT INTO user_settings VALUES ('missing',60)"),
      ]),
    ).rejects.toThrow();
    expect(await sql("SELECT * FROM user_settings").first()).toBeNull();
    expect((await sql("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });
  test("개인 보관함 keyset은 권한 인덱스를 사용하고 로컬 계측을 제공해요", async () => {
    await report();
    const query =
      "SELECT r.id,r.title FROM report_permissions p JOIN reports r ON r.id=p.report_id WHERE p.audience='user' AND p.user_id=? AND (p.created_at,p.report_id)<(?,?) ORDER BY p.created_at DESC,p.report_id DESC LIMIT 20";
    const plan = await sql(
      `EXPLAIN QUERY PLAN ${query}`,
      "a",
      now + 1,
      "zz",
    ).all<{ detail: string }>();
    expect(
      plan.results.some((r) => r.detail.includes("permissions_library")),
    ).toBe(true);
    const result = await sql(query, "a", now + 1, "zz").all();
    expect(result.results).toEqual([{ id: "report", title: "원본 영상" }]);
    expect((await sql(query, "b", now + 1, "zz").all()).results).toEqual([]);
    const write = await sql(
      "INSERT INTO user_settings (user_id) VALUES ('a')",
    ).run();
    expect(result.meta.rows_read).toBeGreaterThanOrEqual(0);
    expect(result.meta.rows_written).toBe(0);
    expect(write.meta.rows_written).toBeGreaterThan(0);
    expect(write.meta.size_after).toBeGreaterThan(0);
    console.info("공통 보고서 로컬 D1 계측", {
      rows_read: result.meta.rows_read,
      rows_written: write.meta.rows_written,
      size_after: write.meta.size_after,
      duration: result.meta.duration,
    });
  });
  test.each([
    [
      "SELECT id FROM comments WHERE report_id = ? ORDER BY created_at DESC,id DESC LIMIT 20",
      ["report"],
      "comments_report_created",
    ],
    [
      "SELECT id FROM channel_subscriptions WHERE status='active' AND next_check_at<=? ORDER BY next_check_at LIMIT 20",
      [now],
      "subscriptions_due",
    ],
    [
      "SELECT id FROM analysis_jobs WHERE status='queued' ORDER BY created_at,id LIMIT 20",
      [],
      "analysis_jobs_queued",
    ],
    [
      "SELECT id FROM deliveries WHERE status='queued' AND available_at<=? ORDER BY available_at,id LIMIT 20",
      [now],
      "deliveries_due",
    ],
  ] as const)(
    "주요 조회 인덱스를 확인해요: %s",
    async (query, values, index) => {
      const plan = await sql(`EXPLAIN QUERY PLAN ${query}`, ...values).all<{
        detail: string;
      }>();
      expect(plan.results.some((r) => r.detail.includes(index))).toBe(true);
    },
  );
});
