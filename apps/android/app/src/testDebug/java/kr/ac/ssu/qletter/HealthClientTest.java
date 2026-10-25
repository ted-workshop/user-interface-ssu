package kr.ac.ssu.qletter;

import static org.junit.Assert.*;

import java.io.IOException;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class HealthClientTest {
  private MockWebServer server;

  @Before
  public void setup() throws IOException {
    server = new MockWebServer();
    server.start();
  }

  @After
  public void teardown() throws IOException {
    server.shutdown();
  }

  @Test
  public void acceptsOnlyTheQletterHealthContract() throws Exception {
    server.enqueue(new MockResponse().setBody("{\"status\":\"ok\",\"service\":\"qletter-api\"}"));
    new HealthClient(server.url("/").toString()).check();
    RecordedRequest request = server.takeRequest(1, TimeUnit.SECONDS);
    assertNotNull(request);
    assertEquals("/health", request.getPath());
  }

  @Test
  public void rejectsHttpFailure() {
    server.enqueue(new MockResponse().setResponseCode(503).setBody("unavailable"));
    assertThrows(IOException.class, () -> new HealthClient(server.url("/").toString()).check());
  }

  @Test
  public void rejectsIncorrectServiceAndMalformedResponses() {
    for (String body :
        new String[] {
          "{\"status\":\"ok\",\"service\":\"other\"}",
          "{\"status\":\"failed\",\"service\":\"qletter-api\"}",
          "{\"status\":true,\"service\":\"qletter-api\"}",
          "not json",
          "[]",
          "{}",
          "null"
        }) {
      server.enqueue(new MockResponse().setBody(body));
      assertThrows(IOException.class, () -> new HealthClient(server.url("/").toString()).check());
    }
  }

  @Test
  public void timesOutInsteadOfWaitingForever() {
    server.enqueue(
        new MockResponse()
            .setBody("{\"status\":\"ok\",\"service\":\"qletter-api\"}")
            .setBodyDelay(1, TimeUnit.SECONDS));
    OkHttpClient client =
        new OkHttpClient.Builder().callTimeout(100, TimeUnit.MILLISECONDS).build();
    assertThrows(
        IOException.class, () -> new HealthClient(server.url("/").toString(), client).check());
  }
}
