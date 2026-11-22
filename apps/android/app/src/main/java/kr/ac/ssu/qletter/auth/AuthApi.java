package kr.ac.ssu.qletter.auth;

import kr.ac.ssu.qletter.common.JsonCall;
import kr.ac.ssu.qletter.common.QletterApi;
import okhttp3.Call;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.RequestBody;
import org.json.JSONException;
import org.json.JSONObject;

/** 계정·인증 API를 호출하고 응답을 화면에서 쓰는 값으로 바꿔요. */
final class AuthApi {
  private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

  static final class Login {
    final String sessionToken;
    final String expiresAt;

    Login(String sessionToken, String expiresAt) {
      this.sessionToken = sessionToken;
      this.expiresAt = expiresAt;
    }
  }

  private final QletterApi api;

  AuthApi(QletterApi api) {
    this.api = api;
  }

  Call login(String email, String password, JsonCall.Result<Login> result) {
    JSONObject body = new JSONObject();
    try {
      body.put("email", email).put("password", password);
    } catch (JSONException error) {
      throw new IllegalStateException(error);
    }
    return sendPublic("auth/sessions", body, AuthApi::parseLogin, result);
  }

  Call register(String email, String password, String nickname, JsonCall.Result<Void> result) {
    JSONObject body = new JSONObject();
    try {
      body.put("email", email).put("password", password).put("nickname", nickname);
    } catch (JSONException error) {
      throw new IllegalStateException(error);
    }
    return sendPublic("auth/registrations", body, AuthApi::noContent, result);
  }

  Call confirmEmail(String token, String password, JsonCall.Result<Void> result) {
    JSONObject body = new JSONObject();
    try {
      body.put("token", token).put("password", password);
    } catch (JSONException error) {
      throw new IllegalStateException(error);
    }
    return sendPublic("auth/email-verifications/confirm", body, AuthApi::noContent, result);
  }

  Call resendVerification(String email, JsonCall.Result<Void> result) {
    return sendEmail("auth/email-verifications", email, result);
  }

  Call requestPasswordReset(String email, JsonCall.Result<Void> result) {
    return sendEmail("auth/password-resets", email, result);
  }

  Call confirmPasswordReset(String token, String password, JsonCall.Result<Void> result) {
    JSONObject body = new JSONObject();
    try {
      body.put("token", token).put("password", password);
    } catch (JSONException error) {
      throw new IllegalStateException(error);
    }
    return sendPublic("auth/password-resets/confirm", body, AuthApi::noContent, result);
  }

  private Call sendEmail(String path, String email, JsonCall.Result<Void> result) {
    JSONObject body = new JSONObject();
    try {
      body.put("email", email);
    } catch (JSONException error) {
      throw new IllegalStateException(error);
    }
    return sendPublic(path, body, AuthApi::noContent, result);
  }

  private <T> Call sendPublic(
      String path, JSONObject body, JsonCall.Parser<T> parser, JsonCall.Result<T> result) {
    Request request =
        new Request.Builder()
            .url(api.endpoint(path.split("/")).build())
            .post(RequestBody.create(body.toString(), JSON))
            .build();
    Call call = api.newPublicCall(request);
    JsonCall.enqueue(call, parser, result);
    return call;
  }

  private static Login parseLogin(String text) throws JSONException {
    JSONObject json = new JSONObject(text);
    // 사용자 정보는 화면 이동 뒤 GET /v1/me로 다시 읽어요. 토큰과 만료 시각만 저장해요.
    return new Login(json.getString("sessionToken"), json.getString("expiresAt"));
  }

  private static Void noContent(String text) throws JSONException {
    if (text.isEmpty()) return null;
    // 202 응답의 status는 화면이 정한 다음 단계로만 쓰고 저장하지 않아요.
    new JSONObject(text);
    return null;
  }
}
