package kr.ac.ssu.qletter;

import static org.junit.Assert.*;

import java.io.IOException;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class QletterApiTest {
  private final MockWebServer server = new MockWebServer();
  private final Session first = new Session("first-test-token", Long.MAX_VALUE);
  private volatile Session active = first;
  private QletterApi api;

  @Before
  public void 서버를_준비해요() throws IOException {
    server.start();
    api =
        new QletterApi(
            server.url("/api/").toString(),
            new QletterApi.Sessions() {
              @Override
              public Session current() {
                return active;
              }

              @Override
              public void invalidate(Session sent) {
                if (active == sent) active = null;
              }
            });
  }

  @After
  public void 서버를_닫아요() throws IOException {
    server.shutdown();
  }

  private Call request() {
    return api.newCall(new Request.Builder().url(api.endpoint("me").build()).build());
  }

  @Test
  public void 개인_요청에_해당_서버의_토큰을_보내요() throws Exception {
    server.enqueue(new MockResponse().setResponseCode(200));
    try (Response response = request().execute()) {
      assertEquals(200, response.code());
    }
    RecordedRequest sent = server.takeRequest(1, TimeUnit.SECONDS);
    assertNotNull(sent);
    assertEquals("/api/v1/me", sent.getPath());
    assertEquals("Bearer first-test-token", sent.getHeader("Authorization"));
  }

  @Test
  public void 지정한_서버와_제품_경로_밖의_요청을_거절해요() {
    assertThrows(
        IllegalArgumentException.class,
        () -> api.newCall(new Request.Builder().url("https://example.com/api/v1/me").build()));
    assertThrows(
        IllegalArgumentException.class,
        () -> api.newCall(new Request.Builder().url(server.url("/elsewhere")).build()));
    assertEquals(0, server.getRequestCount());
  }

  @Test
  public void 리디렉션에_토큰을_재전송하지_않아요() throws Exception {
    server.enqueue(
        new MockResponse().setResponseCode(302).addHeader("Location", server.url("/elsewhere")));
    try (Response response = request().execute()) {
      assertEquals(302, response.code());
    }
    assertEquals(1, server.getRequestCount());
  }

  @Test
  public void 로그아웃_상태에서는_개인_요청을_전송하지_않아요() {
    active = null;
    Call call = request();
    assertThrows(IOException.class, call::execute);
    assertEquals(0, server.getRequestCount());
  }

  @Test
  public void 계정_전환_전에_만든_요청을_새_계정으로_보내지_않아요() {
    Call call = request();
    active = new Session("next-test-token", Long.MAX_VALUE);
    assertThrows(IOException.class, call::execute);
    assertEquals(0, server.getRequestCount());
  }

  @Test
  public void 현재_세션의_401은_로그인_상태를_해제해요() throws Exception {
    server.enqueue(new MockResponse().setResponseCode(401));
    try (Response response = request().execute()) {
      assertEquals(401, response.code());
    }
    assertNull(active);
  }

  @Test
  public void 이전_계정의_늦은_401은_새_계정을_해제하지_않아요() {
    Session replacement = new Session("next-test-token", Long.MAX_VALUE);
    server.setDispatcher(
        new Dispatcher() {
          @Override
          public MockResponse dispatch(RecordedRequest ignored) {
            active = replacement;
            return new MockResponse().setResponseCode(401);
          }
        });
    assertThrows(IOException.class, request()::execute);
    assertSame(replacement, active);
  }

  @Test
  public void 서버_일시_오류에서_세션을_유지해요() throws Exception {
    server.enqueue(new MockResponse().setResponseCode(503));
    try (Response response = request().execute()) {
      assertEquals(503, response.code());
    }
    assertSame(first, active);
  }
}
