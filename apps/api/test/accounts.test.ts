import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createApp } from "../src/app";
import { sha256Hex } from "../src/auth";
import { EmailError, type EmailMessage } from "../src/email";
import { runBackgroundJobs } from "../src/jobs/runner";
import type { generateReport, getVideoMetadata } from "../src/summary";

const now = 1_800_000_000;
const address = "reader@example.com";
const password = "correct horse battery staple";
const app = createApp();
const sql = (query: string, ...values: (string | number | null)[]) =>
  env.DB.prepare(query).bind(...values);
let clock = now;
let ipCounter = 0;
let sent: EmailMessage[] = [];
let sendImpl: (message: EmailMessage) => Promise<void> = async () => {};

// 요청 제한을 따로 검사하는 경우가 아니면 요청마다 다른 IP를 사용해요.
function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  ipCounter += 1;
  return app.request(
    `/v1${path}`,
    {
      method,
      headers: {
        "cf-connecting-ip": `10.0.0.${ipCounter}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

const register = (input: object = {}) =>
  call("POST", "/auth/registrations", {
    email: address,
    password,
    nickname: "읽는사람",
    ...input,
  });
const login = (input: object = {}, headers = {}) =>
  call(
    "POST",
    "/auth/sessions",
    { email: address, password, ...input },
    headers,
  );

// 실제 실행기로 인증 메일을 보내고 본문에서 코드를 꺼내요.
async function deliverMail() {
  await runBackgroundJobs(env, {
    now: () => clock,
    metadata: vi.fn() as unknown as typeof getVideoMetadata,
    generate: vi.fn() as unknown as typeof generateReport,
    send: async (_config, message) => {
      await sendImpl(message);
      sent.push(message);
      return { status: "accepted" as const, messageId: "fixture" };
    },
  });
  const last = sent.at(-1);
  return last?.text.match(/[A-Za-z0-9_-]{43}/)?.[0] ?? "";
}

async function verifiedAccount() {
  await register();
  const token = await deliverMail();
  const response = await call("POST", "/auth/email-verifications/confirm", {
    token,
    password,
  });
  expect(response.status).toBe(204);
}

async function loginToken() {
  const response = await login();
  expect(response.status).toBe(201);
  return (await response.json<{ sessionToken: string }>()).sessionToken;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const count = (table: string) =>
  sql(`SELECT count(*) AS count FROM ${table}`).first<number>("count");

// 실제 scrypt 비용을 쓰므로 해시를 여러 번 하는 흐름은 기본 5초보다 오래 걸릴 수 있어요.
vi.setConfig({ testTimeout: 60_000 });

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  clock = now;
  sent = [];
  sendImpl = async () => {};
  vi.spyOn(Date, "now").mockImplementation(() => clock * 1000);
  vi.spyOn(console, "info").mockImplementation(() => {});
  for (const table of [
    "auth_mail_outbox",
    "auth_rate_limits",
    "summary_admissions",
    "summary_requests",
    "analysis_jobs",
    "videos",
    "account_tokens",
    "sessions",
    "users",
  ])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("가입 → 메일 확인 → 로그인 → 내 정보 → 로그아웃이 실제 저장 상태와 맞아요", async () => {
  const registered = await register();
  expect(registered.status).toBe(202);
  expect(await registered.json()).toEqual({ status: "verification_required" });

  // 확인 전에는 세션을 발급하지 않아요.
  const early = await login();
  expect(early.status).toBe(403);
  expect(await early.json()).toEqual({
    error: { code: "EMAIL_VERIFICATION_REQUIRED" },
  });
  expect(await count("sessions")).toBe(0);

  const token = await deliverMail();
  expect(sent[0]?.to).toBe(address);
  const confirmed = await call("POST", "/auth/email-verifications/confirm", {
    token,
    password,
  });
  expect(confirmed.status).toBe(204);

  const session = await login();
  expect(session.status).toBe(201);
  expect(session.headers.get("cache-control")).toBe("no-store");
  const created = await session.json<{
    sessionToken: string;
    expiresAt: string;
    user: { id: string; email: string; nickname: string };
  }>();
  expect(created.expiresAt).toBe(
    new Date((now + 30 * 86_400) * 1000).toISOString(),
  );
  expect(created.user).toMatchObject({ email: address, nickname: "읽는사람" });

  const me = await call("GET", "/me", undefined, bearer(created.sessionToken));
  expect(me.status).toBe(200);
  expect(await me.json()).toEqual({
    id: created.user.id,
    email: address,
    nickname: "읽는사람",
    emailVerified: true,
  });

  const out = await call(
    "DELETE",
    "/auth/session",
    undefined,
    bearer(created.sessionToken),
  );
  expect(out.status).toBe(204);
  const after = await call(
    "GET",
    "/me",
    undefined,
    bearer(created.sessionToken),
  );
  expect(after.status).toBe(401);
});

test("비밀값은 저장소와 메일 대기열에 원문으로 남지 않아요", async () => {
  await register();
  const user = await sql(
    "SELECT password_hash FROM users WHERE email = ?",
    address,
  ).first<string>("password_hash");
  expect(user).toMatch(/^scrypt\$8192\$8\$10\$/);
  expect(user).not.toContain(password);
  const stored = await sql(
    "SELECT token_ciphertext FROM auth_mail_outbox",
  ).first<string>("token_ciphertext");
  const token = await deliverMail();
  expect(stored).not.toContain(token);
  // 발송이 끝나면 암호문도 지워요.
  expect(await count("auth_mail_outbox")).toBe(0);
  const hash = await sql("SELECT token_hash FROM account_tokens").first<string>(
    "token_hash",
  );
  expect(hash).toBe(await sha256Hex(token));

  await call("POST", "/auth/email-verifications/confirm", { token, password });
  const body = await (await login()).json<{ sessionToken: string }>();
  const session = await sql("SELECT token_hash FROM sessions").first<string>(
    "token_hash",
  );
  expect(session).toBe(await sha256Hex(body.sessionToken));
});

test("중복 가입은 같은 응답이고 기존 비밀번호·닉네임·메일을 건드리지 않아요", async () => {
  await verifiedAccount();
  const before = await sql(
    "SELECT * FROM users WHERE email = ?",
    address,
  ).first();
  const sentBefore = sent.length;
  const again = await register({
    password: "another long enough password",
    nickname: "새이름",
  });
  expect(again.status).toBe(202);
  expect(await again.json()).toEqual({ status: "verification_required" });
  expect(
    await sql("SELECT * FROM users WHERE email = ?", address).first(),
  ).toEqual(before);
  expect(await count("auth_mail_outbox")).toBe(0);
  await deliverMail();
  expect(sent.length).toBe(sentBefore);
  expect((await login()).status).toBe(201);
});

test("틀린 비밀번호와 없는 계정은 같은 401이에요", async () => {
  await verifiedAccount();
  const wrong = await login({ password: "wrong wrong wrong wrong" });
  const missing = await login({ email: "nobody@example.com" });
  expect(wrong.status).toBe(401);
  expect(missing.status).toBe(401);
  expect(await wrong.text()).toBe(await missing.text());
  expect(await count("sessions")).toBe(0);
});

test("이메일을 앞뒤 공백 제거·ASCII 소문자로 정규화해요", async () => {
  await register({ email: "  Reader@Example.COM " });
  const stored = await sql("SELECT email FROM users").first<string>("email");
  expect(stored).toBe(address);
});

test.each([
  ["email", { email: "not-mail" }],
  ["email", { email: `${"a".repeat(250)}@example.com` }],
  ["password", { password: "short" }],
  ["password", { password: "ab".repeat(64).concat("a") }],
  ["password", { password: "aaaaaaaaaaaaaaaaaaaa" }],
  ["password", { password: "seven77" }],
  ["nickname", { nickname: "a" }],
  ["nickname", { nickname: "가".repeat(21) }],
  ["nickname", { nickname: "줄\n바꿈" }],
])("가입 입력 %s 오류를 구분해 400으로 알려요 (%j)", async (field, input) => {
  const response = await register(input);
  expect(response.status).toBe(400);
  const body = await response.json<{
    error: { code: string; fields: Record<string, string> };
  }>();
  expect(body.error.code).toBe("INVALID_INPUT");
  expect(body.error.fields[field]).toBeTruthy();
  expect(await count("users")).toBe(0);
});

test("흔한 비밀번호도 8자 이상이고 한 글자 반복이 아니면 받아요", async () => {
  const response = await register({ password: "password" });
  expect(response.status).toBe(202);
});

test.each([
  ["비밀번호 8자", { password: "abcd1234" }],
  ["비밀번호 128자", { password: "ab".repeat(64) }],
  ["닉네임 2자", { nickname: "독자" }],
  ["닉네임 20자", { nickname: "가".repeat(20) }],
  ["이메일 254자", { email: `${"a".repeat(242)}@example.com` }],
])("경계값 %s는 받아요", async (_name, input) => {
  expect((await register(input)).status).toBe(202);
});

test("공백과 유니코드 비밀번호를 자르거나 바꾸지 않아요", async () => {
  const spaced = "  한글 비밀번호 앞뒤 공백 포함  ";
  await register({ password: spaced });
  const token = await deliverMail();
  await call("POST", "/auth/email-verifications/confirm", {
    token,
    password: spaced,
  });
  expect((await login({ password: spaced })).status).toBe(201);
  expect((await login({ password: spaced.trim() })).status).toBe(401);
});

test("닉네임은 중복을 허용해요", async () => {
  await register();
  const other = await register({ email: "other@example.com" });
  expect(other.status).toBe(202);
  expect(await count("users")).toBe(2);
});

test("알 수 없는 필드·query·잘못된 JSON은 400, 큰 본문은 413이에요", async () => {
  expect((await register({ userId: "x" })).status).toBe(400);
  expect(
    (await call("POST", "/auth/sessions?x=1", { email: address, password }))
      .status,
  ).toBe(400);
  const broken = await app.request(
    "/v1/auth/sessions",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    },
    env,
  );
  expect(broken.status).toBe(400);
  const large = await register({ nickname: "가".repeat(20_000) });
  expect(large.status).toBe(413);
});

test("이메일 확인은 가입 비밀번호가 맞아야 하고 코드는 한 번만 써요", async () => {
  await register();
  const token = await deliverMail();
  const wrong = await call("POST", "/auth/email-verifications/confirm", {
    token,
    password: "someone else guessing it",
  });
  expect(wrong.status).toBe(400);
  expect(await wrong.json()).toEqual({ error: { code: "INVALID_TOKEN" } });
  expect((await login()).status).toBe(403);
  const right = () =>
    call("POST", "/auth/email-verifications/confirm", { token, password });
  expect((await right()).status).toBe(204);
  expect((await right()).status).toBe(400);
});

test("만료된 확인 코드는 거부하고 재발급하면 이전 코드는 폐기돼요", async () => {
  await register();
  const first = await deliverMail();
  clock += 3_700;
  const resend = await call("POST", "/auth/email-verifications", {
    email: address,
  });
  expect(resend.status).toBe(202);
  const second = await deliverMail();
  expect(second).not.toBe(first);
  const old = await call("POST", "/auth/email-verifications/confirm", {
    token: first,
    password,
  });
  expect(old.status).toBe(400);

  clock += 86_401;
  const late = await call("POST", "/auth/email-verifications/confirm", {
    token: second,
    password,
  });
  expect(late.status).toBe(400);
  expect((await login()).status).toBe(403);
});

test("메일 요청은 계정 유무와 상관없이 같은 202이고 없는 주소로는 보내지 않아요", async () => {
  await verifiedAccount();
  const count0 = sent.length;
  for (const path of ["/auth/email-verifications", "/auth/password-resets"]) {
    const response = await call("POST", path, {
      email: `nobody${path.length}@example.com`,
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted" });
  }
  // 이미 확인한 계정에도 확인 메일을 보내지 않아요.
  const verified = await call("POST", "/auth/email-verifications", {
    email: address,
  });
  expect(verified.status).toBe(202);
  await deliverMail();
  expect(sent.length).toBe(count0);
});

test("비밀번호 재설정은 세션과 다른 코드를 폐기하고 코드는 한 번만 써요", async () => {
  await verifiedAccount();
  const session = await loginToken();
  await call("POST", "/auth/password-resets", { email: address });
  const token = await deliverMail();
  const next = "a brand new long passphrase";
  const reset = () =>
    call("POST", "/auth/password-resets/confirm", { token, password: next });

  const weak = await call("POST", "/auth/password-resets/confirm", {
    token,
    password: "short",
  });
  expect(weak.status).toBe(400);

  expect((await reset()).status).toBe(204);
  expect((await reset()).status).toBe(400);
  expect((await call("GET", "/me", undefined, bearer(session))).status).toBe(
    401,
  );
  expect((await login()).status).toBe(401);
  expect((await login({ password: next })).status).toBe(201);
});

test("같은 재설정 코드의 동시 요청은 한 번만 성공해요", async () => {
  await verifiedAccount();
  await call("POST", "/auth/password-resets", { email: address });
  const token = await deliverMail();
  const responses = await Promise.all(
    ["first long enough password", "second long enough password"].map((value) =>
      call("POST", "/auth/password-resets/confirm", { token, password: value }),
    ),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([
    204, 400,
  ]);
});

test("재설정 코드는 30분 뒤 만료되고 확인 코드로 쓸 수 없어요", async () => {
  await verifiedAccount();
  await call("POST", "/auth/password-resets", { email: address });
  const token = await deliverMail();
  const asVerify = await call("POST", "/auth/email-verifications/confirm", {
    token,
    password,
  });
  expect(asVerify.status).toBe(400);
  clock += 1_801;
  const late = await call("POST", "/auth/password-resets/confirm", {
    token,
    password: "a brand new long passphrase",
  });
  expect(late.status).toBe(400);
});

test("미확인 계정은 재설정해도 이메일 확인을 건너뛰지 못해요", async () => {
  await register();
  await deliverMail();
  await call("POST", "/auth/password-resets", { email: address });
  const token = await deliverMail();
  const next = "a brand new long passphrase";
  const reset = await call("POST", "/auth/password-resets/confirm", {
    token,
    password: next,
  });
  expect(reset.status).toBe(204);
  expect((await login({ password: next })).status).toBe(403);
});

test("로그인은 IP와 이메일 각각 분당 5회로 제한하고 없는 계정도 같아요", async () => {
  const ip = { "cf-connecting-ip": "203.0.113.1" };
  for (let index = 0; index < 5; index += 1)
    expect(
      (await login({ email: `user${index}@example.com` }, ip)).status,
    ).toBe(401);
  const blocked = await login({ email: "user9@example.com" }, ip);
  expect(blocked.status).toBe(429);
  expect(await blocked.json()).toEqual({ error: { code: "RATE_LIMITED" } });
  expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

  for (let index = 0; index < 5; index += 1)
    expect((await login({ email: "target@example.com" })).status).toBe(401);
  expect((await login({ email: "target@example.com" })).status).toBe(429);

  clock += 60;
  expect((await login({ email: "target@example.com" })).status).toBe(401);
});

test("메일 요청은 대상 주소당 60초 간격·시간당 3회로 제한해요", async () => {
  const request = () =>
    call("POST", "/auth/password-resets", { email: "nobody@example.com" });
  expect((await request()).status).toBe(202);
  clock += 60;
  expect((await request()).status).toBe(202);
  clock += 60;
  expect((await request()).status).toBe(202);
  clock += 60;
  expect((await request()).status).toBe(429);

  const gap = () =>
    call("POST", "/auth/password-resets", { email: "gap@example.com" });
  expect((await gap()).status).toBe(202);
  expect((await gap()).status).toBe(429);
});

test("메일 요청 60초 간격은 시계 경계와 상관없이 첫 요청부터 세요", async () => {
  const request = () =>
    call("POST", "/auth/password-resets", { email: "edge@example.com" });
  clock = now + 59;
  expect((await request()).status).toBe(202);
  clock = now + 60;
  const blocked = await request();
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get("retry-after")).toBe("59");
  clock = now + 119;
  expect((await request()).status).toBe(202);
});

test("가입은 IP당 시간당 10회로 제한해요", async () => {
  const ip = { "cf-connecting-ip": "203.0.113.2" };
  const signup = (index: number) =>
    call(
      "POST",
      "/auth/registrations",
      { email: `u${index}@example.com`, password, nickname: "독자" },
      ip,
    );
  for (let index = 0; index < 10; index += 1)
    expect((await signup(index)).status).toBe(202);
  expect((await signup(10)).status).toBe(429);
});

test("요청 제한은 IP·이메일 원문을 저장하지 않아요", async () => {
  await login({}, { "cf-connecting-ip": "203.0.113.3" });
  const rows = await sql("SELECT key FROM auth_rate_limits").all<{
    key: string;
  }>();
  expect(rows.results.length).toBe(2);
  for (const row of rows.results) {
    expect(row.key).not.toContain("203.0.113.3");
    expect(row.key).not.toContain(address);
  }
});

test("서버 키가 없으면 요청을 저장하지 않고 503이에요", async () => {
  const response = await app.request(
    "/v1/auth/password-resets",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: address }),
    },
    { ...env, AUTH_TOKEN_KEY: "" },
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: { code: "SERVICE_UNAVAILABLE" },
  });
  expect(await count("auth_rate_limits")).toBe(0);
});

test("일시 거부만 1분·5분 뒤 총 세 번 시도하고 이후 대기열에서 지워요", async () => {
  await register();
  let calls = 0;
  sendImpl = async () => {
    calls += 1;
    throw new EmailError("temporary");
  };
  await deliverMail();
  expect(calls).toBe(1);
  await deliverMail();
  expect(calls).toBe(1);
  clock += 60;
  await deliverMail();
  expect(calls).toBe(2);
  clock += 300;
  await deliverMail();
  expect(calls).toBe(3);
  expect(await count("auth_mail_outbox")).toBe(0);
});

test("영구 거부와 접수 불명은 자동으로 다시 보내지 않아요", async () => {
  for (const reason of ["permanent", "ambiguous"] as const) {
    await register({ email: `${reason}@example.com` });
    let calls = 0;
    sendImpl = async () => {
      calls += 1;
      throw new EmailError(reason);
    };
    await deliverMail();
    clock += 400;
    await deliverMail();
    expect(calls).toBe(1);
  }
  expect(await count("auth_mail_outbox")).toBe(0);
});

test("발송 중 멈춘 메일과 만료된 메일은 재발송 없이 지워요", async () => {
  await register();
  await sql(
    "UPDATE auth_mail_outbox SET lease_token = 'stale', lease_expires_at = ?",
    now,
  ).run();
  clock += 1;
  await deliverMail();
  expect(sent.length).toBe(0);
  expect(await count("auth_mail_outbox")).toBe(0);

  await register({ email: "late@example.com" });
  clock += 86_401;
  await deliverMail();
  expect(sent.length).toBe(0);
  expect(await count("auth_mail_outbox")).toBe(0);
});

test("서버 키가 잘못되면 대기 메일을 지우지 않고 복구 후 보내요", async () => {
  await register();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const send = vi.fn();
  await runBackgroundJobs(
    { ...env, AUTH_TOKEN_KEY: "" },
    {
      now: () => clock,
      metadata: vi.fn() as unknown as typeof getVideoMetadata,
      generate: vi.fn() as unknown as typeof generateReport,
      send,
    },
  );
  expect(send).not.toHaveBeenCalled();
  expect(await count("auth_mail_outbox")).toBe(1);
  expect(JSON.stringify(error.mock.calls)).toContain(
    "auth_mail.key_unavailable",
  );
  expect(await deliverMail()).toHaveLength(43);
});

test("인증 응답은 성공·오류·본문 없음 모두 no-store예요", async () => {
  const invalid = await register({ password: "x" });
  expect(invalid.status).toBe(400);
  expect(invalid.headers.get("cache-control")).toBe("no-store");

  await register();
  const token = await deliverMail();
  const wrong = await call("POST", "/auth/email-verifications/confirm", {
    token: "a".repeat(43),
    password,
  });
  expect(wrong.status).toBe(400);
  expect(wrong.headers.get("cache-control")).toBe("no-store");
  const confirmed = await call("POST", "/auth/email-verifications/confirm", {
    token,
    password,
  });
  expect(confirmed.status).toBe(204);
  expect(confirmed.headers.get("cache-control")).toBe("no-store");

  const mail = () =>
    call("POST", "/auth/password-resets", { email: "z@example.com" });
  await mail();
  const limited = await mail();
  expect(limited.status).toBe(429);
  expect(limited.headers.get("cache-control")).toBe("no-store");

  const large = await register({ nickname: "가".repeat(20_000) });
  expect(large.status).toBe(413);
  expect(large.headers.get("cache-control")).toBe("no-store");

  const session = await loginToken();
  const me = await call("GET", "/me", undefined, bearer(session));
  expect(me.headers.get("cache-control")).toBe("no-store");
  const out = await call("DELETE", "/auth/session", undefined, bearer(session));
  expect(out.headers.get("cache-control")).toBe("no-store");
});

test("본문이 없는 경로도 알 수 없는 query는 400이에요", async () => {
  await verifiedAccount();
  const session = await loginToken();
  const me = await call("GET", "/me?x=1", undefined, bearer(session));
  expect(me.status).toBe(400);
  expect(await me.json()).toEqual({ error: { code: "INVALID_INPUT" } });
  const out = await call(
    "DELETE",
    "/auth/session?x=1",
    undefined,
    bearer(session),
  );
  expect(out.status).toBe(400);
  // 거부한 요청은 세션을 폐기하지 않아요.
  expect((await call("GET", "/me", undefined, bearer(session))).status).toBe(
    200,
  );
});

test("인증 경로 밖의 없는 경로는 큰 본문이어도 JSON 404예요", async () => {
  const response = await call("POST", "/nope", { value: "x".repeat(20_000) });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: { code: "NOT_FOUND" } });
});

test("세션은 30일 뒤 만료되고 다시 로그인할 수 있어요", async () => {
  await verifiedAccount();
  const session = await loginToken();
  clock += 30 * 86_400 - 1;
  expect((await call("GET", "/me", undefined, bearer(session))).status).toBe(
    200,
  );
  clock += 1;
  expect((await call("GET", "/me", undefined, bearer(session))).status).toBe(
    401,
  );
  const again = await loginToken();
  expect((await call("GET", "/me", undefined, bearer(again))).status).toBe(200);
});

test("로그아웃은 현재 세션만 폐기해요", async () => {
  await verifiedAccount();
  const first = await loginToken();
  const second = await loginToken();
  await call("DELETE", "/auth/session", undefined, bearer(first));
  expect((await call("GET", "/me", undefined, bearer(first))).status).toBe(401);
  expect((await call("GET", "/me", undefined, bearer(second))).status).toBe(
    200,
  );
});

test("로그인으로 받은 세션끼리 내 정보와 요약 요청을 섞지 않아요", async () => {
  await verifiedAccount();
  const a = await loginToken();
  const other = "other@example.com";
  await register({ email: other, nickname: "다른사람" });
  clock += 60;
  const token = await deliverMail();
  await call("POST", "/auth/email-verifications/confirm", { token, password });
  const signedIn = await login({ email: other });
  const b = (await signedIn.json<{ sessionToken: string }>()).sessionToken;

  const meA = await (await call("GET", "/me", undefined, bearer(a))).json<{
    email: string;
  }>();
  const meB = await (await call("GET", "/me", undefined, bearer(b))).json<{
    email: string;
    nickname: string;
  }>();
  expect(meA.email).toBe(address);
  expect(meB).toMatchObject({ email: other, nickname: "다른사람" });

  const created = await call(
    "POST",
    "/summary-requests",
    { url: "https://www.youtube.com/watch?v=jNQXAC9IVRw" },
    bearer(a),
  );
  expect(created.status).toBe(202);
  const { id } = await created.json<{ id: string }>();
  expect(
    (await call("GET", `/summary-requests/${id}`, undefined, bearer(a))).status,
  ).toBe(200);
  expect(
    (await call("GET", `/summary-requests/${id}`, undefined, bearer(b))).status,
  ).toBe(404);
});

test("로그에 주소와 코드를 남기지 않아요", async () => {
  const info = vi.spyOn(console, "info");
  await register();
  const token = await deliverMail();
  const logged = JSON.stringify(info.mock.calls);
  expect(logged).toContain("auth_mail.sent");
  expect(logged).not.toContain(address);
  expect(logged).not.toContain(token);
});
