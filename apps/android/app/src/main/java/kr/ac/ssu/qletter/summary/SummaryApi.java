package kr.ac.ssu.qletter.summary;

import java.util.ArrayList;
import java.util.List;
import kr.ac.ssu.qletter.common.JsonCall;
import kr.ac.ssu.qletter.common.QletterApi;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.RequestBody;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class SummaryApi {
  static final class Page {
    final List<SummaryRequest> items = new ArrayList<>();
    final String cursor;

    Page(String text) throws JSONException {
      JSONObject json = new JSONObject(text);
      JSONArray rows = json.getJSONArray("items");
      for (int i = 0; i < rows.length(); i++) items.add(new SummaryRequest(rows.getJSONObject(i)));
      cursor = json.isNull("nextCursor") ? null : json.getString("nextCursor");
    }
  }

  private final QletterApi api;

  SummaryApi(QletterApi api) {
    this.api = api;
  }

  Call list(String cursor, JsonCall.Result<Page> result) {
    HttpUrl.Builder url = api.endpoint("summary-requests").addQueryParameter("limit", "20");
    if (cursor != null) url.addQueryParameter("cursor", cursor);
    Call call = api.newCall(new Request.Builder().url(url.build()).build());
    JsonCall.enqueue(call, Page::new, result);
    return call;
  }

  Call get(String id, JsonCall.Result<SummaryRequest> result) {
    return send(
        new Request.Builder().url(api.endpoint("summary-requests", id).build()).build(), result);
  }

  Call submit(String url, JsonCall.Result<SummaryRequest> result) {
    return send(
        new Request.Builder()
            .url(api.endpoint("summary-requests").build())
            .post(body("url", url))
            .build(),
        result);
  }

  Call retry(SummaryRequest request, JsonCall.Result<SummaryRequest> result) {
    return send(
        new Request.Builder()
            .url(api.endpoint("summary-requests", request.id, "retry").build())
            .post(body("attempt", request.attempt))
            .build(),
        result);
  }

  private Call send(Request request, JsonCall.Result<SummaryRequest> result) {
    Call call = api.newCall(request);
    JsonCall.enqueue(call, text -> new SummaryRequest(new JSONObject(text)), result);
    return call;
  }

  private static RequestBody body(String key, Object value) {
    try {
      return RequestBody.create(
          new JSONObject().put(key, value).toString(),
          MediaType.get("application/json; charset=utf-8"));
    } catch (JSONException error) {
      throw new IllegalArgumentException(error);
    }
  }
}
