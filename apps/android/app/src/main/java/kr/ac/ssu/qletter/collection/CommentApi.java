package kr.ac.ssu.qletter.collection;

import android.content.res.Resources;
import java.io.IOException;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
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

/** 리포트 댓글 API(/v1/reports/{id}/comments)를 호출하고 응답을 화면용 객체로 바꿔요. */
final class CommentApi {
  /** 결과는 OkHttp 작업 스레드에서 와요. 화면을 바꾸려면 메인 스레드로 넘겨야 해요. */
  interface Result<T> {
    void onSuccess(T value);

    /** 이 리포트를 볼 권한이 없을 때(404)예요. 댓글 영역을 숨기고 안내해요. */
    void onNoAccess(String message);

    void onError(String message);
  }

  private interface Parser<T> {
    T parse(String body) throws JSONException;
  }

  private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

  private final QletterApi api;
  private final Resources resources;

  CommentApi(QletterApi api, Resources resources) {
    this.api = api;
    this.resources = resources;
  }

  /** 최근 댓글 100개를 오래된 순서로 불러와요. */
  Call list(String reportId, Result<List<Comment>> result) {
    Request request =
        new Request.Builder()
            .url(
                api.endpoint("reports", reportId, "comments")
                    .addQueryParameter("limit", "100")
                    .build())
            .build();
    return send(request, CommentApi::parseList, R.string.comment_error_load, result);
  }

  /** 댓글을 남기고 서버가 저장한 댓글을 돌려줘요. */
  Call create(String reportId, String body, Result<Comment> result) {
    RequestBody json;
    try {
      json = RequestBody.create(new JSONObject().put("body", body).toString(), JSON);
    } catch (JSONException error) {
      throw new IllegalStateException(error);
    }
    Request request =
        new Request.Builder()
            .url(api.endpoint("reports", reportId, "comments").build())
            .post(json)
            .build();
    return send(
        request, text -> toComment(new JSONObject(text)), R.string.comment_error_create, result);
  }

  /** 내 댓글을 지워요. 성공 값은 없어서 null이에요. */
  Call delete(String reportId, String commentId, Result<Void> result) {
    Request request =
        new Request.Builder()
            .url(api.endpoint("reports", reportId, "comments", commentId).build())
            .delete()
            .build();
    return send(request, text -> null, R.string.comment_error_delete, result);
  }

  /** 안내 문구("찬형 닉네임으로 남겨요")에 쓸 내 닉네임을 불러와요. */
  Call myNickname(Result<String> result) {
    Request request = new Request.Builder().url(api.endpoint("me").build()).build();
    return send(
        request,
        text -> new JSONObject(text).getString("nickname"),
        R.string.comment_error_load,
        result);
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
              if (response.code() == 404) {
                // 권한 행이 없으면 없는 리포트와 같은 404예요(ADR-0034).
                result.onNoAccess(resources.getString(R.string.comment_error_no_access));
                return;
              }
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

  private static List<Comment> parseList(String json) throws JSONException {
    JSONArray items = new JSONObject(json).getJSONArray("items");
    List<Comment> comments = new ArrayList<>();
    // 서버는 최신순으로 줘요. 피그마처럼 오래된 댓글이 위, 새 댓글이 아래에 오도록 뒤집어요.
    for (int i = items.length() - 1; i >= 0; i--) comments.add(toComment(items.getJSONObject(i)));
    return comments;
  }

  private static Comment toComment(JSONObject item) throws JSONException {
    return new Comment(
        item.getString("id"),
        item.getJSONObject("author").getString("nickname"),
        item.getString("body"),
        parseTime(item.getString("createdAt")),
        item.optBoolean("canDelete"));
  }

  /** 서버 시각(UTC, ISO 8601)을 밀리초로 바꿔요. */
  private static long parseTime(String iso) throws JSONException {
    SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
    format.setTimeZone(TimeZone.getTimeZone("UTC"));
    try {
      return format.parse(iso).getTime();
    } catch (ParseException error) {
      throw new JSONException("createdAt 형식이 달라요: " + iso);
    }
  }

  private String errorMessage(int status, String body, int failure) {
    if (status == 401) return resources.getString(R.string.collection_error_sign_in);
    try {
      JSONObject fields = new JSONObject(body).getJSONObject("error").optJSONObject("fields");
      // 빈 댓글·2,000자 초과는 서버가 준 필드 문장을 그대로 보여 줘요.
      if (fields != null && fields.has("body")) return fields.getString("body");
    } catch (JSONException ignored) {
      // 본문이 JSON이 아니면 상태 코드만 보여 줘요.
    }
    return resources.getString(
        R.string.collection_error_with_status, resources.getString(failure), status);
  }

  private String failureMessage(IOException error) {
    String message = error.getMessage();
    if ("로그인이 필요해요.".equals(message)) return resources.getString(R.string.collection_error_sign_in);
    if ("세션이 변경됐어요.".equals(message))
      return resources.getString(R.string.collection_error_session_changed);
    return resources.getString(R.string.collection_error_network);
  }
}
