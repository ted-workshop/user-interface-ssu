import { z } from "zod";

// 채널 확인은 공식 Data API의 고정 endpoint만 사용해요. 실패 원인은 확인 결과 코드로만 노출해요.
export class ChannelFetchError extends Error {
  constructor(
    readonly code:
      | "configuration"
      | "provider_unavailable"
      | "invalid_response",
  ) {
    super(`채널 영상을 확인하지 못했어요 (${code}).`);
    this.name = "ChannelFetchError";
  }
}

export type ChannelVideo = {
  videoId: string;
  title: string;
  publishedAt: number | null;
};

const youtubeVideoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const channelDetails = z.object({
  items: z
    .array(
      z.object({
        contentDetails: z.object({
          relatedPlaylists: z.object({ uploads: z.string().min(1) }),
        }),
      }),
    )
    .max(1)
    .default([]),
});
const playlistPage = z.object({
  items: z
    .array(
      z.object({
        snippet: z.object({
          title: z.string().trim().min(1).max(1000),
          publishedAt: z.iso.datetime({ offset: true }),
          resourceId: z.object({ videoId: youtubeVideoId }),
        }),
      }),
    )
    .default([]),
});

async function request(
  env: Env,
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  if (!env.YOUTUBE_API_KEY?.trim())
    throw new ChannelFetchError("configuration");
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [name, value] of Object.entries(params))
    url.searchParams.set(name, value);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "x-goog-api-key": env.YOUTUBE_API_KEY },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ChannelFetchError("provider_unavailable");
  }
  // 3xx·429·5xx는 응답 원문을 보관하지 않고 다시 확인할 수 있는 실패로 남겨요.
  if (!response.ok) throw new ChannelFetchError("provider_unavailable");
  try {
    return await response.json();
  } catch {
    throw new ChannelFetchError("invalid_response");
  }
}

// 채널의 업로드 재생목록에서 최근 영상 ID·제목·게시 시각을 최대 50개 읽어요.
export async function fetchChannelVideos(
  env: Env,
  youtubeChannelId: string,
): Promise<ChannelVideo[]> {
  const details = channelDetails.safeParse(
    await request(env, "channels", {
      part: "contentDetails",
      fields: "items(contentDetails/relatedPlaylists/uploads)",
      id: youtubeChannelId,
    }),
  );
  if (!details.success) throw new ChannelFetchError("invalid_response");
  const uploads =
    details.data.items[0]?.contentDetails.relatedPlaylists.uploads;
  // 등록 당시 확인한 채널이 사라졌거나 응답이 비면 다음 확인에서 다시 시도해요.
  if (!uploads) throw new ChannelFetchError("invalid_response");
  const page = playlistPage.safeParse(
    await request(env, "playlistItems", {
      part: "snippet",
      fields: "items(snippet(title,publishedAt,resourceId/videoId))",
      playlistId: uploads,
      maxResults: "50",
    }),
  );
  if (!page.success) throw new ChannelFetchError("invalid_response");
  const seen = new Set<string>();
  const videos: ChannelVideo[] = [];
  for (const item of page.data.items) {
    const { videoId } = item.snippet.resourceId;
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    videos.push({
      videoId,
      title: item.snippet.title,
      publishedAt: Math.floor(Date.parse(item.snippet.publishedAt) / 1_000),
    });
  }
  return videos;
}
