import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  generateReport,
  getVideoMetadata,
  parseYouTubeUrl,
  SummaryError,
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
const markdown = `## 3줄 요약\n1. 영상의 관찰을 정리해요.\n2. 원본을 확인해요.\n3. 추측을 구분해요.\n\n## 본론\n장면 (00:03)을 설명해요.\n\n## 핵심 정리\n영상에 나온 내용이에요.\n\n## 한번 생각해보기\n무엇을 관찰할 수 있나요?`;
const network = vi.fn<typeof fetch>();

beforeEach(() => {
  network.mockReset();
  vi.spyOn(globalThis, "fetch").mockImplementation(network);
});
afterEach(() => vi.restoreAllMocks());

function completion(overrides = {}) {
  return Response.json({
    responseId: "fixture-response",
    modelVersion: settings.model,
    candidates: [
      {
        content: { role: "model", parts: [{ text: markdown }] },
        finishReason: "STOP",
      },
    ],
    usageMetadata: {
      promptTokenCount: 120,
      candidatesTokenCount: 90,
      totalTokenCount: 230,
    },
    ...overrides,
  });
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
    network.mockResolvedValue(completion({ modelVersion: env.GEMINI_MODEL }));
    await generateReport(
      { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL },
      video,
    );
    const call = network.mock.calls[0];
    if (!call) throw new Error("SDK 요청을 확인하지 못했어요.");
    const request = new Request(...call);
    expect(request.headers.get("x-goog-api-key")).toBe("fixture-binding-key");
    expect(new URL(request.url).pathname).toBe(
      "/v1beta/models/gemini-3.5-flash-lite:generateContent",
    );
    expect(network).toHaveBeenCalledTimes(1);
  });

  test("실제 영상에 성공한 generateContent 경로로 한 번 요청하고 사용량을 남겨요", async () => {
    network.mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname.endsWith("/interactions"))
        return Response.json(
          { error: { code: "too_many_requests", message: "fixture limit" } },
          { status: 429, headers: { "retry-after": "30" } },
        );
      return completion();
    });
    const result = await generateReport(settings, video);
    expect(network).toHaveBeenCalledTimes(1);
    const call = network.mock.calls[0];
    if (!call) throw new Error("SDK 요청을 확인하지 못했어요.");
    const request = new Request(...call);
    const body = await request.json();
    expect(new URL(request.url).origin).toBe(
      "https://generativelanguage.googleapis.com",
    );
    expect(new URL(request.url).pathname).toBe(
      `/v1beta/models/${settings.model}:generateContent`,
    );
    expect(body).toMatchObject({
      store: false,
      contents: [
        {
          role: "user",
          parts: [
            { fileData: { fileUri: url, mimeType: "video/mp4" } },
            { text: expect.any(String) },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: 4_096 },
    });
    expect(result).toMatchObject({
      model: settings.model,
      responseId: "fixture-response",
      markdown,
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
    expect(result.markdown).toContain("(00:03)");
    expect(result.markdown).not.toContain("&t=");
  });

  test("공급자가 사용량을 주지 않으면 0으로 만들지 않아요", async () => {
    network.mockResolvedValue(
      completion({
        usageMetadata: undefined,
        modelVersion: undefined,
        responseId: undefined,
      }),
    );
    const result = await generateReport(settings, video);
    expect(result.model).toBeNull();
    expect(result.responseId).toBeNull();
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
    const error = await generateReport(settings, video).catch(
      (error: unknown) => error,
    );
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
    expect(network).toHaveBeenCalledTimes(1);
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
      const error = await generateReport(settings, video).catch(
        (error: unknown) => error,
      );
      expect(error).toMatchObject({
        reason: "quota",
        httpStatus: 429,
        quotaViolations: null,
      });
      expect(JSON.stringify(error)).not.toContain("private");
      expect(network).toHaveBeenCalledTimes(1);
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
    await expect(generateReport(settings, video)).rejects.toMatchObject({
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
    "HTTP %i는 %s로 기록하고 자동 재시도하거나 모델을 바꾸지 않아요",
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
      const error = await generateReport(settings, video).catch(
        (error: unknown) => error,
      );
      expect(error).toBeInstanceOf(SummaryError);
      expect(error).toMatchObject({ reason, httpStatus: status });
      expect(String(error)).not.toContain("private");
      expect(JSON.stringify(error)).not.toContain(settings.apiKey);
      expect(network).toHaveBeenCalledTimes(1);
    },
  );

  test.each(["MAX_TOKENS", "SAFETY", "CONTINUATION", undefined])(
    "종료 사유 %s는 완성된 리포트로 반환하지 않고 추가 요청 없이 사용량을 보존해요",
    async (finishReason) => {
      network.mockResolvedValue(
        completion({
          candidates: [
            {
              content: { role: "model", parts: [{ text: markdown }] },
              finishReason,
            },
          ],
        }),
      );
      await expect(generateReport(settings, video)).rejects.toMatchObject({
        reason: "invalid_response",
        usage: { inputTokens: 120 },
      });
      expect(network).toHaveBeenCalledTimes(1);
    },
  );

  test("빈 본문과 생각 블록만 있는 응답을 거부해요", async () => {
    network.mockResolvedValue(
      completion({
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "<think>private</think>" }],
            },
            finishReason: "STOP",
          },
        ],
      }),
    );
    await expect(generateReport(settings, video)).rejects.toMatchObject({
      reason: "invalid_response",
    });
  });

  test("SDK가 구분한 생각 내용은 본문에 포함하지 않아요", async () => {
    network.mockResolvedValue(
      completion({
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                { text: "private thought", thought: true },
                { text: markdown },
              ],
            },
            finishReason: "STOP",
          },
        ],
      }),
    );
    const result = await generateReport(settings, video);
    expect(result.markdown).toBe(markdown);
    expect(result.markdown).not.toContain("private");
  });

  test("키가 없으면 SDK와 네트워크를 호출하지 않아요", async () => {
    await expect(
      generateReport({ ...settings, apiKey: " " }, video),
    ).rejects.toMatchObject({ reason: "configuration" });
    expect(network).not.toHaveBeenCalled();
  });

  test("상태가 없는 오류는 일시 장애로 단정하거나 원문을 노출하지 않아요", async () => {
    network.mockRejectedValue(new TypeError("private provider or SDK details"));
    const error = await generateReport(settings, video).catch(
      (error: unknown) => error,
    );
    expect(error).toMatchObject({ reason: "unknown", httpStatus: null });
    expect(String(error)).not.toContain("private");
    expect(network).toHaveBeenCalledTimes(1);
  });
});
