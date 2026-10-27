import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  generateReport,
  getVideoMetadata,
  linkifyYoutubeTimestamps,
  parseYouTubeUrl,
  SummaryError,
  summaryConfigSchema,
} from "../src/summary";

const url = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const settings = {
  apiKey: "fixture-private-key",
  model: "gemini-3.6-flash",
  timeoutMs: 1_000,
};
const video = {
  videoId: "jNQXAC9IVRw",
  url,
  title: "테스트 영상",
  channel: "테스트 채널",
  metadataSource: "https://www.youtube.com/oembed",
};
const markdown = `## 3줄 요약
1. 영상에서 관찰한 장면과 발언을 정리해요.
2. 주장과 수치를 원본의 시점에서 찾아볼 수 있게 해요.
3. 외부 배경 지식과 영상의 내용을 구분해요.

## 서론
**주제**: 영상의 관찰을 정리하는 테스트예요.
**핵심 키워드**: 원본, 관찰, 시간 링크

## 본론
장면 (00:03)을 설명해요. 화자가 직접 말한 내용과 화면에서 확인한 내용을 함께 정리하고, 원본에서 다시 찾을 수 있게 시점을 남겨요.

## 결론
영상에 나온 주장과 관찰을 정리했어요. 링크가 있다는 이유만으로 그 시점의 정확성을 검증한 것은 아니에요.

## 한번 생각해보기
1. 무엇을 관찰할 수 있나요?
2. 원본의 어느 시점과 연결되나요?
3. 확인하지 못한 내용은 무엇인가요?`;
const network = vi.fn<typeof fetch>();

beforeEach(() => {
  network.mockReset();
  vi.spyOn(globalThis, "fetch").mockImplementation(network);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function interaction(overrides = {}) {
  return Response.json({
    id: "fixture-interaction",
    model: settings.model,
    status: "completed",
    steps: [
      { type: "model_output", content: [{ type: "text", text: markdown }] },
    ],
    usage: {
      total_input_tokens: 120,
      total_output_tokens: 90,
      total_tokens: 230,
    },
    ...overrides,
  });
}

async function failedReport() {
  vi.useFakeTimers();
  const pending = generateReport(
    { ...settings, timeoutMs: 60_000 },
    video,
  ).catch((error: unknown) => error);
  await vi.runAllTimersAsync();
  return pending;
}

describe("YouTube 영상 입력과 출처", () => {
  test.each([
    url,
    "https://youtu.be/jNQXAC9IVRw?t=3",
    "https://m.youtube.com/watch?v=jNQXAC9IVRw&list=playlist&t=3",
    "https://www.youtube.com/shorts/jNQXAC9IVRw",
    "https://www.youtube.com/live/jNQXAC9IVRw",
    ` \n${url}\t `,
  ])("주소 %s를 영상 전체의 같은 주소로 정규화해요", (input) => {
    expect(parseYouTubeUrl(input)).toEqual({ videoId: video.videoId, url });
  });

  test.each([
    "https://youtube.com.evil.test/watch?v=jNQXAC9IVRw",
    "https://youtube.com@evil.test/watch?v=jNQXAC9IVRw",
    "https://name:password@youtube.com/watch?v=jNQXAC9IVRw",
    "https://youtube.com:444/watch?v=jNQXAC9IVRw",
    "https://www.youtube.com/@channel",
    "https://www.youtube.com/playlist?list=playlist",
    "https://www.youtube.com/watch?v=short",
    "https:\n//youtu.be/jNQXAC9IVRw",
    "https://youtu.be/jNQXAC9IVRw/extra",
    "https://www.youtu.be/jNQXAC9IVRw",
    "https://www.youtube.com/embed/jNQXAC9IVRw",
    "https://www.youtube.com/other?v=jNQXAC9IVRw",
    "not-a-url",
    `${url}\n${url}`,
    "file:///etc/passwd",
  ])("잘못된 입력 %s는 네트워크 요청 전에 거부해요", async (input) => {
    await expect(getVideoMetadata(input)).rejects.toMatchObject({
      reason: "invalid_url",
    });
    expect(network).not.toHaveBeenCalled();
  });

  test("제목과 채널을 oEmbed에서 읽고 조회 출처를 남겨요", async () => {
    network.mockResolvedValue(
      Response.json({ title: video.title, author_name: video.channel }),
    );
    const result = await getVideoMetadata(url);
    expect(result).toMatchObject({
      videoId: video.videoId,
      url,
      title: video.title,
      channel: video.channel,
    });
    const source = new URL(result.metadataSource);
    expect(source.origin + source.pathname).toBe(
      "https://www.youtube.com/oembed",
    );
    expect(source.searchParams.get("url")).toBe(url);
    expect(network.mock.calls[0]?.[1]?.redirect).toBe("error");
  });

  test.each([404, 403, 500])(
    "메타데이터 HTTP %i는 영상 비공개나 삭제로 단정하지 않아요",
    async (status) => {
      network.mockResolvedValue(
        new Response("private upstream details", { status }),
      );
      await expect(getVideoMetadata(url)).rejects.toMatchObject({
        reason: "metadata_unavailable",
        httpStatus: status,
      });
    },
  );

  test("메타데이터 형식이 바뀌면 모델로 제목을 채우지 않아요", async () => {
    network.mockResolvedValue(Response.json({ title: "제목만 있어요" }));
    await expect(getVideoMetadata(url)).rejects.toMatchObject({
      reason: "metadata_unavailable",
    });
  });
});

describe("공식 SDK의 영상 리포트 생성", () => {
  test("Worker의 키 Secret과 모델 Variable을 SDK 요청에 전달해요", async () => {
    network.mockResolvedValue(interaction({ model: env.GEMINI_MODEL }));
    await generateReport(
      { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL },
      video,
    );
    const call = network.mock.calls[0];
    if (!call) throw new Error("SDK 요청을 확인하지 못했어요.");
    const request = new Request(...call);
    expect(request.headers.get("x-goog-api-key")).toBe("fixture-binding-key");
    expect(await request.json()).toMatchObject({
      model: "gemini-3.5-flash-lite",
    });
    expect(network).toHaveBeenCalledTimes(1);
  });

  test("지정 모델의 Agentic 요청에 출력 상한을 추가하지 않고 응답 사용량을 남겨요", async () => {
    network.mockResolvedValue(interaction());
    const result = await generateReport(settings, video);
    expect(network).toHaveBeenCalledTimes(1);
    const call = network.mock.calls[0];
    if (!call) throw new Error("SDK 요청을 확인하지 못했어요.");
    const request = new Request(...call);
    const body = await request.json();
    expect(new URL(request.url).origin).toBe(
      "https://generativelanguage.googleapis.com",
    );
    expect(body).toMatchObject({
      model: settings.model,
      store: false,
      input: [
        { type: "video", uri: url, processing: "agentic" },
        { type: "text" },
      ],
    });
    expect(body).not.toHaveProperty("generation_config");
    expect(result).toMatchObject({
      model: settings.model,
      interactionId: "fixture-interaction",
      timestampVerification: "unverified",
      usage: {
        inputTokens: 120,
        outputTokens: 90,
        totalTokens: 230,
        thoughtTokens: null,
        toolUseTokens: null,
        cachedTokens: null,
      },
    });
    expect(result.generationMs).toBeGreaterThanOrEqual(0);
    expect(result.markdown).toContain(`[00:03](${url}&t=3s)`);
  });

  test("공급자가 사용량을 주지 않으면 0으로 만들지 않아요", async () => {
    network.mockResolvedValue(
      interaction({ usage: undefined, model: undefined }),
    );
    const result = await generateReport(settings, video);
    expect(result.model).toBeNull();
    expect(Object.values(result.usage)).toEqual(Array(6).fill(null));
  });

  test("429의 할당량 항목만 남기고 프로젝트 정보와 공급자 원문은 버려요", async () => {
    network.mockResolvedValue(
      Response.json(
        {
          error: {
            code: 429,
            message: "private project and fixture-private-key",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                violations: [
                  {
                    quotaMetric:
                      "generativelanguage.googleapis.com/generate_content_free_tier_requests",
                    quotaId:
                      "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
                    quotaValue: "0",
                    quotaDimensions: {
                      project: "private-project",
                      model: settings.model,
                    },
                  },
                  {
                    quotaMetric: "generativelanguage.googleapis.com/tokens",
                    quotaId: "TokensPerMinute",
                  },
                ],
              },
            ],
          },
        },
        { status: 429 },
      ),
    );
    const error = await failedReport();
    expect(error).toMatchObject({
      reason: "quota",
      quotaViolations: [
        {
          quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
          quotaValue: "0",
        },
        { quotaId: "TokensPerMinute", quotaValue: null },
      ],
    });
    expect(JSON.stringify(error)).not.toContain("private");
    expect(network.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  test.each([
    null,
    [
      {
        violations: [
          { quotaMetric: "tokens", quotaId: "limit", quotaValue: 3 },
        ],
      },
    ],
    [{ violations: [{ quotaId: "limit", quotaValue: "3" }] }],
  ])(
    "할당량 정보 %j가 잘못돼도 429 분류는 보존하고 원문은 숨겨요",
    async (details) => {
      network.mockResolvedValue(
        Response.json(
          {
            error: { message: "fixture-private-key private account", details },
          },
          { status: 429 },
        ),
      );
      const error = await failedReport();
      expect(error).toMatchObject({
        reason: "quota",
        httpStatus: 429,
        quotaViolations: null,
      });
      expect(JSON.stringify(error)).not.toContain("private");
      expect(network.mock.calls.length).toBeGreaterThanOrEqual(1);
    },
  );

  test("응답 기한을 넘은 요청을 중단하고 다시 보내지 않아요", async () => {
    network.mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      return new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener(
          "abort",
          () => reject(request.signal.reason),
          { once: true },
        );
      });
    });
    vi.useFakeTimers();
    const pending = generateReport(settings, video).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(settings.timeoutMs);
    expect(await pending).toMatchObject({
      reason: "timeout",
    });
    expect(network).toHaveBeenCalledTimes(1);
  });

  test.each([
    [429, "quota"],
    [503, "temporary"],
    [400, "provider_rejected"],
    [404, "provider_rejected"],
    [403, "configuration"],
  ])(
    "HTTP %i는 SDK 재시도 뒤에도 실패하면 %s로 기록해요",
    async (status, reason) => {
      network.mockResolvedValue(
        Response.json(
          {
            error: {
              code: status,
              message: "fixture-private-key private account",
            },
          },
          { status: Number(status) },
        ),
      );
      const error = await failedReport();
      expect(error).toBeInstanceOf(SummaryError);
      expect(error).toMatchObject({ reason, httpStatus: status });
      expect(String(error)).not.toContain("private");
      expect(JSON.stringify(error)).not.toContain(settings.apiKey);
      expect(network.mock.calls.length).toBeGreaterThanOrEqual(1);
      for (const call of network.mock.calls) {
        expect(await new Request(...call).json()).toMatchObject({
          model: settings.model,
        });
      }
    },
  );

  test.each(["failed", "incomplete", "requires_action"])(
    "상태 %s는 완성된 리포트로 반환하지 않고 알려진 사용량은 보존해요",
    async (status) => {
      network.mockResolvedValue(interaction({ status }));
      await expect(generateReport(settings, video)).rejects.toMatchObject({
        reason: "invalid_response",
        usage: { inputTokens: 120 },
      });
    },
  );

  test("200자보다 짧은 응답은 거부해요", async () => {
    network.mockResolvedValue(
      interaction({
        steps: [
          {
            type: "model_output",
            content: [{ type: "text", text: "<think>private</think>" }],
          },
        ],
      }),
    );
    await expect(generateReport(settings, video)).rejects.toMatchObject({
      reason: "invalid_response",
    });
  });

  test.each(["think", "thinking"])(
    "%s 블록을 제거하고 리포트 본문을 남겨요",
    async (tag) => {
      network.mockResolvedValue(
        interaction({
          steps: [
            {
              type: "model_output",
              content: [
                {
                  type: "text",
                  text: `<${tag}>생각\n내용</${tag}>${markdown}`,
                },
              ],
            },
          ],
        }),
      );
      const result = await generateReport(settings, video);
      expect(result.markdown).toContain("## 3줄 요약");
      expect(result.markdown).not.toContain("생각\n내용");
      expect(result.markdown).not.toContain(`<${tag}>`);
    },
  );

  test("키가 없으면 SDK와 네트워크를 호출하지 않아요", async () => {
    await expect(
      generateReport({ ...settings, apiKey: " " }, video),
    ).rejects.toMatchObject({ reason: "configuration" });
    expect(network).not.toHaveBeenCalled();
  });

  test("상태가 없는 오류는 일시 장애로 단정하거나 원문을 노출하지 않아요", async () => {
    network.mockRejectedValue(new TypeError("private provider or SDK details"));
    const error = await failedReport();
    expect(error).toMatchObject({ reason: "unknown", httpStatus: null });
    expect(String(error)).not.toContain("private");
    expect(network.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe("리포트 생성 설정과 시간 링크", () => {
  test("모델의 지원 범위와 기본 응답 기한을 적용해요", () => {
    const config = summaryConfigSchema.parse({
      apiKey: settings.apiKey,
      model: settings.model,
    });
    expect(config.timeoutMs).toBe(600_000);
    expect(
      summaryConfigSchema.safeParse({ ...settings, model: "gemini-2.5-flash" })
        .success,
    ).toBe(false);
  });

  test.each([
    ["[03:42]", `[03:42](${url}&t=222s)`],
    ["(03:42)", `[03:42](${url}&t=222s)`],
    ["[1:02:03]", `[1:02:03](${url}&t=3723s)`],
    ["(00:60)", "(00:60)"],
    ["[99:99]", "[99:99]"],
    [`[03:42](${url}&t=222s)`, `[03:42](${url}&t=222s)`],
    ["```text\n(03:42)\n```", "```text\n(03:42)\n```"],
  ])(
    "시간 표기 %s를 링크로 바꾸고 기존 링크·코드블록은 보존해요",
    (input, expected) => {
      expect(linkifyYoutubeTimestamps(input, url)).toBe(expected);
    },
  );

  test("SDK의 기본 재시도로 일시 오류 뒤 같은 요청이 성공해요", async () => {
    vi.useFakeTimers();
    network
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: 503, message: "fixture failure" } },
          { status: 503 },
        ),
      )
      .mockResolvedValue(interaction());
    const pending = generateReport(
      { ...settings, timeoutMs: 60_000 },
      video,
    ).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({
      markdown: expect.stringContaining("## 본론"),
    });
    expect(network).toHaveBeenCalledTimes(2);
    const requests = await Promise.all(
      network.mock.calls.map((call) => new Request(...call).json()),
    );
    expect(requests[1]).toEqual(requests[0]);
  });

  test("완료된 본문은 제목 구조 대신 200자 기준으로 검사해요", async () => {
    const text = "가".repeat(200);
    network.mockResolvedValue(
      interaction({
        steps: [{ type: "model_output", content: [{ type: "text", text }] }],
      }),
    );
    expect((await generateReport(settings, video)).markdown).toBe(text.trim());
    network.mockResolvedValue(
      interaction({
        steps: [
          {
            type: "model_output",
            content: [{ type: "text", text: "가".repeat(199) }],
          },
        ],
      }),
    );
    await expect(generateReport(settings, video)).rejects.toMatchObject({
      reason: "invalid_response",
    });
  });
});
