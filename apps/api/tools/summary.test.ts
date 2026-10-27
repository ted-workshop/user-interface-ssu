import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as summary from "../src/summary";
import { runSummaryCommand } from "./summary";

const url = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const settings = { apiKey: "fixture-private-key", model: "gemini-3.6-flash" };
const video = {
  videoId: "jNQXAC9IVRw",
  url,
  title: "테스트 영상",
  channel: "테스트 채널",
  metadataSource: "https://www.youtube.com/oembed",
};
const generated = {
  markdown: "## 3줄 요약\n테스트 결과예요.",
  model: settings.model,
  interactionId: "fixture-id",
  generationMs: 5,
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    thoughtTokens: null,
    toolUseTokens: null,
    cachedTokens: null,
    totalTokens: 30,
  },
  timestampVerification: "unverified" as const,
};
const metadata = mock(async () => video);
const generate = mock(async () => generated);
const directories: string[] = [];

beforeEach(() => {
  metadata.mockReset().mockResolvedValue(video);
  generate.mockReset().mockResolvedValue(generated);
  spyOn(summary, "getVideoMetadata").mockImplementation(metadata);
  spyOn(summary, "generateReport").mockImplementation(generate);
});
afterEach(async () => {
  mock.restore();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "qletter-summary-"));
  directories.push(directory);
  await writeFile(
    join(directory, "credentials.json"),
    JSON.stringify(settings),
    { mode: 0o600 },
  );
  return directory;
}

test("같은 기록 ID의 동시 명령은 한 번만 분석하고 비밀값 없이 결과를 보관해요", async () => {
  const directory = await setup();
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      runSummaryCommand([url, "sample"], directory),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(generate).toHaveBeenCalledTimes(1);
  const path = join(directory, "sample.json");
  const contents = await readFile(path, "utf8");
  expect(contents).not.toContain(settings.apiKey);
  expect(JSON.parse(contents)).toMatchObject({
    state: "generated",
    sdkVersion: "2.31.0",
    requestedModel: settings.model,
    video,
    report: generated,
    quota: null,
    cost: null,
  });
  expect((await stat(path)).mode & 0o777).toBe(0o600);
});

test("중단된 시도 기록이 있으면 자동으로 다시 분석하거나 덮어쓰지 않아요", async () => {
  const directory = await setup();
  const previous = JSON.stringify({ state: "started" });
  await writeFile(join(directory, "interrupted.json"), previous);
  await expect(
    runSummaryCommand([url, "interrupted"], directory),
  ).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(join(directory, "interrupted.json"), "utf8")).toBe(
    previous,
  );
  expect(metadata).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
});

test("공급자 실패는 원문과 키를 숨기고 실패 이유를 기록해요", async () => {
  const directory = await setup();
  generate.mockRejectedValue(new summary.SummaryError("quota", 429));
  const result = await runSummaryCommand([url, "quota"], directory);
  expect(result.state).toBe("failed");
  expect(
    JSON.parse(await readFile(join(directory, "quota.json"), "utf8")),
  ).toMatchObject({
    state: "failed",
    video,
    failure: { reason: "quota", httpStatus: 429, usage: null },
  });
  expect(generate).toHaveBeenCalledTimes(1);
});

test("빈 본문처럼 분석 뒤 거부한 응답의 알려진 사용량을 보존해요", async () => {
  const directory = await setup();
  generate.mockRejectedValue(
    new summary.SummaryError("invalid_response", null, generated.usage),
  );
  await runSummaryCommand([url, "invalid"], directory);
  expect(
    JSON.parse(await readFile(join(directory, "invalid.json"), "utf8")),
  ).toMatchObject({
    failure: { reason: "invalid_response", usage: generated.usage },
  });
});

test("잘못된 인자·경로·설정은 외부 요청과 시도 기록 전에 거부해요", async () => {
  const directory = await setup();
  for (const args of [
    [url],
    [url, "../escape"],
    ["bad-url", "invalid"],
    [url, "sample", "extra"],
  ]) {
    await expect(runSummaryCommand(args, directory)).rejects.toBeInstanceOf(
      summary.SummaryError,
    );
  }
  await writeFile(
    join(directory, "credentials.json"),
    JSON.stringify({ ...settings, apiKey: " " }),
  );
  await expect(
    runSummaryCommand([url, "invalid-settings"], directory),
  ).rejects.toMatchObject({ reason: "configuration" });
  expect(await readdir(directory)).toEqual(["credentials.json"]);
  expect(metadata).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
});

test("메타데이터 실패면 Gemini를 호출하지 않아요", async () => {
  const directory = await setup();
  metadata.mockRejectedValue(
    new summary.SummaryError("metadata_unavailable", 404),
  );
  await runSummaryCommand([url, "metadata"], directory);
  expect(generate).not.toHaveBeenCalled();
  expect(
    JSON.parse(await readFile(join(directory, "metadata.json"), "utf8")),
  ).toMatchObject({
    state: "failed",
    failure: { reason: "metadata_unavailable" },
  });
});
