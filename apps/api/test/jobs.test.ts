import { applyD1Migrations, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { EmailError } from "../src/email";
import {
  claimAnalysis,
  completeAnalysis,
  enqueueAnalysis,
  failAnalysis,
  generationKey,
  generationProfile,
  getAnalysisRequest,
  markAnalysisDispatched,
  recoverAnalysis,
  retryAnalysis,
} from "../src/jobs/analysis";
import {
  cancelUndispatchedDelivery,
  claimDelivery,
  completeDelivery,
  enqueueDelivery,
  getDelivery,
  markDeliveryDispatched,
  recoverDeliveries,
  retryDelivery,
} from "../src/jobs/delivery";
import { type JobProviders, runBackgroundJobs } from "../src/jobs/runner";
import {
  ANALYSIS_LEASE_SECONDS,
  DELIVERY_LEASE_SECONDS,
  type JobClaim,
} from "../src/jobs/shared";
import worker from "../src/server";
import { SummaryError } from "../src/summary";

const start = 1_800_000_000;
const videoId = "jNQXAC9IVRw";
const url = `https://www.youtube.com/watch?v=${videoId}`;
const model = "gemini-3.6-flash";
const result = {
  title: "원본 영상",
  channel: "원본 채널",
  channelUrl: "https://www.youtube.com/@fixture",
  markdown:
    "<script>이 문자열은 메일에서 실행되면 안 돼요.</script>\n공통 보고서 본문",
  model,
  interactionId: "fixture-interaction",
  generationMs: 1,
  usage: {
    inputTokens: 2,
    outputTokens: 10,
    thoughtTokens: 0,
    toolUseTokens: 0,
    cachedTokens: 0,
    totalTokens: 12,
  },
  timestampVerification: "unverified" as const,
};
let now = start;
let io: JobProviders;
const sql = (query: string, ...values: (string | number | null)[]) =>
  env.DB.prepare(query).bind(...values);
const enqueue = (userId = "a", inputUrl = url) =>
  enqueueAnalysis(env.DB, { userId, url: inputUrl, model }, now);
const run = () => runBackgroundJobs(env, io);
const readRequest = (id: string, owner = "a") =>
  getAnalysisRequest(env.DB, owner, id);

function requiredClaim(claim: JobClaim | null) {
  if (!claim) throw new Error("검사할 실행권이 필요해요.");
  return claim;
}

async function automaticRequest() {
  await env.DB.batch([
    sql(
      "INSERT INTO channels (id,youtube_channel_id,title,url) VALUES ('channel','UC_fixture','채널','https://www.youtube.com/channel/UC_fixture')",
    ),
    sql("INSERT INTO videos (id,channel_id) VALUES (?,'channel')", videoId),
    sql(
      "INSERT INTO channel_subscriptions (id,user_id,channel_id,baseline_initialized_at) VALUES ('sub','a','channel',?)",
      now - 1,
    ),
    sql(
      "INSERT INTO subscription_videos (subscription_id,video_id,is_baseline) VALUES ('sub',?,0)",
      videoId,
    ),
    sql(
      "INSERT INTO recipients (id,user_id,email,verified_at) VALUES ('recipient','a','receiver@example.com',?)",
      now,
    ),
  ]);
  return enqueueAnalysis(
    env.DB,
    { userId: "a", url, model, subscriptionId: "sub" },
    now,
  );
}

async function queuedDelivery() {
  const request = await automaticRequest();
  await run();
  return enqueueDelivery(env.DB, "a", request.id, "recipient", now);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  vi.restoreAllMocks();
  now = start;
  for (const table of [
    "delivery_attempts",
    "deliveries",
    "comments",
    "report_permissions",
    "reports",
    "summary_admissions",
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
  ])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  await env.DB.batch(
    ["a", "b", "c"].map((id) =>
      sql(
        "INSERT INTO users (id,email,nickname,password_hash) VALUES (?,?,'독자','fixture')",
        id,
        `${id}@example.com`,
      ),
    ),
  );
  io = {
    now: () => now,
    metadata: vi.fn(async (input: string) => ({
      videoId,
      url: input,
      title: result.title,
      channel: result.channel,
      channelUrl: result.channelUrl,
      metadataSource: "https://www.youtube.com/oembed",
    })),
    generate: vi.fn(async () => result),
    send: vi.fn(async () => ({
      status: "accepted" as const,
      messageId: "<fixture@example.com>",
    })),
  };
});

describe("D1 영속 분석 실행", () => {
  test("대기 작업이 없는 scheduled 핸들러는 공급자를 호출하지 않아요", async () => {
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(
        new Error("대기 작업이 없어 외부 호출을 하면 안 돼요."),
      );
    await worker.scheduled(createScheduledController(), env);
    await runBackgroundJobs(env, io);
    expect(network).not.toHaveBeenCalled();
    expect(io.metadata).not.toHaveBeenCalled();
    expect(io.generate).not.toHaveBeenCalled();
    expect(io.send).not.toHaveBeenCalled();
  });

  test("접수 직후 실행 전달이 없어도 새 실행자가 결과와 개인 권한을 함께 저장해요", async () => {
    const request = await enqueue();
    expect(request).toMatchObject({
      status: "queued",
      attempt: 0,
      reportId: null,
    });
    await run();
    expect(await readRequest(request.id)).toMatchObject({
      status: "completed",
      attempt: 1,
      retryable: false,
      reportId: expect.any(String),
    });
    expect(io.generate).toHaveBeenCalledTimes(1);
    expect(io.generate).toHaveBeenCalledWith(
      { apiKey: env.GEMINI_API_KEY, model, timeoutMs: 600_000 },
      expect.objectContaining({ url }),
    );
    expect(
      await sql("SELECT body_markdown FROM reports").first("body_markdown"),
    ).toBe(result.markdown);
    expect(
      (await sql("SELECT user_id,can_comment FROM report_permissions").all())
        .results,
    ).toEqual([{ user_id: "a", can_comment: 0 }]);
    expect((await sql("SELECT id FROM deliveries").all()).results).toEqual([]);
  });

  test("scheduled 핸들러가 실제 메타데이터·Gemini SDK를 거쳐 응답 fixture를 D1 보고서로 저장해요", async () => {
    now = Math.floor(Date.now() / 1_000);
    const request = await enqueue();
    const markdown =
      "## 원본 보고서\n원본 장면 (00:03)을 확인하는 fixture예요.\n".repeat(10);
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const address = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (address.hostname === "www.youtube.com")
          return Response.json({
            title: result.title,
            author_name: result.channel,
          });
        if (address.hostname === "generativelanguage.googleapis.com")
          return Response.json({
            id: "fixture-scheduled",
            model,
            status: "completed",
            steps: [
              {
                type: "model_output",
                content: [{ type: "text", text: markdown }],
              },
            ],
            usage: {
              total_input_tokens: 120,
              total_output_tokens: 90,
              total_tokens: 210,
            },
          });
        throw new Error("허용하지 않은 fixture 네트워크 요청이에요.");
      });
    await worker.scheduled(
      createScheduledController({ cron: "* * * * *" }),
      env,
    );
    expect(await readRequest(request.id)).toMatchObject({
      status: "completed",
      attempt: 1,
    });
    expect(network).toHaveBeenCalledTimes(2);
    expect(
      await sql("SELECT body_markdown FROM reports").first("body_markdown"),
    ).toContain(`[00:03](${url}&t=3s)`);
    expect(
      await sql("SELECT provider_interaction_id FROM analysis_attempts").first(
        "provider_interaction_id",
      ),
    ).toBe("fixture-scheduled");
    expect(
      await sql("SELECT timestamp_verification FROM reports").first(
        "timestamp_verification",
      ),
    ).toBe("unverified");
  });

  test("공급자 성공 후 D1 장애는 실패로 덮어쓰지 않고 만료 뒤 결과 불명으로 보존해요", async () => {
    const request = await enqueue();
    let unavailable = false;
    io.generate = vi.fn(async () => {
      unavailable = true;
      return result;
    });
    const unavailableDb = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return (statements: D1PreparedStatement[]) => {
            if (unavailable) throw new Error("fixture-d1-quota-exhausted");
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(
      runBackgroundJobs({ ...env, DB: unavailableDb }, io),
    ).rejects.toThrow("영속 작업 실행");
    expect(await readRequest(request.id)).toMatchObject({
      status: "running",
      failureCode: null,
      reportId: null,
    });
    now += ANALYSIS_LEASE_SECONDS;
    await run();
    expect(await readRequest(request.id)).toMatchObject({
      status: "failed",
      failureCode: "provider_outcome_unknown",
      retryable: false,
    });
    expect(io.generate).toHaveBeenCalledTimes(1);
  });

  test("실행 중 합류한 다른 계정도 같은 결과를 받고 생성 호출은 늘지 않아요", async () => {
    const a = await enqueue();
    let joined: Awaited<ReturnType<typeof enqueue>> | undefined;
    io.generate = vi.fn(async () => {
      joined = await enqueue("b");
      return result;
    });
    await run();
    if (!joined) throw new Error("합류한 요청이 없어요.");
    const done = await readRequest(a.id);
    expect(await readRequest(joined.id, "b")).toMatchObject({
      status: "completed",
      reportId: done.reportId,
    });
    expect(io.generate).toHaveBeenCalledTimes(1);
  });

  test("반복 접수와 여러 계정은 공통 작업·본문 한 개를 사용하고 개인 요청은 분리해요", async () => {
    const requests = await Promise.all([
      enqueue(),
      enqueue(),
      enqueue("b", `https://youtu.be/${videoId}?t=10`),
    ]);
    expect(requests[0]?.id).toBe(requests[1]?.id);
    expect(requests[0]?.id).not.toBe(requests[2]?.id);
    expect(new Set(requests.map((request) => request.analysisJobId)).size).toBe(
      1,
    );
    await run();
    const [a, b] = await Promise.all([
      readRequest(requests[0].id),
      readRequest(requests[2].id, "b"),
    ]);
    expect(a.reportId).toBe(b.reportId);
    expect(io.generate).toHaveBeenCalledTimes(1);
    expect((await sql("SELECT id FROM reports").all()).results).toHaveLength(1);
    expect(
      (await sql("SELECT id FROM report_permissions").all()).results,
    ).toHaveLength(2);
    const reuse = await enqueue("c");
    expect(reuse).toMatchObject({
      status: "completed",
      reportId: a.reportId,
      attempt: 1,
    });
    await run();
    expect(io.generate).toHaveBeenCalledTimes(1);
  });

  test("완료된 본문 재사용의 접수 응답이 유실돼도 개인 권한과 완료 상태가 남아요", async () => {
    await enqueue();
    await run();
    const lostReply = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch")
          return async (statements: D1PreparedStatement[]) => {
            await target.batch(statements);
            throw new Error("fixture-commit-reply-lost");
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(
      enqueueAnalysis(lostReply, { userId: "b", url, model }, now),
    ).rejects.toThrow("fixture-commit-reply-lost");
    const id = await sql(
      "SELECT id FROM summary_requests WHERE user_id='b'",
    ).first<string>("id");
    expect(await readRequest(id ?? "missing", "b")).toMatchObject({
      status: "completed",
      reportId: expect.any(String),
    });
    expect(io.generate).toHaveBeenCalledTimes(1);
  });

  test("동시에 전달된 실행 중 하나만 실행권과 시도 하나를 얻어요", async () => {
    const request = await enqueue();
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => claimAnalysis(env.DB, now)),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await readRequest(request.id)).toMatchObject({
      status: "running",
      attempt: 1,
    });
    const job2 = await enqueue("b", "https://youtu.be/2lv5xHjLx1c");
    expect(await claimAnalysis(env.DB, now)).toBeNull();
    expect(await readRequest(job2.id, "b")).toMatchObject({
      status: "queued",
      attempt: 0,
    });
  });

  test("외부 호출 전 중단은 같은 시도를 이어받고 오래된 실행자의 호출·저장을 막아요", async () => {
    const request = await enqueue();
    const oldClaim = requiredClaim(await claimAnalysis(env.DB, now));
    now += ANALYSIS_LEASE_SECONDS;
    await recoverAnalysis(env.DB, now);
    const resumed = requiredClaim(await claimAnalysis(env.DB, now));
    expect(resumed.attemptId).toBe(oldClaim.attemptId);
    expect(resumed.token).not.toBe(oldClaim.token);
    expect(await markAnalysisDispatched(env.DB, oldClaim, now)).toBe(false);
    expect(await completeAnalysis(env.DB, oldClaim, result, now)).toBe(false);
    expect(await markAnalysisDispatched(env.DB, resumed, now)).toBe(true);
    expect(await completeAnalysis(env.DB, resumed, result, now)).toBe(true);
    expect(await readRequest(request.id)).toMatchObject({
      status: "completed",
      attempt: 1,
    });
  });

  test("외부 호출 후 중단은 결과 불명으로 남기고 새 접수·재시도로 우회하지 못해요", async () => {
    const request = await enqueue();
    const claim = requiredClaim(await claimAnalysis(env.DB, now));
    await markAnalysisDispatched(env.DB, claim, now);
    now += ANALYSIS_LEASE_SECONDS;
    await run();
    expect(await readRequest(request.id)).toMatchObject({
      status: "failed",
      failureCode: "provider_outcome_unknown",
      retryable: false,
      attempt: 1,
    });
    expect(await enqueue()).toMatchObject({ id: request.id, status: "failed" });
    await expect(
      retryAnalysis(env.DB, "a", request.id, 1, now),
    ).rejects.toMatchObject({ code: "RETRY_NOT_ALLOWED" });
    expect(await completeAnalysis(env.DB, claim, result, now)).toBe(false);
    expect(io.generate).not.toHaveBeenCalled();
    expect(
      (await sql("SELECT status FROM analysis_attempts").all()).results,
    ).toEqual([{ status: "ambiguous" }]);
  });

  test("호출 직전 실행권을 연장하고 아직 회수되지 않은 늦은 성공 결과를 보존해요", async () => {
    const request = await enqueue();
    const claim = requiredClaim(await claimAnalysis(env.DB, now));
    now += 100;
    await markAnalysisDispatched(env.DB, claim, now);
    now = start + ANALYSIS_LEASE_SECONDS;
    await recoverAnalysis(env.DB, now);
    expect(await readRequest(request.id)).toMatchObject({ status: "running" });
    now += 101;
    expect(await completeAnalysis(env.DB, claim, result, now)).toBe(true);
    await recoverAnalysis(env.DB, now);
    expect(await readRequest(request.id)).toMatchObject({
      status: "completed",
      attempt: 1,
    });
  });

  test("본문 저장 중 제약 실패는 전체를 되돌리고 같은 결과만 다시 저장할 수 있어요", async () => {
    const request = await enqueue();
    const claim = requiredClaim(await claimAnalysis(env.DB, now));
    await markAnalysisDispatched(env.DB, claim, now);
    await expect(
      completeAnalysis(env.DB, claim, { ...result, markdown: " " }, now),
    ).rejects.toThrow();
    expect(await readRequest(request.id)).toMatchObject({
      status: "running",
      attempt: 1,
      reportId: null,
    });
    expect(
      await sql("SELECT status FROM analysis_attempts").first("status"),
    ).toBe("running");
    await completeAnalysis(env.DB, claim, result, now);
    await run();
    expect(io.generate).not.toHaveBeenCalled();
    expect((await sql("SELECT id FROM reports").all()).results).toHaveLength(1);
  });

  test("성공 저장 직후 응답 유실과 반복 전달은 본문·권한·시도를 늘리지 않아요", async () => {
    const request = await enqueue();
    const claim = requiredClaim(await claimAnalysis(env.DB, now));
    await markAnalysisDispatched(env.DB, claim, now);
    await completeAnalysis(env.DB, claim, result, now);
    expect(await completeAnalysis(env.DB, claim, result, now)).toBe(false);
    now += ANALYSIS_LEASE_SECONDS;
    await run();
    expect(await readRequest(request.id)).toMatchObject({
      status: "completed",
      attempt: 1,
    });
    expect(io.generate).not.toHaveBeenCalled();
    expect((await sql("SELECT id FROM reports").all()).results).toHaveLength(1);
    expect(
      (await sql("SELECT id FROM report_permissions").all()).results,
    ).toHaveLength(1);
  });

  test("GET은 권한을 다시 만들지 않고 타인의 요청·재시도를 숨겨요", async () => {
    const request = await enqueue();
    await run();
    await sql("DELETE FROM report_permissions WHERE user_id='a'").run();
    expect(await readRequest(request.id)).toMatchObject({
      status: "completed",
      reportId: null,
    });
    expect(
      (await sql("SELECT id FROM report_permissions").all()).results,
    ).toHaveLength(0);
    await expect(readRequest(request.id, "b")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      retryAnalysis(env.DB, "b", request.id, 1, now),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await enqueue()).toMatchObject({
      id: request.id,
      reportId: expect.any(String),
    });
  });

  test("이전 시도 번호의 재전송은 다음 실패를 다시 실행하지 않고 총 세 시도에서 멈춰요", async () => {
    io.metadata = vi.fn(async () => {
      throw new SummaryError("metadata_unavailable", 503);
    });
    const request = await enqueue();
    await run();
    expect(await readRequest(request.id)).toMatchObject({
      status: "failed",
      retryable: true,
      attempt: 1,
    });
    await Promise.all([
      retryAnalysis(env.DB, "a", request.id, 1, now),
      retryAnalysis(env.DB, "a", request.id, 1, now),
    ]);
    await run();
    expect(await retryAnalysis(env.DB, "a", request.id, 1, now)).toMatchObject({
      status: "failed",
      attempt: 2,
    });
    await run();
    expect(io.metadata).toHaveBeenCalledTimes(2);
    await retryAnalysis(env.DB, "a", request.id, 2, now);
    await run();
    expect(await readRequest(request.id)).toMatchObject({
      status: "failed",
      attempt: 3,
      retryable: false,
    });
    await expect(
      retryAnalysis(env.DB, "a", request.id, 3, now),
    ).rejects.toMatchObject({ code: "RETRY_NOT_ALLOWED" });
    expect(io.generate).not.toHaveBeenCalled();
    expect(
      (await sql("SELECT status FROM analysis_attempts").all()).results,
    ).toEqual([
      { status: "failed" },
      { status: "failed" },
      { status: "failed" },
    ]);
  });

  test.each([
    { name: "모델 누락", config: {}, key: null },
    { name: "모델 타입", config: { model: 42 }, key: null },
    { name: "지원하지 않는 모델", config: { model: "unsupported" }, key: null },
    {
      name: "프롬프트 버전",
      config: { ...generationProfile(model), promptVersion: "old" },
      key: null,
    },
    {
      name: "호출 제한 시간",
      config: { ...generationProfile(model), timeoutMs: 1_000 },
      key: null,
    },
    {
      name: "추가 옵션",
      config: { ...generationProfile(model), extra: true },
      key: null,
    },
    { name: "생성 키", config: generationProfile(model), key: "different-key" },
  ])(
    "저장된 설정의 $name 불일치는 공급자 호출 전에 거부해요",
    async ({ config, key }) => {
      const configJson = JSON.stringify(config);
      await env.DB.batch([
        sql("INSERT INTO videos (id) VALUES (?)", videoId),
        sql(
          "INSERT INTO analysis_jobs (id, video_id, generation_key, generation_config_json) VALUES ('invalid-job', ?, ?, ?)",
          videoId,
          key ?? (await generationKey(configJson)),
          configJson,
        ),
        sql(
          "INSERT INTO summary_requests (id, user_id, analysis_job_id, origin) VALUES ('invalid-request', 'a', 'invalid-job', 'direct')",
        ),
      ]);
      await run();
      expect(await readRequest("invalid-request")).toMatchObject({
        status: "failed",
        failureCode: "configuration",
        retryable: false,
        attempt: 1,
      });
      expect(io.metadata).not.toHaveBeenCalled();
      expect(io.generate).not.toHaveBeenCalled();
      expect(
        await sql("SELECT dispatched_at FROM analysis_attempts").first(
          "dispatched_at",
        ),
      ).toBeNull();
    },
  );

  test.each([
    ["quota", "quota"],
    ["configuration", "configuration"],
    ["provider_rejected", "provider_rejected"],
    ["invalid_response", "invalid_response"],
    ["timeout", "provider_outcome_unknown"],
    ["unknown", "provider_outcome_unknown"],
    ["temporary", "provider_outcome_unknown"],
  ] as const)(
    "공급자 %s는 자동 재분석하거나 사용자 재시도를 허용하지 않아요",
    async (reason, failureCode) => {
      io.generate = vi.fn(async () => {
        throw new SummaryError(reason, null, result.usage);
      });
      const request = await enqueue();
      await run();
      now += 3_600;
      await run();
      expect(io.generate).toHaveBeenCalledTimes(1);
      expect(await readRequest(request.id)).toMatchObject({
        status: "failed",
        retryable: false,
        attempt: 1,
        failureCode,
      });
      expect(
        await sql("SELECT usage_json FROM analysis_attempts").first(
          "usage_json",
        ),
      ).toBe(JSON.stringify(result.usage));
    },
  );

  test.each([new Error("fixture-unexpected-error"), null])(
    "예상하지 못한 공급자 오류 %s도 결과 불명으로 보존해요",
    async (error) => {
      io.generate = vi.fn(async () => {
        throw error;
      });
      const request = await enqueue();
      await run();
      now += 3_600;
      await run();
      expect(await readRequest(request.id)).toMatchObject({
        status: "failed",
        failureCode: "provider_outcome_unknown",
        retryable: false,
        attempt: 1,
      });
      expect(io.generate).toHaveBeenCalledTimes(1);
      expect(
        await sql("SELECT usage_json FROM analysis_attempts").first(
          "usage_json",
        ),
      ).toBeNull();
    },
  );

  test("명시적인 재시도 가능 실패도 사용자 요청 전에는 다시 호출하지 않아요", async () => {
    const request = await enqueue();
    const claim = requiredClaim(await claimAnalysis(env.DB, now));
    await failAnalysis(env.DB, claim, "temporary", now);
    await run();
    expect(io.generate).not.toHaveBeenCalled();
    await retryAnalysis(env.DB, "a", request.id, 1, now);
    await run();
    expect(await readRequest(request.id)).toMatchObject({
      status: "completed",
      attempt: 2,
    });
  });

  test("멈춘 자동 요청은 실행하지 않고 같은 영상의 다른 직접 요청은 완료해요", async () => {
    const automatic = await automaticRequest();
    await sql("UPDATE channel_subscriptions SET status='paused'").run();
    await run();
    expect(io.generate).not.toHaveBeenCalled();
    const direct = await enqueue("b");
    await run();
    expect(await readRequest(automatic.id)).toMatchObject({
      status: "failed",
      failureCode: "channel_inactive",
      reportId: null,
    });
    expect(await readRequest(direct.id, "b")).toMatchObject({
      status: "completed",
      reportId: expect.any(String),
    });
  });
});

describe("같은 D1 실행 기반의 메일 작업", () => {
  test("자동 요청에만 발송을 접수하고 보고서 재생성 없이 한 번 전송해요", async () => {
    const delivery = await queuedDelivery();
    const requestId = await sql(
      "SELECT request_id FROM deliveries",
    ).first<string>("request_id");
    expect(
      await enqueueDelivery(
        env.DB,
        "a",
        requestId ?? "missing",
        "recipient",
        now,
      ),
    ).toMatchObject({ id: delivery.id });
    await run();
    now += 3_600;
    await run();
    expect(await getDelivery(env.DB, "a", delivery.id)).toMatchObject({
      status: "sent",
      attempt: 1,
      retryable: false,
    });
    expect(io.generate).toHaveBeenCalledTimes(1);
    expect(io.send).toHaveBeenCalledTimes(1);
    expect(io.send).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        deliveryId: delivery.id,
        html: expect.stringContaining("&lt;script&gt;"),
        to: "receiver@example.com",
      }),
    );
  });

  test("동시 전달은 메일 실행권 하나만 만들어요", async () => {
    await queuedDelivery();
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => claimDelivery(env.DB, now)),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(
      (await sql("SELECT id FROM delivery_attempts").all()).results,
    ).toHaveLength(1);
  });

  test("호출 전 중단한 메일은 같은 시도로 재개하고 이전 실행자가 전송하지 못해요", async () => {
    const delivery = await queuedDelivery();
    const oldClaim = requiredClaim(await claimDelivery(env.DB, now));
    now += DELIVERY_LEASE_SECONDS;
    await recoverDeliveries(env.DB, now);
    const resumed = requiredClaim(await claimDelivery(env.DB, now));
    expect(resumed.attemptId).toBe(oldClaim.attemptId);
    expect(await markDeliveryDispatched(env.DB, oldClaim, now)).toBe(false);
    expect(await markDeliveryDispatched(env.DB, resumed, now)).toBe(true);
    expect(await completeDelivery(env.DB, oldClaim, now)).toBe(false);
    expect(await completeDelivery(env.DB, resumed, now)).toBe(true);
    expect(await getDelivery(env.DB, "a", delivery.id)).toMatchObject({
      status: "sent",
      attempt: 1,
    });
  });

  test("명확한 SMTP 일시 거부만 1분·5분 뒤 총 세 번까지 재시도해요", async () => {
    const delivery = await queuedDelivery();
    io.send = vi.fn(async () => {
      throw new EmailError("temporary", 451);
    });
    await run();
    now += 59;
    await retryDelivery(env.DB, "a", delivery.id, 1);
    await run();
    expect(io.send).toHaveBeenCalledTimes(1);
    now += 1;
    await run();
    expect(io.send).toHaveBeenCalledTimes(2);
    expect(await retryDelivery(env.DB, "a", delivery.id, 1)).toMatchObject({
      status: "failed",
      attempt: 2,
    });
    now += 299;
    await run();
    expect(io.send).toHaveBeenCalledTimes(2);
    now += 1;
    await run();
    expect(await getDelivery(env.DB, "a", delivery.id)).toMatchObject({
      status: "failed",
      attempt: 3,
      retryable: false,
    });
    now += 3_600;
    await run();
    expect(io.send).toHaveBeenCalledTimes(3);
    expect(io.generate).toHaveBeenCalledTimes(1);
    await expect(
      retryDelivery(env.DB, "a", delivery.id, 3),
    ).rejects.toMatchObject({ code: "RETRY_NOT_ALLOWED" });
  });

  test.each([
    "configuration",
    "invalid_input",
    "permanent",
    "quota",
    "ambiguous",
  ] as const)("SMTP %s는 발송을 자동 반복하지 않아요", async (reason) => {
    const delivery = await queuedDelivery();
    io.send = vi.fn(async () => {
      throw new EmailError(reason);
    });
    await run();
    now += 3_600;
    await run();
    expect(io.send).toHaveBeenCalledTimes(1);
    expect(await getDelivery(env.DB, "a", delivery.id)).toMatchObject({
      failureCode: reason,
      retryable: false,
      attempt: 1,
    });
    await expect(
      retryDelivery(env.DB, "a", delivery.id, 1),
    ).rejects.toMatchObject({ code: "RETRY_NOT_ALLOWED" });
  });

  test("SMTP 호출 후 중단은 ambiguous로 보존하고 성공을 추정하거나 재발송하지 않아요", async () => {
    const delivery = await queuedDelivery();
    const claim = requiredClaim(await claimDelivery(env.DB, now));
    await markDeliveryDispatched(env.DB, claim, now);
    now += DELIVERY_LEASE_SECONDS;
    await run();
    expect(await getDelivery(env.DB, "a", delivery.id)).toMatchObject({
      status: "ambiguous",
      failureCode: "ambiguous",
      retryable: false,
    });
    expect(await completeDelivery(env.DB, claim, now)).toBe(false);
    expect(io.send).not.toHaveBeenCalled();
  });

  test("회수 전에 도착한 늦은 SMTP 접수 성공은 버리지 않고 다음 실행에서도 보존해요", async () => {
    const delivery = await queuedDelivery();
    const claim = requiredClaim(await claimDelivery(env.DB, now));
    await markDeliveryDispatched(env.DB, claim, now);
    now += DELIVERY_LEASE_SECONDS;
    expect(await completeDelivery(env.DB, claim, now)).toBe(true);
    await recoverDeliveries(env.DB, now);
    expect(await getDelivery(env.DB, "a", delivery.id)).toMatchObject({
      status: "sent",
      attempt: 1,
    });
  });

  test.each(["channel", "recipient", "permission"])(
    "실행권 확보 후 %s 설정이 바뀌면 SMTP 직전에 다시 확인해 취소해요",
    async (change) => {
      const delivery = await queuedDelivery();
      const claim = requiredClaim(await claimDelivery(env.DB, now));
      if (change === "channel")
        await sql("UPDATE channel_subscriptions SET status='paused'").run();
      else if (change === "recipient")
        await sql("UPDATE recipients SET deleted_at=?", now).run();
      else await sql("DELETE FROM report_permissions").run();
      expect(await markDeliveryDispatched(env.DB, claim, now)).toBe(false);
      await cancelUndispatchedDelivery(env.DB, claim, now);
      expect(await getDelivery(env.DB, "a", delivery.id)).toMatchObject({
        status: "cancelled",
        attempt: 1,
        retryable: false,
      });
      expect(
        await sql("SELECT dispatched_at FROM delivery_attempts").first(
          "dispatched_at",
        ),
      ).toBeNull();
      await run();
      expect(io.send).not.toHaveBeenCalled();
    },
  );

  test("구조화 로그는 작업 식별자·상태만 남기고 주소·본문·키를 출력하지 않아요", async () => {
    const logs = vi.spyOn(console, "info").mockImplementation(() => {});
    await queuedDelivery();
    await run();
    const output = logs.mock.calls.flat().join("\n");
    expect(output).toContain('"event":"job.completed"');
    for (const secret of [
      "receiver@example.com",
      result.markdown,
      env.GEMINI_API_KEY,
      env.SMTP_APP_PASSWORD,
    ])
      expect(output).not.toContain(secret);
    for (const [line] of logs.mock.calls)
      expect(JSON.parse(String(line))).toMatchObject({
        kind: expect.any(String),
        jobId: expect.any(String),
        attempt: expect.any(Number),
      });
  });
});
