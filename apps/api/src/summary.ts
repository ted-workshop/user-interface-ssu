import { GoogleGenAI, type Interactions } from "@google/genai";
import { z } from "zod";

const agenticVideoModels = new Set([
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
]);

export const summaryConfigSchema = z.object({
  apiKey: z.string().trim().min(1),
  model: z.string().refine((model) => agenticVideoModels.has(model)),
  timeoutMs: z.number().int().min(1_000).max(600_000).default(600_000),
});
export type SummaryConfig = z.input<typeof summaryConfigSchema>;
type Usage = ReturnType<typeof tokenUsage>;
type QuotaViolation = z.infer<typeof quotaViolationSchema>;
type FailureReason =
  | "invalid_url"
  | "configuration"
  | "metadata_unavailable"
  | "quota"
  | "temporary"
  | "unknown"
  | "timeout"
  | "provider_rejected"
  | "invalid_response";

export class SummaryError extends Error {
  constructor(
    readonly reason: FailureReason,
    readonly httpStatus: number | null = null,
    readonly usage: Usage | null = null,
    readonly quotaViolations: QuotaViolation[] | null = null,
  ) {
    super(`영상 요약을 완료하지 못했어요 (${reason}).`);
    this.name = "SummaryError";
  }
}

export function parseYouTubeUrl(raw: string) {
  const value = raw.trim();
  const input = URL.parse(value);
  // URL 파서가 중간 개행을 지우고 받아들이지 않도록 공백이 섞인 입력을 거부해요.
  if (!input || /\s/.test(value) || !youtubeUrlSchema.validate(input))
    throw new SummaryError("invalid_url");

  const videoId = extractVideoId(input);
  // 영상 ID는 영문·숫자·밑줄·하이픈으로 된 11자리만 허용해요.
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId))
    throw new SummaryError("invalid_url");
  return { videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
}

export async function getVideoMetadata(raw: string) {
  const video = parseYouTubeUrl(raw);
  const source = new URL("https://www.youtube.com/oembed");
  source.searchParams.set("url", video.url);
  source.searchParams.set("format", "json");
  let httpStatus: number | null = null;
  try {
    const response = await fetch(source, {
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    httpStatus = response.status;
    if (!response.ok)
      throw new SummaryError("metadata_unavailable", httpStatus);
    const metadata = metadataSchema.parse(await response.json());
    return {
      ...video,
      title: metadata.title,
      channel: metadata.author_name,
      metadataSource: source.toString(),
    };
  } catch {
    throw new SummaryError("metadata_unavailable", httpStatus);
  }
}

export async function generateReport(
  config: SummaryConfig,
  video: Awaited<ReturnType<typeof getVideoMetadata>>,
) {
  const parsed = summaryConfigSchema.safeParse(config);
  if (!parsed.success) throw new SummaryError("configuration");
  const settings = parsed.data;
  const { url } = parseYouTubeUrl(video.url);
  const ai = new GoogleGenAI({ apiKey: settings.apiKey });
  const start = performance.now();
  const userPrompt = `다음 유튜브 영상을 분석하여 지정된 형식의 한국어 리포트를 작성해 주세요.\n\n영상 제목: ${video.title}\n영상 URL: ${url}\n타임스탬프 링크는 반드시 이 URL을 사용하세요. 예: [03:42](${url}&t=222s)`;
  let response: Interactions.Interaction;
  try {
    response = await runWithTimeout(
      (signal) =>
        ai.interactions.create(
          {
            model: settings.model,
            input: [
              { type: "video", uri: url, processing: "agentic" },
              { type: "text", text: `${REPORT_PROMPT}\n\n${userPrompt}` },
            ],
            store: false,
          },
          { signal },
        ),
      settings.timeoutMs,
    );
  } catch (error) {
    if (error instanceof SummaryError) throw error;
    throw toSummaryError(error);
  }
  const usage = tokenUsage(response.usage);
  const text = response.output_text?.trim();
  if (response.status !== "completed" || !text || text.length < 200)
    throw new SummaryError("invalid_response", null, usage);
  return {
    markdown: linkifyYoutubeTimestamps(stripThinkingBlock(text), url),
    model: response.model ?? null,
    interactionId: response.id,
    generationMs: Math.round(performance.now() - start),
    usage,
    timestampVerification: "unverified" as const,
  };
}

/** 모델이 출력한 think·thinking 블록을 본문에서 제거해요. */
function stripThinkingBlock(text: string) {
  return text
    // 줄바꿈이 들어간 소문자 think·thinking 블록을 본문에서 제거해요.
    .replace(/<(?:think|thinking)>[\s\S]*?<\/(?:think|thinking)>/g, "")
    .trim();
}
// 분·초가 0~59인 MM:SS와 H:MM:SS 표기를 찾아요.
const TIMESTAMP_SRC = String.raw`(?:\d{1,2}:)?[0-5]?\d:[0-5]\d`;
/** 단독 시간 표기를 클릭 가능한 유튜브 링크로 바꿔요. */
export function linkifyYoutubeTimestamps(markdown: string, videoUrl: string) {
  return (
    markdown
      // 코드블록의 시간 표기는 변환하지 않도록 본문과 분리해요.
      .split(/(```[\s\S]*?```)/)
      .map((chunk) =>
        chunk.startsWith("```") ? chunk : linkifyPlain(chunk, videoUrl),
      )
      .join("")
  );
}
function linkifyPlain(text: string, videoUrl: string) {
  const replace = (match: string, stamp: string) => {
    const seconds = timestampToSeconds(stamp);
    if (seconds === null) return match;
    return `[${stamp}](${timestampHref(videoUrl, seconds)})`;
  };
  return (
    text
      // 이미 연결된 링크를 제외하고 단독 대괄호 시간 표기를 링크로 바꿔요.
      .replace(new RegExp(`\\[(${TIMESTAMP_SRC})\\](?!\\()`, "g"), replace)
      // 소괄호 안의 시간 표기도 같은 영상의 시간 링크로 바꿔요.
      .replace(new RegExp(`\\((${TIMESTAMP_SRC})\\)`, "g"), replace)
  );
}
function timestampToSeconds(stamp: string) {
  const parts = stamp.split(":").map(Number);
  if (parts.some((n) => !Number.isInteger(n))) return null;
  if (parts.length === 2) {
    const [minutes, seconds] = parts as [number, number];
    if (seconds > 59 || minutes < 0) return null;
    return minutes * 60 + seconds;
  }
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts as [number, number, number];
    if (seconds > 59 || minutes > 59 || hours < 0) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }
  return null;
}
function timestampHref(videoUrl: string, seconds: number) {
  const url = new URL(videoUrl);
  url.searchParams.set("t", `${seconds}s`);
  return url.toString();
}

async function runWithTimeout<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  const timeoutError = new SummaryError("timeout");
  const timeoutPromise = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => {
      reject(timeoutError);
    });
  });
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const work = factory(controller.signal).catch((err) => {
      if (controller.signal.aborted) {
        throw timeoutError;
      }
      throw err;
    });
    void work.catch(() => {});
    return await Promise.race([work, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

function extractVideoId(input: URL) {
  if (input.hostname === "youtu.be") return input.pathname.slice(1);
  if (input.pathname === "/watch") return input.searchParams.get("v") ?? "";
  // shorts·live 경로의 영상 ID를 추출하고 끝의 /도 허용해요.
  return input.pathname.match(/^\/(?:shorts|live)\/([^/]+)\/?$/)?.[1] ?? "";
}

function toSummaryError(error: unknown) {
  if (
    !error ||
    typeof error !== "object" ||
    !("status" in error) ||
    typeof error.status !== "number"
  )
    return new SummaryError("unknown");

  const status = error.status;
  let reason: FailureReason = "unknown";
  if (status === 401 || status === 403) reason = "configuration";
  else if (status === 429) reason = "quota";
  else if (status >= 500) reason = "temporary";
  else if (status < 500) reason = "provider_rejected";

  const quota = status === 429 ? quotaErrorSchema.safeParse(error) : null;
  const violations = quota?.success
    ? quota.data.error.error.details.flatMap(
        (detail) => detail.violations ?? [],
      )
    : [];
  return new SummaryError(
    reason,
    status,
    null,
    violations.length ? violations : null,
  );
}

function tokenUsage(usage: Interactions.Interaction["usage"]) {
  return {
    inputTokens: usage?.total_input_tokens ?? null,
    outputTokens: usage?.total_output_tokens ?? null,
    thoughtTokens: usage?.total_thought_tokens ?? null,
    toolUseTokens: usage?.total_tool_use_tokens ?? null,
    cachedTokens: usage?.total_cached_tokens ?? null,
    totalTokens: usage?.total_tokens ?? null,
  };
}

const youtubeUrlSchema = z.object({
  protocol: z.enum(["https:", "http:"]),
  hostname: z.enum([
    "youtu.be",
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
  ]),
  username: z.literal(""),
  password: z.literal(""),
  port: z.literal(""),
});

const metadataSchema = z.object({
  title: z.string().trim().min(1),
  author_name: z.string().trim().min(1),
});

const quotaViolationSchema = z.object({
  quotaMetric: z.string(),
  quotaId: z.string(),
  quotaValue: z
    .string()
    .optional()
    .transform((value) => value ?? null),
});
const quotaErrorSchema = z.object({
  error: z.object({
    error: z.object({
      details: z.array(
        z.object({ violations: z.array(quotaViolationSchema).optional() }),
      ),
    }),
  }),
});

const REPORT_PROMPT = `당신은 유튜브 영상을 깊이 있게 분석하여 한국어 블로그 리포트를 작성하는 전문 애널리스트입니다.

## 목적
독자가 글을 이해하고, 지식을 쉽게 습득하고, 읽고 나서 스스로 더 생각해볼 수 있도록 돕는 것입니다. 영상 링크가 제공되면 영상 내용을 완전히 분석하여 아래 형식의 블로그형 리포트를 작성하세요.

## 절대 규칙
- 모든 출력은 반드시 한국어로 작성합니다.
- 최소 1500자 이상, 논문 수준으로 상세하게 작성합니다.
- 영상 내용을 100% 담아내되, 원본에 충실하고 필요한 경우에만 보충 설명을 덧붙입니다.
- 전반적으로 긍정적이면서도 참을성 있고, 힘을 북돋아 주는 톤을 유지합니다.
- 독자가 끝까지 읽고 싶도록 흥미롭게 작성합니다.
- 본론의 각 소제목과 핵심 장면·인용·수치에는 영상에 실제로 등장하는 시점의 유튜브 타임스탬프를 클릭 가능한 마크다운 링크로 남깁니다. 형식: [MM:SS](영상URL&t=초s). 1시간 이상은 [H:MM:SS](...). 예: [03:42](https://www.youtube.com/watch?v=xxxx&t=222s). 추측하지 말고, 괄호만 있는 (03:42) 표기는 쓰지 마세요.

## 출력 형식 (마크다운)
아래 구조를 정확히 따라 마크다운만 출력하세요. 도입말이나 마무리 말 없이 리포트 본문만 출력합니다.

## 3줄 요약
1. ...
2. ...
3. ...

(가능한 한 영상에서 나온 표현을 그대로 활용하고, 독자가 호기심을 갖고 글을 끝까지 읽도록 작성)

---

## 서론
**주제**: ...
**핵심 키워드**: ... , ... , ...

(짧은 호흡으로, 이 글이 어떤 주제인지와 글쓴이가 설명·주장하려는 핵심 키워드를 소개)

---

## 본론
(영상이 제시하는 바를 논리적으로 설명. 영상의 흐름을 3~7개의 소제목으로 구조화하고, 각 소제목 바로 뒤에 그 구간이 시작되는 타임스탬프 링크를 붙인 뒤 상세히 서술. 핵심 발언·수치·장면에도 해당 시점 링크를 남김. 필요하면 보충 설명을 인용구나 덧붙임으로 추가)

---

## 결론
(글을 마무리하며 이 영상이 어떤 주제를 갖고 무엇을 말하고 싶었는지 최종 정리)

---

## 한번 생각해보기
(독자가 읽고 나서 스스로 더 생각해볼 수 있는 깊이 있는 질문 3~5개를 번호와 함께 제안)`;
