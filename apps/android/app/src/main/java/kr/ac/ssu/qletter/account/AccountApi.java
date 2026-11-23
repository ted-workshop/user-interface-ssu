package kr.ac.ssu.qletter.account;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import kr.ac.ssu.qletter.auth.Account;
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

/** 계정 정보·수신 주소·확인 주기 API를 호출해요. */
final class AccountApi {
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

  AccountApi(QletterApi api) {
    this.api = api;
  }

  Call me(JsonCall.Result<Account> result) {
    Request request = new Request.Builder().url(api.endpoint("me").build()).build();
    Call call = api.newCall(request);
    JsonCall.enqueue(call, text -> Account.parse(new JSONObject(text)), result);
    return call;
  }

  /** 세션 사용자의 닉네임만 바꾸고 갱신된 계정을 돌려받아요. */
  Call updateNickname(String nickname, JsonCall.Result<Account> result) {
    Request request =
        new Request.Builder()
            .url(api.endpoint("me").build())
            .patch(body(json("nickname", nickname)))
            .build();
    Call call = api.newCall(request);
    JsonCall.enqueue(call, text -> Account.parse(new JSONObject(text)), result);
    return call;
  }

  Call recipients(JsonCall.Result<Page<Recipient>> result) {
    Request request =
        new Request.Builder()
            .url(
                api.endpoint("recipients")
                    .addQueryParameter("limit", String.valueOf(PAGE_LIMIT))
                    .build())
            .build();
    Call call = api.newCall(request);
    JsonCall.enqueue(call, AccountApi::parseRecipients, result);
    return call;
  }

  Call addRecipient(String email, JsonCall.Result<Recipient> result) {
    Request request =
        new Request.Builder()
            .url(api.endpoint("recipients").build())
            .post(body(json("email", email)))
            .build();
    Call call = api.newCall(request);
    JsonCall.enqueue(call, AccountApi::parseRecipient, result);
    return call;
  }

  /** 확인 메일 발송을 요청해요. 주소 생성만으로는 메일을 보내지 않아요. */
  Call requestVerification(String id, JsonCall.Result<Void> result) {
    Request request =
        new Request.Builder()
            .url(api.endpoint("recipients", id, "verifications").build())
            .post(RequestBody.create(new byte[0], null))
            .build();
    Call call = api.newCall(request);
    JsonCall.enqueue(call, AccountApi::noContent, result);
    return call;
  }

  Call confirmRecipient(String token, JsonCall.Result<Void> result) {
    Request request =
        new Request.Builder()
            .url(api.endpoint("recipient-verifications", "confirm").build())
            .post(body(json("token", token)))
            .build();
    Call call = api.newCall(request);
    JsonCall.enqueue(call, AccountApi::noContent, result);
    return call;
  }

  Call deleteRecipient(String id, JsonCall.Result<Void> result) {
    Request request =
        new Request.Builder().url(api.endpoint("recipients", id).build()).delete().build();
    Call call = api.newCall(request);
    JsonCall.enqueue(call, AccountApi::noContent, result);
    return call;
  }

  Call settings(JsonCall.Result<Integer> result) {
    Request request = new Request.Builder().url(api.endpoint("settings").build()).build();
    Call call = api.newCall(request);
    JsonCall.enqueue(call, AccountApi::parseInterval, result);
    return call;
  }

  Call updateInterval(int minutes, JsonCall.Result<Integer> result) {
    Request request =
        new Request.Builder()
            .url(api.endpoint("settings").build())
            .patch(body(json("checkIntervalMinutes", minutes)))
            .build();
    Call call = api.newCall(request);
    JsonCall.enqueue(call, AccountApi::parseInterval, result);
    return call;
  }

  /** 서버의 현재 세션을 폐기해요. 화면은 응답과 상관없이 기기 세션을 지워요. */
  Call logout(JsonCall.Result<Void> result) {
    Request request =
        new Request.Builder().url(api.endpoint("auth", "session").build()).delete().build();
    Call call = api.newCall(request);
    JsonCall.enqueue(call, AccountApi::noContent, result);
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

  private static Page<Recipient> parseRecipients(String text) throws JSONException {
    JSONObject page = new JSONObject(text);
    JSONArray items = page.getJSONArray("items");
    List<Recipient> recipients = new ArrayList<>();
    for (int i = 0; i < items.length(); i++) recipients.add(toRecipient(items.getJSONObject(i)));
    return new Page<>(recipients, !page.isNull("nextCursor"));
  }

  private static Recipient parseRecipient(String text) throws JSONException {
    return toRecipient(new JSONObject(text));
  }

  private static Recipient toRecipient(JSONObject json) throws JSONException {
    return new Recipient(
        json.getString("id"),
        json.getString("email"),
        json.isNull("verifiedAt") ? null : UtcTime.parseMillis(json.getString("verifiedAt")));
  }

  private static Integer parseInterval(String text) throws JSONException {
    return new JSONObject(text).getInt("checkIntervalMinutes");
  }

  private static Void noContent(String text) throws JSONException {
    if (!text.isEmpty()) new JSONObject(text);
    return null;
  }
}
