package kr.ac.ssu.qletter.auth;

import static org.junit.Assert.*;

import com.squareup.moshi.Moshi;
import java.io.IOException;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okhttp3.mockwebserver.SocketPolicy;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class AuthClientTest {
  private MockWebServer server;
  private AuthClient client;
  private static final String TOKEN = "a".repeat(43);

  @Before
  public void 준비해요() throws IOException {
    server = new MockWebServer();
    server.start();
    client = new AuthClient(server.url("/").toString());
  }

  @After
  public void 정리해요() throws IOException {
    server.shutdown();
  }

  @Test
  public void 로그인_응답을_반환하고_비밀번호를_변형하지_않아요() throws Exception {
    server.enqueue(new MockResponse().setResponseCode(201).setBody(sessionJson()));
    String password = " 비밀번호는  공백까지 그대로 ";
    AuthApi.Session session = client.signIn("reader@example.com", password);
    assertEquals(TOKEN, session.token);
    assertEquals("읽는사람", session.nickname);
    RecordedRequest request = server.takeRequest(1, TimeUnit.SECONDS);
    assertNotNull(request);
    assertEquals("POST", request.getMethod());
    assertEquals("/v1/auth/sessions", request.getPath());
    Map<?, ?> body =
        new Moshi.Builder().build().adapter(Map.class).fromJson(request.getBody().readUtf8());
    assertEquals(password, body.get("password"));
    assertEquals(2, body.size());
  }

  @Test
  public void 가입은_이메일_확인_접수만_성공으로_받아요() throws Exception {
    server.enqueue(
        new MockResponse().setResponseCode(202).setBody("{\"status\":\"verification_required\"}"));
    client.register("reader@example.com", "password with spaces", "읽는사람");
    RecordedRequest request = server.takeRequest(1, TimeUnit.SECONDS);
    assertEquals("/v1/auth/registrations", request.getPath());
    Map<?, ?> body =
        new Moshi.Builder().build().adapter(Map.class).fromJson(request.getBody().readUtf8());
    assertEquals(3, body.size());
    assertEquals("읽는사람", body.get("nickname"));
    assertFalse(body.containsKey("passwordConfirmation"));
    server.enqueue(
        new MockResponse().setResponseCode(200).setBody("{\"status\":\"verification_required\"}"));
    assertThrows(
        AuthApi.Failure.class,
        () -> client.register("reader@example.com", "password with spaces", "읽는사람"));
  }

  @Test
  public void 확인과_복구_메일은_접수_계약을_사용해요() throws Exception {
    server.enqueue(new MockResponse().setResponseCode(202).setBody("{\"status\":\"accepted\"}"));
    client.requestPasswordReset("reader@example.com");
    assertEquals("/v1/auth/password-resets", server.takeRequest(1, TimeUnit.SECONDS).getPath());
    server.enqueue(new MockResponse().setResponseCode(202).setBody("{\"status\":\"accepted\"}"));
    client.requestEmailVerification("reader@example.com");
    assertEquals("/v1/auth/email-verifications", server.takeRequest(1, TimeUnit.SECONDS).getPath());
  }

  @Test
  public void 인증_오류를_구분하고_서버의_비밀_문구는_보존하지_않아요() {
    int[] statuses = {401, 403, 400, 429, 503, 404};
    String[] codes = {
      "INVALID_CREDENTIALS",
      "EMAIL_VERIFICATION_REQUIRED",
      "INVALID_INPUT",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
      "NOT_FOUND"
    };
    AuthApi.Error[] errors = {
      AuthApi.Error.INVALID_CREDENTIALS,
      AuthApi.Error.EMAIL_VERIFICATION_REQUIRED,
      AuthApi.Error.INVALID_INPUT,
      AuthApi.Error.RATE_LIMITED,
      AuthApi.Error.UNAVAILABLE,
      AuthApi.Error.UNAVAILABLE
    };
    for (int index = 0; index < statuses.length; index++) {
      server.enqueue(
          new MockResponse()
              .setResponseCode(statuses[index])
              .setBody(
                  "{\"error\":{\"code\":\"" + codes[index] + "\",\"message\":\"private-token\"}}"));
      AuthApi.Failure failure =
          assertThrows(
              AuthApi.Failure.class,
              () -> client.signIn("reader@example.com", "password with spaces"));
      assertEquals(errors[index], failure.error);
      assertFalse(failure.toString().contains("private-token"));
      assertNull(failure.getCause());
    }
  }

  @Test
  public void redirect에_비밀번호를_다시_보내지_않아요() {
    server.enqueue(
        new MockResponse().setResponseCode(307).setHeader("Location", server.url("/other")));
    AuthApi.Failure failure =
        assertThrows(
            AuthApi.Failure.class,
            () -> client.signIn("reader@example.com", "password with spaces"));
    assertEquals(AuthApi.Error.UNAVAILABLE, failure.error);
    assertEquals(1, server.getRequestCount());
  }

  @Test
  public void 요청_제한의_대기_시간을_전달하고_자동_재시도하지_않아요() {
    server.enqueue(new MockResponse().setResponseCode(429).setHeader("Retry-After", "60"));
    AuthApi.Failure failure =
        assertThrows(
            AuthApi.Failure.class, () -> client.requestEmailVerification("reader@example.com"));
    assertEquals(AuthApi.Error.RATE_LIMITED, failure.error);
    assertEquals(60, failure.retryAfterSeconds);
    assertEquals(1, server.getRequestCount());
  }

  @Test
  public void 잘못된_성공_응답을_로그인으로_표시하지_않아요() {
    for (String body :
        new String[] {
          "null",
          "[]",
          "{}",
          "not json",
          sessionJson().replace(TOKEN, "bad-token"),
          sessionJson().replace("\"nickname\":\"읽는사람\"", "\"nickname\":true")
        }) {
      server.enqueue(new MockResponse().setResponseCode(201).setBody(body));
      assertEquals(
          AuthApi.Error.INVALID_RESPONSE,
          assertThrows(
                  AuthApi.Failure.class,
                  () -> client.signIn("reader@example.com", "password with spaces"))
              .error);
    }
  }

  @Test
  public void 요청을_받은_뒤_연결이_끊겨도_자동_재전송하지_않아요() {
    server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST));
    assertEquals(
        AuthApi.Error.NETWORK,
        assertThrows(
                AuthApi.Failure.class,
                () -> client.signIn("reader@example.com", "password with spaces"))
            .error);
    assertEquals(1, server.getRequestCount());
  }

  @Test
  public void 응답_시간_초과는_잘못된_비밀번호와_구분해요() {
    server.enqueue(
        new MockResponse()
            .setResponseCode(201)
            .setBody(sessionJson())
            .setHeadersDelay(500, TimeUnit.MILLISECONDS));
    AuthClient bounded =
        new AuthClient(
            server.url("/").toString(),
            new OkHttpClient.Builder().callTimeout(100, TimeUnit.MILLISECONDS).build());
    assertEquals(
        AuthApi.Error.NETWORK,
        assertThrows(
                AuthApi.Failure.class,
                () -> bounded.signIn("reader@example.com", "password with spaces"))
            .error);
  }

  @Test
  public void 응답_본문을_기다리다_시간이_초과해도_네트워크_오류로_알려요() {
    server.enqueue(
        new MockResponse()
            .setResponseCode(201)
            .setBody(sessionJson())
            .setBodyDelay(500, TimeUnit.MILLISECONDS));
    AuthClient bounded =
        new AuthClient(
            server.url("/").toString(),
            new OkHttpClient.Builder().callTimeout(100, TimeUnit.MILLISECONDS).build());
    assertEquals(
        AuthApi.Error.NETWORK,
        assertThrows(
                AuthApi.Failure.class,
                () -> bounded.signIn("reader@example.com", "password with spaces"))
            .error);
    assertEquals(1, server.getRequestCount());
  }

  private static String sessionJson() {
    return "{\"sessionToken\":\""
        + TOKEN
        + "\",\"expiresAt\":\"2026-11-30T00:00:00Z\",\"user\":{\"id\":\"00000000-0000-4000-8000-000000000001\",\"email\":\"reader@example.com\",\"nickname\":\"읽는사람\"}}";
  }
}
