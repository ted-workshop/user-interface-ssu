import { env } from "cloudflare:workers";
import { afterEach, expect, test, vi } from "vitest";
import {
  type ChannelFetchError,
  fetchChannelVideos,
} from "../src/youtube-videos";

const youtubeChannelId = `UC${"a".repeat(22)}`;
const uploads = `UU${"a".repeat(22)}`;
const item = (
  videoId: string,
  title = "영상",
  publishedAt = "2026-11-01T00:00:00Z",
) => ({ snippet: { title, publishedAt, resourceId: { videoId } } });

afterEach(() => vi.restoreAllMocks());

function provider(items: unknown[], onRequest?: (url: URL) => void) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    onRequest?.(url);
    if (url.pathname.endsWith("/channels"))
      return Response.json({
        items: [{ contentDetails: { relatedPlaylists: { uploads } } }],
      });
    return Response.json({ items });
  });
}

async function failure(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) => error as ChannelFetchError,
  );
}

test("업로드 재생목록에서 최근 영상을 읽고 중복 ID는 한 번만 반환해요", async () => {
  const requests: URL[] = [];
  const network = provider(
    [item("aaaaaaaaaaa", "첫 영상"), item("aaaaaaaaaaa"), item("bbbbbbbbbbb")],
    (url) => requests.push(url),
  );
  const videos = await fetchChannelVideos(env, youtubeChannelId);
  expect(videos).toEqual([
    {
      videoId: "aaaaaaaaaaa",
      title: "첫 영상",
      publishedAt: Math.floor(Date.parse("2026-11-01T00:00:00Z") / 1_000),
    },
    {
      videoId: "bbbbbbbbbbb",
      title: "영상",
      publishedAt: Math.floor(Date.parse("2026-11-01T00:00:00Z") / 1_000),
    },
  ]);
  expect(requests.map((url) => url.pathname)).toEqual([
    "/youtube/v3/channels",
    "/youtube/v3/playlistItems",
  ]);
  expect(requests[0]?.searchParams.get("id")).toBe(youtubeChannelId);
  expect(requests[0]?.searchParams.get("part")).toBe("contentDetails");
  expect(requests[1]?.searchParams.get("playlistId")).toBe(uploads);
  expect(requests[1]?.searchParams.get("maxResults")).toBe("50");
  expect(network).toHaveBeenCalledTimes(2);
  const headers = network.mock.calls[0]?.[1]?.headers as Record<string, string>;
  expect(headers["x-goog-api-key"]).toBe(env.YOUTUBE_API_KEY);
});

test("빈 채널은 빈 목록으로 완료해요", async () => {
  provider([]);
  expect(await fetchChannelVideos(env, youtubeChannelId)).toEqual([]);
});

test("사라졌거나 응답이 비어 있는 채널은 invalid_response로 실패해요", async () => {
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ items: [] }));
  expect((await failure(fetchChannelVideos(env, youtubeChannelId)))?.code).toBe(
    "invalid_response",
  );
  expect(network).toHaveBeenCalledTimes(1);
});

test("공급자 제한·서버 오류는 provider_unavailable로 실패해요", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("quotaExceeded", { status: 429 }),
  );
  expect((await failure(fetchChannelVideos(env, youtubeChannelId)))?.code).toBe(
    "provider_unavailable",
  );
});

test("네트워크 예외는 provider_unavailable로 실패해요", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("fixture-network-error"),
  );
  expect((await failure(fetchChannelVideos(env, youtubeChannelId)))?.code).toBe(
    "provider_unavailable",
  );
});

test("검증을 통과하지 못한 영상 응답은 invalid_response로 실패해요", async () => {
  provider([item("too-short")]);
  expect((await failure(fetchChannelVideos(env, youtubeChannelId)))?.code).toBe(
    "invalid_response",
  );
});

test("API 키가 없으면 공급자를 호출하지 않아요", async () => {
  const network = vi.spyOn(globalThis, "fetch");
  expect(
    (
      await failure(
        fetchChannelVideos({ ...env, YOUTUBE_API_KEY: "" }, youtubeChannelId),
      )
    )?.code,
  ).toBe("configuration");
  expect(network).not.toHaveBeenCalled();
});
