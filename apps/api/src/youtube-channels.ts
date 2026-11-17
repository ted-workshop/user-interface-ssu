import { z } from "zod";
import { InvalidInput } from "./http-input";

export const youtubeChannelId = z.string().regex(/^UC[A-Za-z0-9_-]{22}$/);
export class ChannelInputError extends InvalidInput {}
export class ChannelLookupError extends Error {}

type ChannelFilter = {
  name: "id" | "forHandle" | "forUsername";
  value: string;
};

// 입력 URL을 열지 않고 허용한 경로에서 공식 조회 필터만 꺼내요.
export function parseChannelInput(raw: string): ChannelFilter {
  const input = raw.trim();
  if (!input || input.length > 2048 || /[\s\p{Cc}\\]/u.test(input))
    throw new ChannelInputError();
  if (input.startsWith("@") && input.length > 1 && !/[/?#%]/.test(input))
    return { name: "forHandle", value: input };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ChannelInputError();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)
  )
    throw new ChannelInputError();
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    throw new ChannelInputError();
  }
  if (/[\s\p{Cc}\\%?#]/u.test(path)) throw new ChannelInputError();
  const parts = path.replace(/\/$/, "").split("/").slice(1);
  if (parts.length === 1 && parts[0]?.startsWith("@") && parts[0].length > 1)
    return { name: "forHandle", value: parts[0] };
  if (
    parts.length === 2 &&
    parts[0] === "channel" &&
    youtubeChannelId.safeParse(parts[1]).success
  )
    return { name: "id", value: parts[1] ?? "" };
  if (parts.length === 2 && parts[0] === "user" && parts[1])
    return { name: "forUsername", value: parts[1] };
  throw new ChannelInputError();
}

const channelList = z.object({
  items: z
    .array(
      z.object({
        id: youtubeChannelId,
        snippet: z.object({ title: z.string().trim().min(1).max(1000) }),
      }),
    )
    .max(1)
    .default([]),
});

export async function lookupChannel(env: Env, filter: ChannelFilter) {
  if (!env.YOUTUBE_API_KEY?.trim()) throw new ChannelLookupError();
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("fields", "items(id,snippet/title)");
  url.searchParams.set(filter.name, filter.value);
  let data: z.infer<typeof channelList>;
  try {
    const response = await fetch(url, {
      headers: { "x-goog-api-key": env.YOUTUBE_API_KEY },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new ChannelLookupError();
    data = channelList.parse(await response.json());
  } catch {
    // 키·공급자 응답 원문은 HTTP 응답이나 로그에 넣지 않아요.
    throw new ChannelLookupError();
  }
  const channel = data.items[0];
  if (!channel) throw new ChannelInputError();
  if (filter.name === "id" && channel.id !== filter.value)
    throw new ChannelLookupError();
  return {
    youtubeChannelId: channel.id,
    title: channel.snippet.title,
    url: `https://www.youtube.com/channel/${channel.id}`,
  };
}
