package kr.ac.ssu.qletter.collection;

import android.content.res.Resources;
import java.io.IOException;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.QletterApi;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** 모음 API를 호출하고 응답 JSON을 화면에서 쓰는 객체로 바꿔요. */
final class CollectionApi {
  /** 결과는 OkHttp 작업 스레드에서 전달돼요. 화면을 바꾸려면 메인 스레드로 넘겨야 해요. */
  interface Result<T> {
    void onSuccess(T value);

    void onError(String message);
  }

  /** 한 번에 받은 목록과, 서버에 더 남은 항목이 있는지예요. */
  static final class Page<T> {
    final List<T> items;
    final boolean hasMore;

    Page(List<T> items, boolean hasMore) {
      this.items = Collections.unmodifiableList(items);
      this.hasMore = hasMore;
    }
  }

  private interface Parser<T> {
    T parse(String body) throws JSONException;
  }

  /** 서버가 한 번에 주는 최대 개수예요(apps/api/src/http-input.ts). 넘는 항목은 "더 있어요" 안내만 해요. */
  static final int PAGE_LIMIT = 100;

  private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

  private final QletterApi api;
  private final Resources resources;

  CollectionApi(QletterApi api, Resources resources) {
    this.api = api;
    this.resources = resources;
  }

  /** 내 모음 목록을 만든 시각 최신순으로 최대 100개 불러와요. 반환한 Call로 요청을 취소할 수 있어요. */
  Call list(Result<Page<ReportCollection>> result) {
    Request request =
        new Request.Builder()
            .url(api.endpoint("collections").addQueryParameter("limit", limit()).build())
            .build();
    return send(request, this::parseList, R.string.collection_error_load, result);
  }

  /** 모음에 담긴 리포트를 담은 시각 최신순으로 최대 100개 불러와요. */
  Call reports(String id, Result<Page<CollectionReport>> result) {
    Request request =
        new Request.Builder()
            .url(
                api.endpoint("collections", id, "reports")
                    .addQueryParameter("limit", limit())
                    .build())
            .build();
    return send(request, this::parseReports, R.string.collection_error_load_reports, result);
  }

  /** 모음에 담기 시트용으로, 내 모음과 그 모음에 이 리포트가 담겼는지를 함께 불러와요. */
  Call checksForReport(String reportId, Result<Page<CollectionCheck>> result) {
    Request request =
        new Request.Builder()
            .url(
                api.endpoint("collections")
                    .addQueryParameter("limit", limit())
                    .addQueryParameter("reportId", reportId)
                    .build())
            .build();
    return send(request, this::parseChecks, R.string.collection_error_load, result);
  }

  /** 리포트를 모음에 담아요. 이미 담겨 있어도 성공이에요. */
  Call addReport(String collectionId, String reportId, Result<Void> result) {
    Request request =
        new Request.Builder()
            .url(api.endpoint("collections", collectionId, "reports", reportId).build())
            .put(RequestBody.create(new byte[0]))
            .build();
    return send(request, body -> null, R.string.collection_error_add, result);
  }

  /** 리포트를 모음에서 빼요. 담겨 있지 않아도 성공이고, 리포트는 보관함에 남아요. */
  Call removeReport(String collectionId, String reportId, Result<Void> result) {
    Request request =
        new Request.Builder()
            .url(api.endpoint("collections", collectionId, "reports", reportId).build())
            .delete()
            .build();
    return send(request, body -> null, R.string.collection_error_remove, result);
  }

  /** 새 모음을 만들고 서버가 만든 모음을 돌려줘요. */
  Call create(String name, Result<ReportCollection> result) {
    Request request =
        new Request.Builder().url(api.endpoint("collections").build()).post(nameBody(name)).build();
    return send(request, CollectionApi::parseOne, R.string.collection_error_create, result);
  }

  /** 모음 이름을 바꾸고 바뀐 모음을 돌려줘요. */
  Call rename(String id, String name, Result<ReportCollection> result) {
    Request request =
        new Request.Builder()
            .url(api.endpoint("collections", id).build())
            .patch(nameBody(name))
            .build();
    return send(request, CollectionApi::parseOne, R.string.collection_error_rename, result);
  }

  /** 모음을 지워요. 담긴 리포트는 보관함에 남아요. 성공 값은 없어서 null이에요. */
  Call delete(String id, Result<Void> result) {
    Request request =
        new Request.Builder().url(api.endpoint("collections", id).build()).delete().build();
    return send(request, body -> null, R.string.collection_error_delete, result);
  }

  private static String limit() {
    return String.valueOf(PAGE_LIMIT);
  }

  private <T> Call send(Request request, Parser<T> parser, int failure, Result<T> result) {
    Call call = api.newCall(request);
    call.enqueue(
        new Callback() {
          @Override
          public void onFailure(Call call, IOException error) {
            if (QletterApi.canceledByCaller(call, error)) return;
            result.onError(failureMessage(error));
          }

          @Override
          public void onResponse(Call call, Response response) {
            try (ResponseBody body = response.body()) {
              String text = body == null ? "" : body.string();
              if (!response.isSuccessful()) {
                result.onError(errorMessage(response.code(), text, failure));
                return;
              }
              result.onSuccess(parser.parse(text));
            } catch (IOException | JSONException error) {
              result.onError(resources.getString(R.string.collection_error_response));
            }
          }
        });
    return call;
  }

  private static RequestBody nameBody(String name) {
    try {
      return RequestBody.create(new JSONObject().put("name", name).toString(), JSON);
    } catch (JSONException error) {
      throw new IllegalStateException(error);
    }
  }

  private Page<ReportCollection> parseList(String json) throws JSONException {
    JSONObject page = new JSONObject(json);
    JSONArray items = page.getJSONArray("items");
    List<ReportCollection> collections = new ArrayList<>();
    for (int i = 0; i < items.length(); i++) collections.add(toCollection(items.getJSONObject(i)));
    return new Page<>(collections, !page.isNull("nextCursor"));
  }

  private Page<CollectionCheck> parseChecks(String json) throws JSONException {
    JSONObject page = new JSONObject(json);
    JSONArray items = page.getJSONArray("items");
    List<CollectionCheck> checks = new ArrayList<>();
    for (int i = 0; i < items.length(); i++) {
      JSONObject item = items.getJSONObject(i);
      // containsReport는 reportId를 보낼 때만 붙어요(docs/api-contract.md 모음 절).
      checks.add(new CollectionCheck(toCollection(item), item.optBoolean("containsReport")));
    }
    return new Page<>(checks, !page.isNull("nextCursor"));
  }

  private Page<CollectionReport> parseReports(String json) throws JSONException {
    JSONObject page = new JSONObject(json);
    JSONArray items = page.getJSONArray("items");
    List<CollectionReport> reports = new ArrayList<>();
    for (int i = 0; i < items.length(); i++) {
      JSONObject item = items.getJSONObject(i);
      JSONObject viewer = item.optJSONObject("viewerContext");
      reports.add(
          new CollectionReport(
              // 공급자가 주지 않은 제목·채널은 null로 와요(ADR-0036).
              textOr(item, "title", resources.getString(R.string.report_untitled)),
              textOr(item, "channelName", resources.getString(R.string.report_unknown_channel)),
              parseTime(item.getString("createdAt")),
              viewer != null && "channel".equals(viewer.optString("origin")),
              viewer != null && "failed".equals(viewer.optString("deliveryStatus"))));
    }
    return new Page<>(reports, !page.isNull("nextCursor"));
  }

  /** 서버 시각(UTC, ISO 8601)을 밀리초로 바꿔요. minSdk 24라 java.time 대신 SimpleDateFormat을 써요. */
  private static long parseTime(String iso) throws JSONException {
    SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
    format.setTimeZone(TimeZone.getTimeZone("UTC"));
    try {
      return format.parse(iso).getTime();
    } catch (ParseException error) {
      throw new JSONException("createdAt 형식이 달라요: " + iso);
    }
  }

  private static String textOr(JSONObject item, String key, String fallback) {
    return item.isNull(key) ? fallback : item.optString(key, fallback);
  }

  private static ReportCollection parseOne(String json) throws JSONException {
    return toCollection(new JSONObject(json));
  }

  private static ReportCollection toCollection(JSONObject item) throws JSONException {
    return new ReportCollection(
        item.getString("name"), item.getInt("reportCount"), item.getString("id"));
  }

  /** 서버 오류 코드를 화면 문장으로 바꿔요. 이름 오류는 서버가 준 필드 문장을 그대로 써요. */
  private String errorMessage(int status, String body, int failure) {
    // 세션이 만료되면 QletterApi가 세션을 지우고, 화면에는 다른 경로와 같은 문장을 보여 줘요.
    if (status == 401) return resources.getString(R.string.collection_error_sign_in);
    try {
      JSONObject error = new JSONObject(body).getJSONObject("error");
      String code = error.optString("code");
      JSONObject fields = error.optJSONObject("fields");
      if (fields != null && fields.has("name")) return fields.getString("name");
      if ("COLLECTION_EXISTS".equals(code))
        return resources.getString(R.string.collection_error_exists);
      if ("NOT_FOUND".equals(code)) return resources.getString(R.string.collection_error_not_found);
    } catch (JSONException ignored) {
      // 본문이 JSON이 아니면 상태 코드만 보여 줘요.
    }
    return resources.getString(
        R.string.collection_error_with_status, resources.getString(failure), status);
  }

  /** QletterApi가 요청 전후로 던지는 세션 문장(common/QletterApi.java)은 그대로 보여 주고, 나머지는 연결 문제로 안내해요. */
  private String failureMessage(IOException error) {
    String message = error.getMessage();
    if ("로그인이 필요해요.".equals(message)) return resources.getString(R.string.collection_error_sign_in);
    if ("세션이 변경됐어요.".equals(message))
      return resources.getString(R.string.collection_error_session_changed);
    return resources.getString(R.string.collection_error_network);
  }
}
