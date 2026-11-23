package kr.ac.ssu.qletter.collection;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import androidx.fragment.app.Fragment;
import androidx.fragment.app.FragmentManager;
import androidx.lifecycle.Lifecycle;
import androidx.recyclerview.widget.RecyclerView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Predicate;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.MainActivity;
import kr.ac.ssu.qletter.common.TestApi;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.After;
import org.junit.Before;
import org.junit.BeforeClass;
import org.junit.Test;
import org.junit.runner.RunWith;

/** 담기 시트가 저장 결과와 체크를 잃지 않는지 확인해요. 요청은 기기 안 테스트 서버로만 가요. */
@RunWith(AndroidJUnit4.class)
public class AddToCollectionSheetTest {
  private static final String TAG = "add_to_collection_sheet";

  private final List<String> writes = new CopyOnWriteArrayList<>();
  private final AtomicInteger results = new AtomicInteger();
  private MockWebServer server;
  private TestApi api;
  private volatile boolean secondFails;
  private volatile long writeDelay;

  @BeforeClass
  public static void 로컬_네트워크_권한을_미리_허용해요() {
    if (Build.VERSION.SDK_INT < 37) return;
    try {
      InstrumentationRegistry.getInstrumentation()
          .getUiAutomation()
          .grantRuntimePermission(
              InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName(),
              "android.permission.ACCESS_LOCAL_NETWORK");
    } catch (RuntimeException ignored) {
      // 권한을 선언하지 않은 빌드에서도 127.0.0.1 요청은 돼요.
    }
  }

  @Before
  public void 테스트_서버를_준비해요() throws Exception {
    server = new MockWebServer();
    server.setDispatcher(
        new Dispatcher() {
          @Override
          public MockResponse dispatch(RecordedRequest request) {
            String path = request.getPath();
            if ("PUT".equals(request.getMethod()) || "DELETE".equals(request.getMethod())) {
              writes.add(request.getMethod() + " " + path);
              MockResponse response =
                  secondFails && path.contains("/c2/")
                      ? new MockResponse().setResponseCode(500).setBody("{}")
                      : new MockResponse().setResponseCode(204);
              return response.setHeadersDelay(writeDelay, TimeUnit.MILLISECONDS);
            }
            if (!path.contains("/collections")) return new MockResponse().setBody("{}");
            return new MockResponse()
                .setBody(
                    "{\"items\":["
                        + collection("c0", true)
                        + ","
                        + collection("c1", false)
                        + ","
                        + collection("c2", false)
                        + "],\"nextCursor\":null}");
          }
        });
    server.start();
    api = new TestApi(server.getPort());
  }

  @After
  public void 테스트_서버를_정리해요() throws Exception {
    if (api != null) api.close();
    if (server != null) server.shutdown();
  }

  @Test
  public void 일부만_실패하면_바로_알리고_실패한_모음만_다시_보내요() {
    secondFails = true;
    try (ActivityScenario<MainActivity> screen = ActivityScenario.launch(MainActivity.class)) {
      listen(screen);
      open(screen);
      toggle(screen, 1);
      toggle(screen, 2);
      clickDone(screen);
      await(screen, activity -> results.get() == 1);
      await(
          screen,
          activity ->
              sheet(activity).requireView().findViewById(R.id.add_save_error).getVisibility()
                  == View.VISIBLE);
      assertEquals(2, writes.size());

      secondFails = false;
      writes.clear();
      clickDone(screen);
      await(screen, activity -> sheet(activity) == null);
      assertEquals(1, writes.size());
      assertEquals("PUT /v1/collections/c2/reports/r", writes.get(0));
      assertEquals(2, results.get());
    }
  }

  @Test
  public void 저장하지_않은_체크는_시트가_새로_만들어져도_남아요() {
    try (ActivityScenario<MainActivity> screen = ActivityScenario.launch(MainActivity.class)) {
      open(screen);
      toggle(screen, 0);
      toggle(screen, 1);

      // 앱이 정리됐다 돌아온 것처럼 저장 상태만 남기고 ViewModel까지 새로 만들어요.
      AtomicReference<Fragment.SavedState> state = new AtomicReference<>();
      screen.onActivity(
          activity -> {
            FragmentManager manager = activity.getSupportFragmentManager();
            state.set(manager.saveFragmentInstanceState(sheet(activity)));
            sheet(activity).dismissNow();
            AddToCollectionSheet restored = new AddToCollectionSheet();
            Bundle args = new Bundle();
            args.putString("reportId", "r");
            restored.setArguments(args);
            restored.setInitialSavedState(state.get());
            restored.showNow(manager, TAG);
          });
      await(screen, activity -> row(activity, 1) != null);
      screen.onActivity(
          activity -> {
            assertFalse(checked(activity, 0));
            assertTrue(checked(activity, 1));
            assertFalse(checked(activity, 2));
          });
      assertTrue(writes.isEmpty());
    }
  }

  @Test
  public void 저장_중_홈과_회전을_거쳐도_결과는_한_번만_가요() {
    writeDelay = 1500;
    try (ActivityScenario<MainActivity> screen = ActivityScenario.launch(MainActivity.class)) {
      listen(screen);
      open(screen);
      toggle(screen, 1);
      clickDone(screen);
      screen.moveToState(Lifecycle.State.CREATED);
      SystemClock.sleep(2500);
      screen.moveToState(Lifecycle.State.RESUMED);
      await(screen, activity -> sheet(activity) == null);

      screen.recreate();
      listen(screen);
      InstrumentationRegistry.getInstrumentation().waitForIdleSync();
      assertEquals(1, results.get());
      assertEquals(1, writes.size());
    }
  }

  private static String collection(String id, boolean contains) {
    return "{\"id\":\""
        + id
        + "\",\"name\":\""
        + id
        + "\",\"reportCount\":0,\"containsReport\":"
        + contains
        + "}";
  }

  private void listen(ActivityScenario<MainActivity> screen) {
    screen.onActivity(
        activity ->
            activity
                .getSupportFragmentManager()
                .setFragmentResultListener(
                    AddToCollectionSheet.REQUEST_KEY,
                    activity,
                    (key, result) -> results.incrementAndGet()));
  }

  private static void open(ActivityScenario<MainActivity> screen) {
    screen.onActivity(
        activity -> AddToCollectionSheet.open(activity.getSupportFragmentManager(), "r"));
    await(screen, activity -> row(activity, 2) != null);
  }

  private static void toggle(ActivityScenario<MainActivity> screen, int position) {
    screen.onActivity(activity -> row(activity, position).performClick());
    await(screen, activity -> row(activity, position) != null);
  }

  private static void clickDone(ActivityScenario<MainActivity> screen) {
    screen.onActivity(
        activity ->
            sheet(activity).requireView().findViewById(R.id.add_done_button).performClick());
  }

  private static AddToCollectionSheet sheet(MainActivity activity) {
    return (AddToCollectionSheet) activity.getSupportFragmentManager().findFragmentByTag(TAG);
  }

  private static View row(MainActivity activity, int position) {
    AddToCollectionSheet sheet = sheet(activity);
    if (sheet == null || sheet.getView() == null) return null;
    RecyclerView list = sheet.getView().findViewById(R.id.add_collections_list);
    RecyclerView.ViewHolder holder = list.findViewHolderForAdapterPosition(position);
    return holder == null ? null : holder.itemView.findViewById(R.id.check_row);
  }

  @SuppressWarnings("deprecation") // API 36 전 기기에서도 읽히는 isChecked로 확인해요.
  private static boolean checked(MainActivity activity, int position) {
    return row(activity, position).createAccessibilityNodeInfo().isChecked();
  }

  private static void await(
      ActivityScenario<MainActivity> screen, Predicate<MainActivity> condition) {
    long deadline = SystemClock.uptimeMillis() + 10_000;
    AtomicBoolean met = new AtomicBoolean();
    while (true) {
      screen.onActivity(activity -> met.set(condition.test(activity)));
      if (met.get()) return;
      if (SystemClock.uptimeMillis() > deadline) throw new AssertionError("화면이 바뀌지 않았어요.");
      SystemClock.sleep(50);
    }
  }
}
