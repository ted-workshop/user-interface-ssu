package kr.ac.ssu.qletter.auth;

import com.squareup.moshi.JsonAdapter;
import com.squareup.moshi.JsonDataException;
import com.squareup.moshi.JsonEncodingException;
import com.squareup.moshi.Moshi;
import com.squareup.moshi.Types;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

public final class AuthClient implements AuthApi {
  private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
  private final HttpUrl baseUrl;
  private final OkHttpClient client;
  private volatile Call activeCall;
  private final JsonAdapter<Map<String, Object>> adapter =
      new Moshi.Builder()
          .build()
          .adapter(Types.newParameterizedType(Map.class, String.class, Object.class));

  public AuthClient(String baseUrl) {
    this(
        baseUrl,
        new OkHttpClient.Builder()
            .connectTimeout(3, TimeUnit.SECONDS)
            .callTimeout(10, TimeUnit.SECONDS)
            .build());
  }

  AuthClient(String baseUrl, OkHttpClient client) {
    this.baseUrl = HttpUrl.get(baseUrl);
    if (!this.baseUrl.username().isEmpty()
        || !this.baseUrl.password().isEmpty()
        || this.baseUrl.query() != null
        || this.baseUrl.fragment() != null) {
      throw new IllegalArgumentException("인증 서버 주소에 계정 정보나 쿼리를 넣을 수 없어요.");
    }
    this.client =
        client
            .newBuilder()
            .retryOnConnectionFailure(false)
            .followRedirects(false)
            .followSslRedirects(false)
            .build();
  }

  @Override
  public Session signIn(String email, String password) throws Failure {
    Map<String, Object> input = emailInput(email);
    input.put("password", password);
    Map<String, Object> data = post("sessions", input, 201);
    Object rawUser = data.get("user");
    if (!(rawUser instanceof Map)) throw new Failure(Error.INVALID_RESPONSE);
    Map<?, ?> user = (Map<?, ?>) rawUser;
    String token = requiredString(data, "sessionToken");
    // 서버가 발급하는 32바이트 opaque 토큰의 base64url 형태만 전달해요.
    if (!token.matches("[A-Za-z0-9_-]{43}")) throw new Failure(Error.INVALID_RESPONSE);
    return new Session(
        token,
        requiredString(data, "expiresAt"),
        requiredString(user, "id"),
        requiredString(user, "email"),
        requiredString(user, "nickname"));
  }

  @Override
  public void register(String email, String password, String nickname) throws Failure {
    Map<String, Object> input = emailInput(email);
    input.put("password", password);
    input.put("nickname", nickname);
    expectStatus(post("registrations", input, 202), "verification_required");
  }

  @Override
  public void requestPasswordReset(String email) throws Failure {
    expectStatus(post("password-resets", emailInput(email), 202), "accepted");
  }

  @Override
  public void requestEmailVerification(String email) throws Failure {
    expectStatus(post("email-verifications", emailInput(email), 202), "accepted");
  }

  @Override
  public void cancel() {
    Call call = activeCall;
    if (call != null) call.cancel();
  }

  private Map<String, Object> post(String path, Map<String, Object> input, int expectedStatus)
      throws Failure {
    HttpUrl url = baseUrl.newBuilder().addPathSegments("v1/auth/" + path).build();
    Request request =
        new Request.Builder()
            .url(url)
            .header("Accept", "application/json")
            .post(RequestBody.create(adapter.toJson(input), JSON))
            .build();
    Call call = client.newCall(request);
    activeCall = call;
    try (Response response = call.execute()) {
      if (response.code() == 429)
        throw new Failure(Error.RATE_LIMITED, retryAfterSeconds(response.header("Retry-After")));
      if (response.code() >= 500 || response.code() == 404 || response.isRedirect())
        throw new Failure(Error.UNAVAILABLE);
      ResponseBody body = response.body();
      if (body == null) throw new Failure(Error.INVALID_RESPONSE);
      Map<String, Object> data;
      try {
        data = adapter.fromJson(body.source());
      } catch (JsonDataException | JsonEncodingException error) {
        throw new Failure(Error.INVALID_RESPONSE);
      }
      if (data == null) throw new Failure(Error.INVALID_RESPONSE);
      if (response.code() != expectedStatus) throw responseFailure(response.code(), data);
      return data;
    } catch (IOException error) {
      throw new Failure(Error.NETWORK);
    } finally {
      if (activeCall == call) activeCall = null;
    }
  }

  private static Failure responseFailure(int status, Map<String, Object> data) {
    Object rawError = data.get("error");
    Object code = rawError instanceof Map ? ((Map<?, ?>) rawError).get("code") : null;
    if (status == 401 && "INVALID_CREDENTIALS".equals(code))
      return new Failure(Error.INVALID_CREDENTIALS);
    if (status == 403 && "EMAIL_VERIFICATION_REQUIRED".equals(code))
      return new Failure(Error.EMAIL_VERIFICATION_REQUIRED);
    if (status == 400 && "INVALID_INPUT".equals(code)) return new Failure(Error.INVALID_INPUT);
    return new Failure(Error.UNAVAILABLE);
  }

  private static long retryAfterSeconds(String value) {
    if (value == null || !value.matches("[0-9]+")) return 0;
    try {
      return Long.parseLong(value);
    } catch (NumberFormatException error) {
      return 0;
    }
  }

  private static void expectStatus(Map<String, Object> data, String status) throws Failure {
    if (!status.equals(data.get("status"))) throw new Failure(Error.INVALID_RESPONSE);
  }

  private static String requiredString(Map<?, ?> data, String field) throws Failure {
    Object value = data.get(field);
    if (!(value instanceof String) || ((String) value).isEmpty())
      throw new Failure(Error.INVALID_RESPONSE);
    return (String) value;
  }

  private static Map<String, Object> emailInput(String email) {
    Map<String, Object> input = new LinkedHashMap<>();
    input.put("email", email);
    return input;
  }
}
