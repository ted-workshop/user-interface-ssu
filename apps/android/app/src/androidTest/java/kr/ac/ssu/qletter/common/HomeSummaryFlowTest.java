package kr.ac.ssu.qletter.common;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.*;
import static androidx.test.espresso.assertion.ViewAssertions.*;
import static androidx.test.espresso.matcher.ViewMatchers.*;
import static org.hamcrest.Matchers.containsString;
import static org.junit.Assert.*;

import android.graphics.Bitmap;
import android.os.Build;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import kr.ac.ssu.qletter.R;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/** 기기 안의 HTTP 서버만 사용해요. Gemini·SMTP 성공을 대신하는 검사는 아니에요. */
@RunWith(AndroidJUnit4.class)
public class HomeSummaryFlowTest {
  private static final String REQUEST = "11111111-1111-4111-8111-111111111111";
  private static final String REPORT = "22222222-2222-4222-8222-222222222222";
  private static final String CHECK = "33333333-3333-4333-8333-333333333333";
  private static final String NEXT_CHECK = "44444444-4444-4444-8444-444444444444";
  private static final String VIDEO = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
  private MockWebServer server;
  private TestApi api;
  private volatile String status = "queued";
  private volatile boolean accepted;
  private volatile boolean readFailure;
  private volatile boolean homeFailure;
  private volatile boolean checkCompleted;
  private volatile boolean lostSubmission;
  private volatile String retryBody;
  private final AtomicInteger submissions = new AtomicInteger();
  private final AtomicInteger retries = new AtomicInteger();
  private final AtomicInteger reads = new AtomicInteger();
  private final AtomicInteger checks = new AtomicInteger();

  @Before
  public void 로컬_서버와_테스트_세션을_준비해요() throws Exception {
    if (Build.VERSION.SDK_INT >= 37)
      InstrumentationRegistry.getInstrumentation()
          .getUiAutomation()
          .grantRuntimePermission(
              InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName(),
              "android.permission.ACCESS_LOCAL_NETWORK");
    server = new MockWebServer();
    server.setDispatcher(
        new Dispatcher() {
          @Override
          public MockResponse dispatch(RecordedRequest request) {
            String path = request.getRequestUrl().encodedPath();
            if (path.equals("/v1/me")) return json("{\"nickname\":\"홈요약검증\"}");
            if (path.equals("/v1/dashboard")) {
              if (homeFailure) return json("{}").setResponseCode(503);
              return json(
                  "{\"recentReports\":["
                      + report(false)
                      + "],\"activeChannelCount\":2,\"summaryCounts\":{\"queued\":1,\"running\":0,\"failed\":0},\"deliveryCounts\":{\"pending\":0,\"failed\":1},\"lastCheckedAt\":null,\"nextCheckAt\":null}");
            }
            if (path.equals("/v1/reports/" + REPORT)) return json(report(true));
            // #90에서 상세에 붙인 댓글 영역도 정상 응답으로 열어요.
            if (path.equals("/v1/reports/" + REPORT + "/comments"))
              return json("{\"items\":[],\"nextCursor\":null}");
            if (path.equals("/v1/summary-requests") && request.getMethod().equals("POST")) {
              submissions.incrementAndGet();
              accepted = true;
              if (lostSubmission)
                return json("{\"error\":{\"code\":\"INTERNAL_ERROR\"}}").setResponseCode(500);
              return json(summary()).setResponseCode(202).setBodyDelay(200, TimeUnit.MILLISECONDS);
            }
            if (path.equals("/v1/summary-requests"))
              return json("{\"items\":[" + (accepted ? summary() : "") + "],\"nextCursor\":null}");
            if (path.equals("/v1/summary-requests/" + REQUEST + "/retry")) {
              retryBody = request.getBody().readUtf8();
              retries.incrementAndGet();
              status = "queued";
              return json(summary()).setResponseCode(202);
            }
            if (path.equals("/v1/summary-requests/" + REQUEST)) {
              reads.incrementAndGet();
              if (readFailure)
                return json("{\"error\":{\"code\":\"RATE_LIMITED\"}}")
                    .setResponseCode(429)
                    .addHeader("Retry-After", "8");
              return json(summary());
            }
            if (path.equals("/v1/channel-checks")) {
              checks.incrementAndGet();
              return json(check(CHECK, "queued", null)).setResponseCode(202);
            }
            if (path.equals("/v1/channel-checks/" + CHECK))
              return json(
                  check(
                      CHECK,
                      checkCompleted ? "completed" : "running",
                      checkCompleted ? NEXT_CHECK : null));
            if (path.equals("/v1/channel-checks/" + NEXT_CHECK))
              return json(check(NEXT_CHECK, "completed", null));
            return json("{}").setResponseCode(404);
          }
        });
    server.start();
    api = new TestApi(server.getPort());
  }

  @After
  public void 테스트_세션과_서버를_정리해요() throws Exception {
    if (api != null) api.close();
    if (server != null) server.shutdown();
  }

  @Test
  public void 접수는_한번만_하고_회전과_탭_왕복_뒤_완료_리포트를_읽어요() throws Exception {
    try (ActivityScenario<MainActivity> screen = ActivityScenario.launch(MainActivity.class)) {
      await(
          () ->
              onView(withId(R.id.home_counts))
                  .check(matches(withText(containsString("활성 채널 2개")))));
      capture("home-success");
      onView(withText("로컬 확인 리포트")).perform(scrollTo(), click());
      await(
          () ->
              onView(withId(R.id.detail_body)).check(matches(withText(containsString("확인용 본문")))));
      screen.recreate();
      onView(withId(R.id.report_back)).perform(click());
      await(() -> onView(withId(R.id.home_title)).check(matches(isDisplayed())));
      onView(withId(R.id.tab_summary)).perform(click());
      capture("summary-initial");
      onView(withId(R.id.summary_url)).perform(replaceText(VIDEO), closeSoftKeyboard());
      onView(withId(R.id.summary_submit)).perform(scrollTo(), click());
      await(
          () ->
              onView(withId(R.id.summary_status))
                  .check(matches(withText(R.string.summary_queued))));
      screen.recreate();
      onView(withId(R.id.summary_status)).perform(scrollTo());
      capture("summary-queued");
      onView(withId(R.id.tab_home)).perform(click());
      onView(withId(R.id.tab_summary)).perform(click());
      assertEquals(1, submissions.get());
      status = "completed";
      await(
          () ->
              onView(withId(R.id.summary_status))
                  .check(matches(withText(R.string.summary_completed))));
      onView(withId(R.id.summary_status)).perform(scrollTo());
      capture("summary-completed");
      onView(withId(R.id.summary_read)).perform(scrollTo(), click());
      await(
          () ->
              onView(withId(R.id.detail_body)).check(matches(withText(containsString("확인용 본문")))));
      onView(withId(R.id.report_back)).perform(click());
      await(
          () ->
              onView(withId(R.id.summary_status))
                  .check(matches(withText(R.string.summary_completed))));
      assertEquals(1, submissions.get());
    }
  }

  @Test
  public void 상태_조회_오류는_GET으로_복구하고_분석_재시도에_관찰한_번호를_보내요() throws Exception {
    accepted = true;
    status = "failed";
    try (ActivityScenario<MainActivity> screen = ActivityScenario.launch(MainActivity.class)) {
      onView(withId(R.id.tab_summary)).perform(click());
      await(
          () ->
              onView(withId(R.id.summary_status))
                  .check(matches(withText(R.string.summary_failed))));
      onView(withId(R.id.summary_status)).perform(scrollTo());
      capture("summary-failed");
      readFailure = true;
      onView(withId(R.id.summary_refresh)).perform(scrollTo(), click());
      await(() -> assertEquals(1, reads.get()));
      await(
          () ->
              onView(withId(R.id.summary_error))
                  .check(matches(withText(R.string.summary_rate_limit))));
      onView(withId(R.id.summary_error)).perform(scrollTo());
      capture("summary-read-error");
      onView(withId(R.id.summary_refresh)).perform(scrollTo(), click());
      screen.moveToState(Lifecycle.State.CREATED);
      Thread.sleep(8500);
      assertEquals(1, reads.get());
      assertEquals(0, retries.get());
      readFailure = false;
      screen.moveToState(Lifecycle.State.RESUMED);
      onView(withId(R.id.summary_refresh)).perform(scrollTo(), click());
      await(() -> assertEquals(2, reads.get()));
      onView(withId(R.id.summary_retry)).perform(scrollTo(), click());
      await(() -> assertEquals(1, retries.get()));
      assertEquals("{\"attempt\":1}", retryBody);
      assertEquals(0, submissions.get());
      onView(withId(R.id.summary_status)).perform(scrollTo());
      capture("summary-retry");
    }
  }

  @Test
  public void 접수_응답을_잃으면_목록으로_복구하고_로그아웃_뒤_개인_내용을_남기지_않아요() throws Exception {
    lostSubmission = true;
    try (ActivityScenario<MainActivity> screen = ActivityScenario.launch(MainActivity.class)) {
      onView(withId(R.id.tab_summary)).perform(click());
      onView(withId(R.id.summary_url)).perform(replaceText(VIDEO), closeSoftKeyboard());
      onView(withId(R.id.summary_submit)).perform(scrollTo(), click());
      await(
          () ->
              onView(withId(R.id.summary_error))
                  .check(matches(withText(R.string.summary_submit_unknown))));
      onView(withId(R.id.summary_refresh)).perform(scrollTo(), click());
      await(
          () ->
              onView(withId(R.id.summary_status))
                  .check(matches(withText(R.string.summary_queued))));
      assertEquals(1, submissions.get());
      QletterApplication app =
          (QletterApplication)
              InstrumentationRegistry.getInstrumentation()
                  .getTargetContext()
                  .getApplicationContext();
      app.sessions().clear();
      await(() -> onView(withId(R.id.login_email)).check(matches(isDisplayed())));
      onView(withId(R.id.summary_status)).check(doesNotExist());
    }
  }

  @Test
  public void 홈_조회는_확인을_접수하지_않고_명시적_확인만_연속_작업을_조회해요() throws Exception {
    homeFailure = true;
    try (ActivityScenario<MainActivity> screen = ActivityScenario.launch(MainActivity.class)) {
      await(
          () -> onView(withId(R.id.home_error)).check(matches(withText(R.string.home_load_error))));
      capture("home-error");
      homeFailure = false;
      onView(withId(R.id.home_refresh)).perform(scrollTo(), click());
      await(
          () ->
              onView(withId(R.id.home_counts))
                  .check(matches(withText(containsString("활성 채널 2개")))));
      assertEquals(0, checks.get());
      onView(withId(R.id.home_check)).perform(scrollTo(), click());
      await(
          () ->
              onView(withId(R.id.home_check_status))
                  .check(matches(withText(R.string.home_check_pending))));
      screen.recreate();
      checkCompleted = true;
      await(
          () ->
              onView(withId(R.id.home_check_status))
                  .check(matches(withText(R.string.home_check_complete))));
      assertEquals(1, checks.get());
      onView(withId(R.id.home_check_status)).perform(scrollTo());
      capture("home-check-completed");
    }
  }

  private String summary() {
    return "{\"id\":\""
        + REQUEST
        + "\",\"videoId\":\"jNQXAC9IVRw\",\"url\":\""
        + VIDEO
        + "\",\"origin\":\"direct\",\"status\":\""
        + status
        + "\",\"attempt\":1,\"reportId\":"
        + (status.equals("completed") ? "\"" + REPORT + "\"" : "null")
        + ",\"failureCode\":"
        + (status.equals("failed") ? "\"temporary\"" : "null")
        + ",\"retryable\":"
        + status.equals("failed")
        + "}";
  }

  private static String check(String id, String status, String next) {
    return "{\"id\":\""
        + id
        + "\",\"status\":\""
        + status
        + "\",\"nextCheckId\":"
        + (next == null ? "null" : "\"" + next + "\"")
        + ",\"channels\":[]}";
  }

  private static String report(boolean detail) {
    return "{\"id\":\""
        + REPORT
        + "\",\"title\":\"로컬 확인 리포트\",\"channelName\":\"확인용 채널\",\"channelUrl\":null,\"videoId\":\"jNQXAC9IVRw\",\"timestampVerification\":\"unverified\",\"createdAt\":\"2026-11-25T00:00:00Z\",\"viewerContext\":{\"origin\":\"direct\",\"deliveryStatus\":\"not_applicable\",\"savedAt\":\"2026-11-25T00:00:00Z\"}"
        + (detail ? ",\"bodyMarkdown\":\"# 확인용 본문\"" : "")
        + "}";
  }

  private static MockResponse json(String text) {
    return new MockResponse().setHeader("Content-Type", "application/json").setBody(text);
  }

  private static void await(Runnable assertion) throws Exception {
    long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
    while (true) {
      try {
        assertion.run();
        return;
      } catch (AssertionError | androidx.test.espresso.NoMatchingViewException pending) {
        if (System.nanoTime() >= until) throw pending;
        Thread.sleep(50);
      }
    }
  }

  private static void capture(String name) throws Exception {
    Bitmap image = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
    assertNotNull(image);
    File directory =
        new File(
            InstrumentationRegistry.getInstrumentation()
                .getTargetContext()
                .getExternalFilesDir(null),
            "home-summary-check");
    assertTrue(directory.isDirectory() || directory.mkdirs());
    try (FileOutputStream out = new FileOutputStream(new File(directory, name + ".png"))) {
      assertTrue(image.compress(Bitmap.CompressFormat.PNG, 100, out));
    } finally {
      image.recycle();
    }
  }
}
