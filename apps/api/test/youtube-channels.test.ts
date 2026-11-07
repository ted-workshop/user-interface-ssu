import { env } from "cloudflare:workers";
import { afterEach, expect, test, vi } from "vitest";
import {
  ChannelInputError,
  ChannelLookupError,
  lookupChannel,
  parseChannelInput,
} from "../src/youtube-channels";

const id = `UC${"a".repeat(22)}`;
afterEach(() => vi.restoreAllMocks());

test.each([
  ["@fixture", "forHandle", "@fixture"],
  [" https://www.youtube.com/@fixture?si=share ", "forHandle", "@fixture"],
  ["https://youtube.com/@%ED%95%9C%EA%B8%80/", "forHandle", "@한글"],
  ["https://m.youtube.com/user/legacy", "forUsername", "legacy"],
  [`https://www.youtube.com/channel/${id}`, "id", id],
])("채널 입력 %s는 공식 필터 하나로 조회해요", async (input, filter, value) => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      Response.json({ items: [{ id, snippet: { title: "공식 제목" } }] }),
    );
  expect(await lookupChannel(env, parseChannelInput(input))).toEqual({
    youtubeChannelId: id,
    title: "공식 제목",
    url: `https://www.youtube.com/channel/${id}`,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0] ?? [];
  expect(String(url)).toContain(
    "https://www.googleapis.com/youtube/v3/channels?",
  );
  expect(new URL(String(url)).searchParams.get(filter)).toBe(value);
  expect(String(url)).not.toContain(env.YOUTUBE_API_KEY);
  expect(options?.headers).toEqual({ "x-goog-api-key": env.YOUTUBE_API_KEY });
  expect(options?.redirect).toBe("error");
  expect(options?.signal).toBeInstanceOf(AbortSignal);
});

test.each([
  "",
  "@",
  "@one @two",
  "https://youtube.com/c/custom",
  "https://youtu.be/jNQXAC9IVRw",
  "https://youtube.com/watch?v=jNQXAC9IVRw",
  "https://youtube.com/playlist?list=abc",
  "http://youtube.com/@fixture",
  "https://youtube.com.evil.example/@fixture",
  "https://youtube.com@evil.example/@fixture",
  "https://user@youtube.com/@fixture",
  "https://youtube.com:8443/@fixture",
  "https://youtube.com/@fixture/videos",
  "https://youtube.com/@%2Ffixture",
  "https://youtube.com/@%ZZ",
  "https://youtube.com/channel/UCfake",
  "https://youtube.com\\@evil.example/@fixture",
])("미지원·잘못된 입력 %s를 조회 전에 거부해요", (input) => {
  const fetch = vi.spyOn(globalThis, "fetch");
  expect(() => parseChannelInput(input)).toThrow(ChannelInputError);
  expect(fetch).not.toHaveBeenCalled();
});

test.each([{ items: [] }, {}])(
  "조회 결과에서 채널이 없으면 입력 오류예요: %j",
  async (body) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body));
    await expect(
      lookupChannel(env, parseChannelInput("@missing")),
    ).rejects.toThrow(ChannelInputError);
  },
);

test.each([403, 429, 500, 503])(
  "공급자 %s는 채널이 없다고 단정하지 않고 재시도 없이 실패해요",
  async (status) => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("비공개 공급자 원문", { status }));
    await expect(
      lookupChannel(env, parseChannelInput("@fixture")),
    ).rejects.toThrow(ChannelLookupError);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

test.each([
  { items: null },
  { items: [{}] },
  { items: [{ id, snippet: { title: " " } }] },
  { items: [{ id: `UC${"b".repeat(22)}`, snippet: { title: "다른 채널" } }] },
])("공급자의 잘못된 응답은 저장하지 않아요: %j", async (body) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body));
  await expect(lookupChannel(env, { name: "id", value: id })).rejects.toThrow(
    ChannelLookupError,
  );
});

test("키 누락은 호출 전에 실패하고 네트워크·시간 초과의 원문을 노출하지 않아요", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("비공개 공급자 오류"));
  await expect(
    lookupChannel({ ...env, YOUTUBE_API_KEY: "" }, { name: "id", value: id }),
  ).rejects.toThrow(ChannelLookupError);
  expect(fetch).not.toHaveBeenCalled();
  await expect(lookupChannel(env, { name: "id", value: id })).rejects.toThrow(
    ChannelLookupError,
  );
});
