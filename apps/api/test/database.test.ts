import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

const now = 1_800_000_000;
const video = "jNQXAC9IVRw";
const hash = "a".repeat(64);
const tables = [
  "delivery_attempts",
  "deliveries",
  "reports",
  "summary_attempts",
  "summary_requests",
  "channel_videos",
  "account_tokens",
  "recipients",
  "channels",
  "user_settings",
  "sessions",
  "users",
];

function sql(query: string, ...values: (string | number | null)[]) {
  return env.DB.prepare(query).bind(...values);
}

async function channel(id = "channel-a", owner = "a") {
  await sql(
    "INSERT INTO channels (id, user_id, youtube_channel_id, title, url, created_at) VALUES (?, ?, 'UC_fixture', '테스트 채널', 'https://www.youtube.com/channel/UC_fixture', ?)",
    id,
    owner,
    now,
  ).run();
}

async function recipient(id = "recipient-a", owner = "a") {
  await sql(
    "INSERT INTO recipients (id, user_id, email, verified_at, created_at) VALUES (?, ?, 'receiver@example.com', ?, ?)",
    id,
    owner,
    now,
    now,
  ).run();
}

async function request(
  id = "request-a",
  owner = "a",
  source: string | null = null,
) {
  await sql(
    "INSERT INTO summary_requests (id, user_id, video_id, origin, channel_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id,
    owner,
    video,
    source ? "channel" : "direct",
    source,
    now,
    now,
  ).run();
}

async function report(source: string | null = null) {
  await request("request-a", "a", source);
  await sql(
    "UPDATE summary_requests SET status = 'running' WHERE id = 'request-a'",
  ).run();
  await sql(
    "INSERT INTO summary_attempts (id, request_id, user_id, attempt_number, started_at) VALUES ('attempt-a', 'request-a', 'a', 1, ?)",
    now,
  ).run();
  await sql(
    "UPDATE summary_attempts SET status = 'succeeded', finished_at = ? WHERE id = 'attempt-a'",
    now + 1,
  ).run();
  await sql(
    "INSERT INTO reports (id, request_id, attempt_id, user_id, video_id, origin, title, channel_name, channel_url, body_markdown, model, created_at) VALUES ('report-a', 'request-a', 'attempt-a', 'a', ?, ?, '원본 영상', '테스트 채널', NULL, '# 저장한 본문', 'fixture-model', ?)",
    video,
    source ? "channel" : "direct",
    now + 1,
  ).run();
  await sql(
    "UPDATE summary_requests SET status = 'completed' WHERE id = 'request-a'",
  ).run();
}

async function delivery() {
  await sql(
    "INSERT INTO deliveries (id, user_id, report_id, channel_id, recipient_id, recipient_email, created_at) VALUES ('delivery-a', 'a', 'report-a', 'channel-a', 'recipient-a', 'receiver@example.com', ?)",
    now + 2,
  ).run();
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
        "INSERT INTO users (id, email, nickname, password_hash, created_at) VALUES (?, ?, '읽는사람', 'fixture-hash', ?)",
        id,
        `${id}@example.com`,
        now,
      ),
    ),
  );
});

describe("D1 제품 저장 규칙", () => {
  test("빈 DB의 모든 마이그레이션을 반복 적용해도 이력과 관계가 유효해요", async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    const names = await sql("SELECT name FROM d1_migrations ORDER BY id").all<{
      name: string;
    }>();
    expect(names.results.map((row) => row.name)).toEqual([
      "0001_initialize.sql",
      "0002_product_schema.sql",
    ]);
    expect((await sql("PRAGMA foreign_key_check").all()).results).toEqual([]);
    const result = await sql(
      "SELECT name FROM sqlite_schema WHERE type = 'table'",
    ).all<{ name: string }>();
    expect(result.results.map((row) => row.name)).toEqual(
      expect.arrayContaining(tables),
    );
  });

  test("정규화하지 않은 이메일과 같은 이메일의 다른 계정을 거부해요", async () => {
    for (const email of ["A@example.com", " a@example.com", "a@example.com"]) {
      await expect(
        sql(
          "INSERT INTO users (id, email, nickname, password_hash, created_at) VALUES ('c', ?, '새사람', 'fixture', ?)",
          email,
          now,
        ).run(),
      ).rejects.toThrow();
    }
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
        "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES ('s', 'a', 'raw-secret', ?, ?)",
        now,
        now + 60,
      ).run(),
    ).rejects.toThrow();
  });

  test("만료된 토큰은 거부하고 유효한 토큰도 한 번만 소비해요", async () => {
    await sql(
      "INSERT INTO account_tokens (id, user_id, purpose, token_hash, created_at, expires_at) VALUES ('token-a', 'a', 'reset_password', ?, ?, ?)",
      hash,
      now,
      now + 60,
    ).run();
    const consume = (time: number) =>
      sql(
        "UPDATE account_tokens SET consumed_at = ? WHERE token_hash = ? AND purpose = 'reset_password' AND consumed_at IS NULL AND expires_at > ? RETURNING user_id",
        time,
        hash,
        time,
      ).all();
    expect((await consume(now + 60)).results).toEqual([]);
    expect((await consume(now + 1)).results).toEqual([{ user_id: "a" }]);
    expect((await consume(now + 2)).results).toEqual([]);
    await expect(
      sql(
        "UPDATE account_tokens SET consumed_at = NULL WHERE id = 'token-a'",
      ).run(),
    ).rejects.toThrow();
  });

  test("수신 주소 확인 토큰을 다른 계정이나 다른 목적으로 연결하지 못해요", async () => {
    await recipient("recipient-b", "b");
    await expect(
      sql(
        "INSERT INTO account_tokens (id, user_id, purpose, recipient_id, token_hash, created_at, expires_at) VALUES ('token-a', 'a', 'verify_recipient', 'recipient-b', ?, ?, ?)",
        hash,
        now,
        now + 60,
      ).run(),
    ).rejects.toThrow();
    await expect(
      sql(
        "INSERT INTO account_tokens (id, user_id, purpose, token_hash, created_at, expires_at) VALUES ('token-a', 'a', 'verify_recipient', ?, ?, ?)",
        hash,
        now,
        now + 60,
      ).run(),
    ).rejects.toThrow();
  });

  test("같은 계정·영상의 중복 분석을 막고 다른 계정의 요청은 분리해요", async () => {
    await request();
    await expect(request("request-duplicate")).rejects.toThrow();
    await request("request-b", "b");
    expect(
      (
        await sql(
          "SELECT id FROM summary_requests WHERE user_id = ?",
          "b",
        ).all()
      ).results,
    ).toEqual([{ id: "request-b" }]);
  });

  test("다른 계정 채널을 요청에 연결하거나 생성 경로를 바꾸지 못해요", async () => {
    await channel("channel-b", "b");
    await expect(request("cross-owner", "a", "channel-b")).rejects.toThrow();
    await request();
    await expect(
      sql(
        "UPDATE summary_requests SET origin = 'channel', channel_id = 'channel-b' WHERE id = 'request-a'",
      ).run(),
    ).rejects.toThrow();
  });

  test("동시 실행 시도와 끝난 시도 이력 덮어쓰기를 막아요", async () => {
    await request();
    await sql(
      "UPDATE summary_requests SET status = 'running' WHERE id = 'request-a'",
    ).run();
    await sql(
      "INSERT INTO summary_attempts (id, request_id, user_id, attempt_number, started_at) VALUES ('first', 'request-a', 'a', 1, ?)",
      now,
    ).run();
    await expect(
      sql(
        "INSERT INTO summary_attempts (id, request_id, user_id, attempt_number, started_at) VALUES ('second', 'request-a', 'a', 2, ?)",
        now,
      ).run(),
    ).rejects.toThrow();
    await sql(
      "UPDATE summary_attempts SET status = 'failed', failure_code = 'temporary', finished_at = ? WHERE id = 'first'",
      now + 1,
    ).run();
    await expect(
      sql(
        "UPDATE summary_attempts SET status = 'running', finished_at = NULL WHERE id = 'first'",
      ).run(),
    ).rejects.toThrow();
    await expect(
      sql(
        "INSERT INTO summary_attempts (id, request_id, user_id, attempt_number, started_at) VALUES ('fourth', 'request-a', 'a', 4, ?)",
        now,
      ).run(),
    ).rejects.toThrow();
  });

  test("새 시도가 과거 실패를 유지하고 계정당 실행 중 요청은 하나예요", async () => {
    await request();
    await sql(
      "UPDATE summary_requests SET status = 'running' WHERE id = 'request-a'",
    ).run();
    await sql(
      "INSERT INTO summary_attempts (id, request_id, user_id, attempt_number, started_at) VALUES ('first', 'request-a', 'a', 1, ?)",
      now,
    ).run();
    await sql(
      "UPDATE summary_attempts SET status = 'failed', failure_code = 'temporary', finished_at = ? WHERE id = 'first'",
      now + 1,
    ).run();
    await sql(
      "UPDATE summary_requests SET status = 'failed', failure_code = 'temporary' WHERE id = 'request-a'",
    ).run();
    await sql(
      "UPDATE summary_requests SET status = 'queued', failure_code = NULL WHERE id = 'request-a'",
    ).run();
    await sql(
      "UPDATE summary_requests SET status = 'running' WHERE id = 'request-a'",
    ).run();
    await sql(
      "INSERT INTO summary_attempts (id, request_id, user_id, attempt_number, started_at) VALUES ('second', 'request-a', 'a', 2, ?)",
      now + 2,
    ).run();
    await sql(
      "UPDATE summary_attempts SET status = 'succeeded', finished_at = ? WHERE id = 'second'",
      now + 3,
    ).run();
    expect(
      (
        await sql(
          "SELECT attempt_number, status FROM summary_attempts ORDER BY attempt_number",
        ).all()
      ).results,
    ).toEqual([
      { attempt_number: 1, status: "failed" },
      { attempt_number: 2, status: "succeeded" },
    ]);
    await sql(
      "INSERT INTO summary_requests (id, user_id, video_id, origin) VALUES ('other-video', 'a', '2lv5xHjLx1c', 'direct')",
    ).run();
    await expect(
      sql(
        "UPDATE summary_requests SET status = 'running' WHERE id = 'other-video'",
      ).run(),
    ).rejects.toThrow();
  });

  test("저장된 리포트 없이 완료로 표시하거나 다른 소유자의 결과를 붙이지 못해요", async () => {
    await request();
    await sql(
      "UPDATE summary_requests SET status = 'running' WHERE id = 'request-a'",
    ).run();
    await expect(
      sql(
        "UPDATE summary_requests SET status = 'completed' WHERE id = 'request-a'",
      ).run(),
    ).rejects.toThrow();
    await sql(
      "INSERT INTO summary_attempts (id, request_id, user_id, attempt_number, started_at) VALUES ('attempt-a', 'request-a', 'a', 1, ?)",
      now,
    ).run();
    await expect(
      sql(
        "INSERT INTO reports (id, request_id, attempt_id, user_id, video_id, origin, title, channel_name, channel_url, body_markdown, model, created_at) VALUES ('bad', 'request-a', 'attempt-a', 'b', ?, 'direct', '제목', '채널', 'https://example.com', '본문', 'fixture', ?)",
        video,
        now,
      ).run(),
    ).rejects.toThrow();
  });

  test("성공 리포트는 본문·소유자·생성 경로를 덮어쓰지 못해요", async () => {
    await report();
    expect(
      await sql("SELECT channel_url FROM reports WHERE id = 'report-a'").first(
        "channel_url",
      ),
    ).toBeNull();
    await expect(
      sql(
        "UPDATE reports SET body_markdown = '새 본문' WHERE id = 'report-a'",
      ).run(),
    ).rejects.toThrow();
    await expect(
      sql(
        "UPDATE summary_requests SET status = 'queued' WHERE id = 'request-a'",
      ).run(),
    ).rejects.toThrow();
    expect(
      await sql(
        "SELECT body_markdown FROM reports WHERE id = ? AND user_id = ?",
        "report-a",
        "b",
      ).first(),
    ).toBeNull();
  });

  test("직접 리포트는 나중에 채널을 등록해도 발송 대상으로 만들지 못해요", async () => {
    await report();
    await channel();
    await expect(channel("duplicate-channel")).rejects.toThrow();
    await recipient();
    await expect(delivery()).rejects.toThrow();
    expect((await sql("SELECT id FROM reports").all()).results).toEqual([
      { id: "report-a" },
    ]);
  });

  test("채널 중지·삭제는 대기 발송을 취소하고 리포트와 기존 채널 이력을 남겨요", async () => {
    await channel();
    await recipient();
    await report("channel-a");
    await delivery();
    await sql(
      "UPDATE channels SET status = 'paused' WHERE id = 'channel-a'",
    ).run();
    expect(
      await sql("SELECT status FROM deliveries WHERE id = 'delivery-a'").first(
        "status",
      ),
    ).toBe("cancelled");
    await sql(
      "UPDATE channels SET status = 'deleted' WHERE id = 'channel-a'",
    ).run();
    await channel("new-registration");
    await expect(
      sql("UPDATE channels SET status = 'active' WHERE id = 'channel-a'").run(),
    ).rejects.toThrow();
    expect(
      await sql(
        "SELECT body_markdown FROM reports WHERE id = 'report-a'",
      ).first("body_markdown"),
    ).toBe("# 저장한 본문");
    expect(
      await sql(
        "SELECT channel_id FROM summary_requests WHERE id = 'request-a'",
      ).first("channel_id"),
    ).toBe("channel-a");
  });

  test("빈 채널도 첫 확인 완료를 보존하고 같은 영상 관찰은 한 번만 저장해요", async () => {
    await channel();
    await sql(
      "UPDATE channels SET baseline_initialized_at = ?, last_checked_at = ? WHERE id = 'channel-a'",
      now,
      now,
    ).run();
    expect(
      await sql(
        "SELECT baseline_initialized_at FROM channels WHERE id = 'channel-a'",
      ).first("baseline_initialized_at"),
    ).toBe(now);
    await expect(
      sql(
        "UPDATE channels SET baseline_initialized_at = NULL WHERE id = 'channel-a'",
      ).run(),
    ).rejects.toThrow();
    await sql(
      "INSERT INTO channel_videos (channel_id, user_id, video_id, is_baseline, discovered_at) VALUES ('channel-a', 'a', ?, 0, ?)",
      video,
      now + 1,
    ).run();
    await expect(
      sql(
        "INSERT INTO channel_videos (channel_id, user_id, video_id, is_baseline, discovered_at) VALUES ('channel-a', 'a', ?, 1, ?)",
        video,
        now + 1,
      ).run(),
    ).rejects.toThrow();
  });

  test("미확인 주소와 중복 발송을 막고 주소 삭제 시 대기 발송을 취소해요", async () => {
    await channel();
    await recipient();
    await report("channel-a");
    await sql(
      "UPDATE recipients SET verified_at = NULL WHERE id = 'recipient-a'",
    ).run();
    await expect(delivery()).rejects.toThrow();
    await sql(
      "UPDATE recipients SET verified_at = ? WHERE id = 'recipient-a'",
      now,
    ).run();
    await delivery();
    await expect(
      sql(
        "INSERT INTO deliveries (id, user_id, report_id, channel_id, recipient_id, recipient_email, created_at) VALUES ('duplicate', 'a', 'report-a', 'channel-a', 'recipient-a', 'receiver@example.com', ?)",
        now,
      ).run(),
    ).rejects.toThrow();
    await sql(
      "UPDATE recipients SET deleted_at = ? WHERE id = 'recipient-a'",
      now + 1,
    ).run();
    expect(
      await sql("SELECT status FROM deliveries WHERE id = 'delivery-a'").first(
        "status",
      ),
    ).toBe("cancelled");
  });

  test("성공한 수신 주소는 재발송하거나 성공 이력을 덮어쓰지 못해요", async () => {
    await channel();
    await recipient();
    await report("channel-a");
    await delivery();
    await sql(
      "UPDATE deliveries SET status = 'sending' WHERE id = 'delivery-a'",
    ).run();
    await sql(
      "INSERT INTO delivery_attempts (id, delivery_id, user_id, attempt_number, started_at) VALUES ('send-a', 'delivery-a', 'a', 1, ?)",
      now + 2,
    ).run();
    await sql(
      "UPDATE delivery_attempts SET status = 'accepted', finished_at = ? WHERE id = 'send-a'",
      now + 3,
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
        "UPDATE delivery_attempts SET status = 'rejected' WHERE id = 'send-a'",
      ).run(),
    ).rejects.toThrow();
    await sql(
      "UPDATE channels SET status = 'paused' WHERE id = 'channel-a'",
    ).run();
    expect(
      await sql("SELECT status FROM deliveries WHERE id = 'delivery-a'").first(
        "status",
      ),
    ).toBe("sent");
  });

  test("결과 불명 메일은 새 발송이나 근거 없는 성공으로 바꾸지 못해요", async () => {
    await channel();
    await recipient();
    await report("channel-a");
    await delivery();
    await sql(
      "UPDATE deliveries SET status = 'sending' WHERE id = 'delivery-a'",
    ).run();
    await sql(
      "UPDATE deliveries SET status = 'ambiguous' WHERE id = 'delivery-a'",
    ).run();
    await expect(
      sql(
        "UPDATE deliveries SET status = 'queued' WHERE id = 'delivery-a'",
      ).run(),
    ).rejects.toThrow();
    await expect(
      sql(
        "UPDATE deliveries SET status = 'sent' WHERE id = 'delivery-a'",
      ).run(),
    ).rejects.toThrow();
  });

  test("batch 중 제약 위반이면 앞선 변경도 되돌아가요", async () => {
    await expect(
      env.DB.batch([
        sql(
          "INSERT INTO user_settings (user_id, check_interval_minutes) VALUES ('a', 60)",
        ),
        sql(
          "INSERT INTO user_settings (user_id, check_interval_minutes) VALUES ('missing', 60)",
        ),
      ]),
    ).rejects.toThrow();
    expect(
      await sql("SELECT * FROM user_settings WHERE user_id = 'a'").first(),
    ).toBeNull();
  });

  test("마이그레이션 실패는 해당 파일의 DDL과 적용 이력을 함께 되돌려요", async () => {
    await expect(
      applyD1Migrations(env.DB, [
        {
          name: "9999_failure_probe.sql",
          queries: [
            "CREATE TABLE migration_probe (id TEXT)",
            "INSERT INTO table_that_does_not_exist VALUES (1)",
          ],
        },
      ]),
    ).rejects.toThrow();
    expect(
      await sql(
        "SELECT name FROM sqlite_schema WHERE name = 'migration_probe'",
      ).first(),
    ).toBeNull();
    expect(
      await sql(
        "SELECT name FROM d1_migrations WHERE name = '9999_failure_probe.sql'",
      ).first(),
    ).toBeNull();
  });

  test("보관함 keyset 조회는 인덱스를 사용하고 로컬 읽기·쓰기·용량 계측을 제공해요", async () => {
    await report();
    const query =
      "SELECT id, title FROM reports WHERE user_id = ? AND (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?";
    const plan = await sql(
      `EXPLAIN QUERY PLAN ${query}`,
      "a",
      now + 10,
      "zz",
      20,
    ).all<{ detail: string }>();
    expect(
      plan.results.some((row) =>
        row.detail.includes("SEARCH reports USING INDEX"),
      ),
    ).toBe(true);
    const result = await sql(query, "a", now + 10, "zz", 20).all();
    expect(result.results).toEqual([{ id: "report-a", title: "원본 영상" }]);
    expect(result.meta.rows_read).toBeGreaterThanOrEqual(0);
    expect(result.meta.rows_written).toBe(0);
    expect(result.meta.size_after).toBeGreaterThan(0);
    const write = await sql(
      "INSERT INTO user_settings (user_id) VALUES ('a')",
    ).run();
    expect(write.meta.rows_written).toBeGreaterThan(0);
    console.info("로컬 D1 계측", {
      rows_read: result.meta.rows_read,
      rows_written: write.meta.rows_written,
      size_after: write.meta.size_after,
      duration: result.meta.duration,
    });
    expect((await sql("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });

  test.each([
    [
      "SELECT id FROM reports WHERE user_id = ? AND channel_url = ? ORDER BY created_at DESC, id DESC LIMIT 20",
      ["a", "https://www.youtube.com/@fixture"],
      "reports_owner_channel",
    ],
    [
      "SELECT id FROM reports WHERE user_id = ? AND origin = ? ORDER BY created_at DESC, id DESC LIMIT 20",
      ["a", "direct"],
      "reports_owner_origin",
    ],
    [
      "SELECT id FROM channels WHERE status = 'active' AND next_check_at <= ? ORDER BY next_check_at LIMIT 20",
      [now],
      "channels_due",
    ],
    [
      "SELECT id FROM deliveries WHERE status = 'queued' AND available_at <= ? ORDER BY available_at, id LIMIT 20",
      [now],
      "deliveries_due",
    ],
  ] as const)(
    "주요 조회의 인덱스 계획을 확인해요: %s",
    async (query, values, index) => {
      const plan = await sql(`EXPLAIN QUERY PLAN ${query}`, ...values).all<{
        detail: string;
      }>();
      expect(plan.results.some((row) => row.detail.includes(index))).toBe(true);
    },
  );
});
