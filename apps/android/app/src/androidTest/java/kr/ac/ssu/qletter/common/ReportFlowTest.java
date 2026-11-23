package kr.ac.ssu.qletter.common;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.*;
import static androidx.test.espresso.assertion.ViewAssertions.doesNotExist;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.*;
import static org.hamcrest.Matchers.containsString;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

import android.graphics.Bitmap;
import android.os.Build;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import kr.ac.ssu.qletter.BuildConfig;
import kr.ac.ssu.qletter.R;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/** 전용 debug 주소로 빌드한 테스트 APK에서만 실행해 실제 서버·계정에는 요청하지 않아요. */
@RunWith(AndroidJUnit4.class)
public class ReportFlowTest {
  private MockWebServer server;
  private QletterApplication app;
  private final AtomicInteger listCalls = new AtomicInteger();
  private volatile boolean fail;
  private volatile boolean empty;
  private volatile boolean missing;
  private volatile long delay;
  private static final String FIRST = "11111111-1111-4111-8111-111111111111";
  private static final String SECOND = "22222222-2222-4222-8222-222222222222";

  @Before
  public void prepare() throws Exception {
    assumeTrue("기기 검사는 전용 로컬 주소로 빌드해요", BuildConfig.API_BASE_URL.equals("http://127.0.0.1:3000/"));
    app =
        (QletterApplication)
            InstrumentationRegistry.getInstrumentation().getTargetContext().getApplicationContext();
    if (Build.VERSION.SDK_INT >= 37)
      InstrumentationRegistry.getInstrumentation()
          .getUiAutomation()
          .grantRuntimePermission(app.getPackageName(), "android.permission.ACCESS_LOCAL_NETWORK");
    server = new MockWebServer();
    server.setDispatcher(
        new Dispatcher() {
          @Override
          public MockResponse dispatch(RecordedRequest request) {
            String path = request.getRequestUrl().encodedPath();
            if (path.equals("/v1/me")) return json("{}");
            if (path.equals("/v1/collections")) return json("{\"items\":[],\"nextCursor\":null}");
            if (path.equals("/v1/reports")) {
              listCalls.incrementAndGet();
              if (fail) return json("{}").setResponseCode(503);
              if (empty || request.getRequestUrl().queryParameter("q") != null)
                return json("{\"items\":[],\"nextCursor\":null}");
              boolean next = request.getRequestUrl().queryParameter("cursor") != null;
              return json("{\"items\":["
                      + report(next ? SECOND : FIRST, next ? "두 번째 리포트" : "첫 번째 리포트", false)
                      + "],\"nextCursor\":"
                      + (next ? "null" : "\"next-page\"")
                      + "}")
                  .setBodyDelay(delay, TimeUnit.MILLISECONDS);
            }
            if (path.startsWith("/v1/reports/")) {
              if (missing) return json("{}").setResponseCode(404);
              return json(report(FIRST, "첫 번째 리포트", true));
            }
            return json("{}").setResponseCode(404);
          }
        });
    server.start(3000);
    CountDownLatch signedIn = new CountDownLatch(1);
    app.sessions()
        .signInAsync(
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "2099-01-01T00:00:00Z",
            failure -> {
              assertNull(failure);
              signedIn.countDown();
            });
    assertTrue(signedIn.await(10, TimeUnit.SECONDS));
    InstrumentationRegistry.getInstrumentation().waitForIdleSync();
  }

  @After
  public void cleanup() throws Exception {
    if (app != null) app.sessions().clear();
    if (server != null) server.shutdown();
  }

  private static MockResponse json(String body) {
    return new MockResponse().setHeader("Content-Type", "application/json").setBody(body);
  }

  private static String report(String id, String title, boolean detail) {
    return "{\"id\":\""
        + id
        + "\",\"title\":\""
        + title
        + "\",\"channelName\":null,\"channelUrl\":null,\"videoId\":\"jNQXAC9IVRw\",\"timestampVerification\":\"unverified\",\"createdAt\":\"2026-11-21T00:00:00.000Z\",\"viewerContext\":{\"origin\":\"direct\",\"deliveryStatus\":\"not_applicable\",\"savedAt\":\"2026-11-21T00:00:00.000Z\"}"
        + (detail
            ? ",\"bodyMarkdown\":\"# 핵심 요약\\n\\n**기기 검증 본문**\\n\\n[장면 보기](https://www.youtube.com/watch?v=jNQXAC9IVRw&t=30)\""
            : "")
        + "}";
  }

  @Test
  public void 페이지_추가와_회전_상세_뒤로가기에_목록을_유지해요() throws Exception {
    try (ActivityScenario<MainActivity> screen = ActivityScenario.launch(MainActivity.class)) {
      onView(withId(R.id.tab_reports)).perform(click());
      awaitText("첫 번째 리포트");
      capture("reports-list");
      onView(withId(R.id.report_more)).perform(click());
      awaitText("두 번째 리포트");
      screen.recreate();
      awaitText("두 번째 리포트");
      assertEquals(2, listCalls.get());
      onView(withText("첫 번째 리포트")).perform(click());
      awaitCheck(
          () ->
              onView(withId(R.id.detail_body))
                  .check(matches(withText(containsString("기기 검증 본문")))));
      capture("report-detail");
      screen.recreate();
      screen.recreate();
      awaitCheck(
          () ->
              onView(withId(R.id.detail_body))
                  .check(matches(withText(containsString("기기 검증 본문")))));
      onView(withId(R.id.report_back)).perform(click());
      awaitText("두 번째 리포트");
      assertEquals(2, listCalls.get());
    }
  }

  @Test
  public void 빈_목록과_검색_결과_없음을_구분하고_초기화해요() throws Exception {
    empty = true;
    try (ActivityScenario<MainActivity> screen = ActivityScenario.launch(MainActivity.class)) {
      onView(withId(R.id.tab_reports)).perform(click());
      awaitCheck(
          () ->
              onView(withId(R.id.report_message)).check(matches(withText(R.string.report_empty))));
      capture("reports-empty");
      onView(withId(R.id.report_search)).perform(replaceText("없는 제목"), closeSoftKeyboard());
      onView(withId(R.id.report_search_button)).perform(click());
      awaitCheck(
          () ->
              onView(withId(R.id.report_message))
                  .check(matches(withText(R.string.report_no_matches))));
      capture("reports-no-matches");
      empty = false;
      onView(withId(R.id.report_reset)).perform(click());
      awaitText("첫 번째 리포트");
    }
  }

  @Test
  public void 실패_재시도와_모음_진입을_확인해요() throws Exception {
    fail = true;
    try (ActivityScenario<MainActivity> screen = ActivityScenario.launch(MainActivity.class)) {
      onView(withId(R.id.tab_reports)).perform(click());
      awaitCheck(() -> onView(withId(R.id.report_retry)).check(matches(isDisplayed())));
      capture("reports-error");
      fail = false;
      onView(withId(R.id.report_retry)).perform(click());
      awaitText("첫 번째 리포트");
      capture("reports-retry-success");
      onView(withText(R.string.report_collections)).perform(click());
      awaitCheck(() -> onView(withId(R.id.new_collection_button)).check(matches(isDisplayed())));
      screen.recreate();
      onView(withId(R.id.new_collection_button)).check(matches(isDisplayed()));
      capture("reports-collections");
      screen.recreate();
      onView(withText(R.string.report_mine)).perform(click());
      awaitText("첫 번째 리포트");
    }
  }

  @Test
  public void 상세_권한_없음을_안내하고_늦은_목록은_로그아웃_뒤_노출하지_않아요() throws Exception {
    missing = true;
    try (ActivityScenario<MainActivity> screen = ActivityScenario.launch(MainActivity.class)) {
      onView(withId(R.id.tab_reports)).perform(click());
      awaitText("첫 번째 리포트");
      onView(withText("첫 번째 리포트")).perform(click());
      awaitCheck(
          () ->
              onView(withId(R.id.detail_message))
                  .check(matches(withText(R.string.report_not_found))));
      capture("report-no-access");
      onView(withId(R.id.report_back)).perform(click());
      delay = 1000;
      onView(withId(R.id.report_search_button)).perform(click());
      capture("reports-loading");
      app.sessions().clear();
      awaitCheck(() -> onView(withId(R.id.login_email)).check(matches(isDisplayed())));
      Thread.sleep(1200);
      onView(withId(R.id.login_email)).check(matches(isDisplayed()));
      onView(withId(R.id.tab_reports)).check(doesNotExist());
      capture("reports-signed-out");
    }
  }

  private static void awaitText(String text) throws Exception {
    awaitCheck(() -> onView(withText(text)).check(matches(isDisplayed())));
  }

  private static void awaitCheck(Runnable assertion) throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (true) {
      try {
        assertion.run();
        return;
      } catch (AssertionError | androidx.test.espresso.NoMatchingViewException pending) {
        if (System.nanoTime() >= deadline) throw pending;
        Thread.sleep(50);
      }
    }
  }

  private void capture(String name) throws Exception {
    InstrumentationRegistry.getInstrumentation().waitForIdleSync();
    Bitmap image = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
    File folder = new File(app.getExternalFilesDir(null), "report-check");
    assertTrue(folder.isDirectory() || folder.mkdirs());
    try (FileOutputStream output = new FileOutputStream(new File(folder, name + ".png"))) {
      assertTrue(image.compress(Bitmap.CompressFormat.PNG, 100, output));
    } finally {
      image.recycle();
    }
  }
}
