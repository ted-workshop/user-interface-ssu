package kr.ac.ssu.qletter.collection;

import java.io.IOException;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
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

  private interface Parser<T> {
    T parse(String body) throws JSONException;
  }

  private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

  private final QletterApi api;

  CollectionApi(QletterApi api) {
    this.api = api;
  }

  /** 내 모음 목록 첫 페이지를 불러와요. 반환한 Call로 요청을 취소할 수 있어요. */
  Call list(Result<List<ReportCollection>> result) {
    Request request = new Request.Builder().url(api.endpoint("collections").build()).build();
    return send(request, CollectionApi::parseList, "모음을 불러오지 못했어요.", result);
  }

  /** 모음에 담긴 리포트 첫 페이지를 담은 시각 최신순으로 불러와요. */
  Call reports(String id, Result<List<CollectionReport>> result) {
    Request request =
        new Request.Builder().url(api.endpoint("collections", id, "reports").build()).build();
    return send(request, CollectionApi::parseReports, "리포트를 불러오지 못했어요.", result);
  }

  /** 새 모음을 만들고 서버가 만든 모음을 돌려줘요. */
  Call create(String name, Result<ReportCollection> result) {
    Request request =
        new Request.Builder().url(api.endpoint("collections").build()).post(nameBody(name)).build();
    return send(request, CollectionApi::parseOne, "모음을 만들지 못했어요.", result);
  }

  /** 모음 이름을 바꾸고 바뀐 모음을 돌려줘요. */
  Call rename(String id, String name, Result<ReportCollection> result) {
    Request request =
        new Request.Builder()
            .url(api.endpoint("collections", id).build())
            .patch(nameBody(name))
            .build();
    return send(request, CollectionApi::parseOne, "이름을 바꾸지 못했어요.", result);
  }

  /** 모음을 지워요. 담긴 리포트는 보관함에 남아요. 성공 값은 없어서 null이에요. */
  Call delete(String id, Result<Void> result) {
    Request request =
        new Request.Builder().url(api.endpoint("collections", id).build()).delete().build();
    return send(request, body -> null, "모음을 지우지 못했어요.", result);
  }

  private <T> Call send(Request request, Parser<T> parser, String failure, Result<T> result) {
    Call call = api.newCall(request);
    call.enqueue(
        new Callback() {
          @Override
          public void onFailure(Call call, IOException error) {
            if (call.isCanceled()) return;
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
              result.onError("서버 응답을 읽지 못했어요.");
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

  private static List<ReportCollection> parseList(String json) throws JSONException {
    JSONArray items = new JSONObject(json).getJSONArray("items");
    List<ReportCollection> collections = new ArrayList<>();
    for (int i = 0; i < items.length(); i++) collections.add(toCollection(items.getJSONObject(i)));
    return collections;
  }

  private static List<CollectionReport> parseReports(String json) throws JSONException {
    JSONArray items = new JSONObject(json).getJSONArray("items");
    List<CollectionReport> reports = new ArrayList<>();
    for (int i = 0; i < items.length(); i++) {
      JSONObject item = items.getJSONObject(i);
      JSONObject viewer = item.optJSONObject("viewerContext");
      reports.add(
          new CollectionReport(
              // 공급자가 주지 않은 제목·채널은 null로 와요(ADR-0036).
              textOr(item, "title", "제목 없음"),
              textOr(item, "channelName", "채널 정보 없음"),
              parseTime(item.getString("createdAt")),
              viewer != null && "channel".equals(viewer.optString("origin")),
              viewer != null && "failed".equals(viewer.optString("deliveryStatus"))));
    }
    return reports;
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
  private static String errorMessage(int status, String body, String failure) {
    try {
      JSONObject error = new JSONObject(body).getJSONObject("error");
      String code = error.optString("code");
      JSONObject fields = error.optJSONObject("fields");
      if (fields != null && fields.has("name")) return fields.getString("name");
      if ("COLLECTION_EXISTS".equals(code)) return "이미 같은 이름의 모음이 있어요. 다른 이름을 정해 주세요.";
      if ("NOT_FOUND".equals(code)) return "모음을 찾을 수 없어요.";
    } catch (JSONException ignored) {
      // 본문이 JSON이 아니면 상태 코드만 보여 줘요.
    }
    return failure + " (" + status + ")";
  }

  private static String failureMessage(IOException error) {
    String message = error.getMessage();
    if ("로그인이 필요해요.".equals(message)) return message;
    return "네트워크 연결을 확인해 주세요.";
  }
}
