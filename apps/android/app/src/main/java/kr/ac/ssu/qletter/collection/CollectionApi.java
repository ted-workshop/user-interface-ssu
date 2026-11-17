package kr.ac.ssu.qletter.collection;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import kr.ac.ssu.qletter.common.QletterApi;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Request;
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

  private final QletterApi api;

  CollectionApi(QletterApi api) {
    this.api = api;
  }

  /** 내 모음 목록 첫 페이지를 불러와요. 반환한 Call로 요청을 취소할 수 있어요. */
  Call list(Result<List<ReportCollection>> result) {
    Call call = api.newCall(new Request.Builder().url(api.endpoint("collections").build()).build());
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
              if (!response.isSuccessful() || body == null) {
                result.onError("모음을 불러오지 못했어요. (" + response.code() + ")");
                return;
              }
              result.onSuccess(parseList(body.string()));
            } catch (IOException | JSONException error) {
              result.onError("모음 응답을 읽지 못했어요.");
            }
          }
        });
    return call;
  }

  private static List<ReportCollection> parseList(String json) throws JSONException {
    JSONArray items = new JSONObject(json).getJSONArray("items");
    List<ReportCollection> collections = new ArrayList<>();
    for (int i = 0; i < items.length(); i++) {
      JSONObject item = items.getJSONObject(i);
      collections.add(
          new ReportCollection(
              item.getString("name"), item.getInt("reportCount"), item.getString("id")));
    }
    return collections;
  }

  private static String failureMessage(IOException error) {
    String message = error.getMessage();
    if ("로그인이 필요해요.".equals(message)) return message;
    return "네트워크 연결을 확인해 주세요.";
  }
}
