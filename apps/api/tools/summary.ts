import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dependencies } from "../package.json";
import {
  generateReport,
  getVideoMetadata,
  parseYouTubeUrl,
  type SummaryConfig,
  SummaryError,
  summaryConfigSchema,
} from "../src/summary";

export async function runSummaryCommand(args: string[], directory: string) {
  const [rawUrl, runId] = args;
  if (
    args.length !== 2 ||
    !rawUrl ||
    !runId ||
    // 경로 이탈을 막도록 영문·숫자로 시작하는 1~64자의 영문·숫자·_·-만 허용해요.
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(runId)
  ) {
    throw new SummaryError("invalid_url");
  }
  const video = parseYouTubeUrl(rawUrl);
  const settings = summaryConfigSchema.safeParse(
    await Bun.file(resolve(directory, "credentials.json")).json(),
  );
  if (!settings.success) throw new SummaryError("configuration");
  const path = resolve(directory, `${runId}.json`);
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const base = {
    runId,
    startedAt,
    sdkVersion: dependencies["@google/genai"],
    requestedModel: settings.data.model,
    timeoutMs: settings.data.timeoutMs,
    api: "interactions",
    processing: "agentic",
    video,
    quota: null,
    cost: null,
  };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // 중단·동시 실행 때 같은 기록 ID로 재분석하지 않도록 외부 요청 전에 확보해요.
  await writePrivateJson(path, { ...base, state: "started" });
  const result = {
    ...base,
    ...(await analyzeVideo(settings.data, video)),
    elapsedMs: Math.round(performance.now() - start),
  };
  const temporary = `${path}.tmp`;
  await writePrivateJson(temporary, result);
  await rename(temporary, path);
  return {
    runId,
    state: result.state,
    output: path,
    elapsedMs: result.elapsedMs,
  };
}

async function analyzeVideo(
  config: SummaryConfig,
  video: ReturnType<typeof parseYouTubeUrl>,
) {
  let metadata: Awaited<ReturnType<typeof getVideoMetadata>> | undefined;
  try {
    metadata = await getVideoMetadata(video.url);
    const report = await generateReport(config, metadata);
    return { state: "generated" as const, video: metadata, report };
  } catch (error) {
    const failure =
      error instanceof SummaryError ? error : new SummaryError("unknown");
    return {
      state: "failed" as const,
      video: metadata ?? video,
      failure: {
        reason: failure.reason,
        httpStatus: failure.httpStatus,
        usage: failure.usage,
        quotaViolations: failure.quotaViolations,
      },
    };
  }
}

function writePrivateJson(path: string, value: object) {
  return writeFile(path, JSON.stringify(value, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
}

if (import.meta.main) {
  try {
    const result = await runSummaryCommand(
      process.argv.slice(2),
      resolve(import.meta.dir, "../.artifacts/gemini"),
    );
    console.info(JSON.stringify(result));
    if (result.state !== "generated") process.exitCode = 1;
  } catch (error) {
    console.error(
      error instanceof SummaryError
        ? error.message
        : "검증을 중단했어요. 설정·입력과 기존 시도 기록을 확인해 주세요.",
    );
    process.exitCode = 1;
  }
}
