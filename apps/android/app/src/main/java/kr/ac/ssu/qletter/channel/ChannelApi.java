package kr.ac.ssu.qletter.channel;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import kr.ac.ssu.qletter.common.JsonCall;
import kr.ac.ssu.qletter.common.QletterApi;
import kr.ac.ssu.qletter.common.UtcTime;
import okhttp3.Call;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.RequestBody;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** 채널 확인·등록·목록·중지·삭제 API를 호출해요. */
final class ChannelApi {
  static final class Page<T> {
    final List<T> items;
    final boolean hasMore;

    Page(List<T> items, boolean hasMore) {
      this.items = Collections.unmodifiableList(items);
      this.hasMore = hasMore;
    }
  }

  private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
  private static final int PAGE_LIMIT = 100;

  private final QletterApi api;

  ChannelApi(QletterApi api) {
    this.api = api;
  }

  Call preview(String input, JsonCall.Result<ChannelPreview> result) {
    Request request =
        new Request.Builder()
            .url(api.endpoint("channel-previews").build())
            .post(body(json("input", input)))
            .build();
    Call call = api.newCall(request);
    JsonCall.enqueue(call, ChannelApi::parsePreview, result);
    return call;
  }

  Call register(String youtubeChannelId, JsonCall.Result<Channel> result) {
    Request request =
        new Request.Builder()
            .url(api.endpoint("channels").build())
            .post(body(json("youtubeChannelId", youtubeChannelId)))
            .build();
    Call call = api.newCall(request);
    JsonCall.enqueue(call, ChannelApi::parseChannel, result);
    return call;
  }

  Call list(JsonCall.Result<Page<Channel>> result) {
    Request request =
        new Request.Builder()
            .url(
                api.endpoint("channels")
                    .addQueryParameter("limit", String.valueOf(PAGE_LIMIT))
                    .build())
            .build();
    Call call = api.newCall(request);
    JsonCall.enqueue(call, ChannelApi::parseList, result);
    return call;
  }

  Call updateStatus(String id, boolean active, JsonCall.Result<Channel> result) {
    Request request =
        new Request.Builder()
            .url(api.endpoint("channels", id).build())
            .patch(body(json("status", active ? "active" : "paused")))
            .build();
    Call call = api.newCall(request);
    JsonCall.enqueue(call, ChannelApi::parseChannel, result);
    return call;
  }

  Call delete(String id, JsonCall.Result<Void> result) {
    Request request =
        new Request.Builder().url(api.endpoint("channels", id).build()).delete().build();
    Call call = api.newCall(request);
    JsonCall.enqueue(call, ChannelApi::noContent, result);
    return call;
  }

  private static RequestBody body(JSONObject json) {
    return RequestBody.create(json.toString(), JSON);
  }

  private static JSONObject json(String key, Object value) {
    try {
      return new JSONObject().put(key, value);
    } catch (JSONException error) {
      throw new IllegalStateException(error);
    }
  }

  private static ChannelPreview parsePreview(String text) throws JSONException {
    JSONObject json = new JSONObject(text);
    return new ChannelPreview(
        json.getString("youtubeChannelId"), json.getString("title"), json.getString("url"));
  }

  private static Page<Channel> parseList(String text) throws JSONException {
    JSONObject page = new JSONObject(text);
    JSONArray items = page.getJSONArray("items");
    List<Channel> channels = new ArrayList<>();
    for (int i = 0; i < items.length(); i++) channels.add(toChannel(items.getJSONObject(i)));
    return new Page<>(channels, !page.isNull("nextCursor"));
  }

  private static Channel parseChannel(String text) throws JSONException {
    return toChannel(new JSONObject(text));
  }

  private static Channel toChannel(JSONObject json) throws JSONException {
    return new Channel(
        json.getString("id"),
        json.getString("youtubeChannelId"),
        json.optString("title", ""),
        json.optString("url", ""),
        "active".equals(json.optString("status")),
        json.isNull("lastCheckedAt") ? null : UtcTime.parseMillis(json.getString("lastCheckedAt")));
  }

  private static Void noContent(String text) throws JSONException {
    if (!text.isEmpty()) new JSONObject(text);
    return null;
  }
}
