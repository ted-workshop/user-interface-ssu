package kr.ac.ssu.qletter.collection;

import static org.junit.Assert.assertEquals;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;
import android.view.View;
import android.widget.TextView;
import androidx.fragment.app.DialogFragment;
import androidx.recyclerview.widget.RecyclerView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Predicate;
import kr.ac.ssu.qletter.R;
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

/** 모음 상세가 리포트를 이어 받고, 빼기 결과를 잃거나 두 번 보내지 않는지 확인해요. 요청은 기기 안 테스트 서버로만 가요. */
@RunWith(AndroidJUnit4.class)
public class CollectionDetailActivityTest {
  // 모음에 담긴 리포트 수예요. 한 번에 20개씩 줘서 두 번 받아야 다 보여요.
  private static final int TOTAL = 25;

  private final List<String> removes = new CopyOnWriteArrayList<>();
  private final AtomicInteger lists = new AtomicInteger();
  private MockWebServer server;
  private TestApi api;
  private volatile long removeDelay;

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
            if ("DELETE".equals(request.getMethod())) {
              removes.add(request.getPath());
              return new MockResponse()
                  .setResponseCode(204)
                  .setHeadersDelay(removeDelay, TimeUnit.MILLISECONDS);
            }
            lists.incrementAndGet();
            // 서버처럼 담은 시각 최신순으로 20개를 주고, cursor가 있으면 그다음을 줘요.
            boolean next = request.getRequestUrl().queryParameter("cursor") != null;
            int from = next ? 20 : 0;
            int to = next ? TOTAL : 20;
            StringBuilder items = new StringBuilder();
            for (int i = from; i < to; i++)
              items.append(i == from ? "" : ",").append(report("r" + i, "리포트 " + i));
            String cursor = next ? "null" : "\"next\"";
            return new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("{\"items\":[" + items + "],\"nextCursor\":" + cursor + "}");
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
  public void 리포트_더_보기로_다음_리포트를_아래에_한_번씩만_붙여요() {
    try (ActivityScenario<CollectionDetailActivity> screen = open()) {
      await(screen, activity -> rows(activity) == 20);
      screen.onActivity(
          activity -> {
            assertEquals("리포트 0", title(activity, 0));
            View more = activity.findViewById(R.id.detail_more);
            assertEquals(View.VISIBLE, more.getVisibility());
            more.performClick();
            // 받는 동안 다시 눌러도 한 번만 보내요.
            more.performClick();
          });
      await(screen, activity -> rows(activity) == TOTAL);
      screen.onActivity(
          activity -> {
            assertEquals("리포트 24", title(activity, TOTAL - 1));
            assertEquals(View.GONE, activity.findViewById(R.id.detail_more).getVisibility());
          });
      assertEquals(2, lists.get());
    }
  }

  @Test
  public void 빼면_목록과_개수에서_사라지고_모음_목록에_알려요() {
    try (ActivityScenario<CollectionDetailActivity> screen = open()) {
      await(screen, activity -> rows(activity) == 20);
      remove(screen, 1);
      await(screen, activity -> rows(activity) == 19);
      screen.onActivity(
          activity -> {
            assertEquals("리포트 2", title(activity, 1));
            assertEquals(
                activity.getString(R.string.collection_detail_summary, TOTAL - 1),
                ((TextView) activity.findViewById(R.id.detail_count)).getText().toString());
            activity.finish();
          });
      assertEquals(List.of("/v1/collections/k1/reports/r1"), removes);
      assertEquals(Activity.RESULT_OK, screen.getResult().getResultCode());
    }
  }

  @Test
  public void 빼는_중에_화면을_다시_만들어도_한_번만_보내고_결과를_반영해요() {
    removeDelay = 1500;
    try (ActivityScenario<CollectionDetailActivity> screen = open()) {
      await(screen, activity -> rows(activity) == 20);
      remove(screen, 0);
      // 빼는 동안 그 줄의 빼기 버튼을 잠가요.
      await(screen, activity -> !row(activity, 0).findViewById(R.id.report_remove).isEnabled());
      screen.recreate();
      await(screen, activity -> rows(activity) == 19);
      screen.onActivity(activity -> assertEquals("리포트 1", title(activity, 0)));
      SystemClock.sleep(500);
      assertEquals(1, removes.size());
      assertEquals(1, lists.get());
      screen.onActivity(Activity::finish);
      assertEquals(Activity.RESULT_OK, screen.getResult().getResultCode());
    }
  }

  private ActivityScenario<CollectionDetailActivity> open() {
    Intent intent =
        new Intent(
                InstrumentationRegistry.getInstrumentation().getTargetContext(),
                CollectionDetailActivity.class)
            .putExtra(CollectionDetailActivity.EXTRA_ID, "k1")
            .putExtra(CollectionDetailActivity.EXTRA_NAME, "AI 공부")
            .putExtra(CollectionDetailActivity.EXTRA_REPORT_COUNT, TOTAL);
    return ActivityScenario.launchActivityForResult(intent);
  }

  @Test
  public void 빼는_중에는_이름_바꾸기를_열지_않아서_개수가_한_번만_줄어요() {
    removeDelay = 1500;
    try (ActivityScenario<CollectionDetailActivity> screen = open()) {
      await(screen, activity -> rows(activity) == 20);
      remove(screen, 0);
      // 빼기 응답이 오기 전에 이름 바꾸기를 눌러도 시트가 열리지 않아요.
      await(screen, activity -> !activity.findViewById(R.id.detail_rename_button).isEnabled());
      screen.onActivity(
          activity -> {
            activity.findViewById(R.id.detail_rename_button).performClick();
            activity.getSupportFragmentManager().executePendingTransactions();
            assertEquals(
                null,
                activity.getSupportFragmentManager().findFragmentByTag("collection_name_sheet"));
          });
      await(screen, activity -> rows(activity) == 19);
      screen.onActivity(
          activity -> {
            assertEquals(true, activity.findViewById(R.id.detail_rename_button).isEnabled());
            assertEquals(
                activity.getString(R.string.collection_detail_summary, TOTAL - 1),
                ((TextView) activity.findViewById(R.id.detail_count)).getText().toString());
          });
      assertEquals(1, removes.size());
    }
  }

  /** 줄의 빼기를 누르고 확인창에서 빼기를 눌러요. */
  private static void remove(ActivityScenario<CollectionDetailActivity> screen, int position) {
    screen.onActivity(
        activity -> row(activity, position).findViewById(R.id.report_remove).performClick());
    await(screen, activity -> dialog(activity) != null && dialog(activity).getDialog() != null);
    screen.onActivity(
        activity -> dialog(activity).requireDialog().findViewById(R.id.confirm_ok).performClick());
  }

  private static DialogFragment dialog(CollectionDetailActivity activity) {
    return (DialogFragment)
        activity.getSupportFragmentManager().findFragmentByTag("collection_remove_dialog");
  }

  private static String report(String id, String title) {
    return "{\"id\":\""
        + id
        + "\",\"title\":\""
        + title
        + "\",\"channelName\":\"@채널\",\"createdAt\":\"2026-11-20T00:00:00.000Z\","
        + "\"viewerContext\":{\"origin\":\"direct\",\"deliveryStatus\":null}}";
  }

  private static int rows(CollectionDetailActivity activity) {
    RecyclerView.Adapter<?> adapter =
        ((RecyclerView) activity.findViewById(R.id.detail_reports_list)).getAdapter();
    return adapter == null ? -1 : adapter.getItemCount();
  }

  /** 화면에 보이는 줄이에요. 위쪽 몇 줄만 눌러요. */
  private static View row(CollectionDetailActivity activity, int position) {
    RecyclerView list = activity.findViewById(R.id.detail_reports_list);
    return list.findViewHolderForAdapterPosition(position).itemView;
  }

  /** 화면 밖 줄도 읽을 수 있게 어댑터로 줄을 하나 따로 그려서 제목을 읽어요. */
  @SuppressWarnings("unchecked")
  private static String title(CollectionDetailActivity activity, int position) {
    RecyclerView list = activity.findViewById(R.id.detail_reports_list);
    RecyclerView.Adapter<RecyclerView.ViewHolder> adapter =
        (RecyclerView.Adapter<RecyclerView.ViewHolder>) list.getAdapter();
    RecyclerView.ViewHolder holder = adapter.createViewHolder(list, 0);
    adapter.bindViewHolder(holder, position);
    return ((TextView) holder.itemView.findViewById(R.id.report_title)).getText().toString();
  }

  private static void await(
      ActivityScenario<CollectionDetailActivity> screen,
      Predicate<CollectionDetailActivity> condition) {
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
