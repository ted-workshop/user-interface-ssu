package kr.ac.ssu.qletter.collection;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.Espresso.pressBack;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.matcher.ViewMatchers.withId;
import static androidx.test.espresso.matcher.ViewMatchers.withText;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.widget.TextView;
import androidx.annotation.Nullable;
import androidx.fragment.app.DialogFragment;
import androidx.fragment.app.Fragment;
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
import kr.ac.ssu.qletter.common.MainActivity;
import kr.ac.ssu.qletter.common.TestApi;
import kr.ac.ssu.qletter.report.ReportDetailFragment;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.After;
import org.junit.Before;
import org.junit.BeforeClass;
import org.junit.Test;
import org.junit.runner.RunWith;

/** 모음 상세가 리포트를 이어 받고, 빼기 결과를 잃거나 두 번 보내지 않고, 리포트 상세와 오가는지 확인해요. 요청은 기기 안 테스트 서버로만 가요. */
@RunWith(AndroidJUnit4.class)
public class CollectionDetailFragmentTest {
  // 모음에 담긴 리포트 수예요. 한 번에 20개씩 줘서 두 번 받아야 다 보여요.
  private static final int TOTAL = 25;
  private static final String TAG = "collection";

  private final List<String> removes = new CopyOnWriteArrayList<>();
  private final AtomicInteger lists = new AtomicInteger();
  private final AtomicInteger collectionLists = new AtomicInteger();
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
            String path = request.getPath();
            // 리포트 탭의 내 리포트 목록, 리포트 상세와 그 댓글, 닉네임이에요.
            if (path.startsWith("/v1/reports?")) return json("{\"items\":[],\"nextCursor\":null}");
            if (path.startsWith("/v1/reports/r0/comments"))
              return json("{\"items\":[],\"nextCursor\":null}");
            if (path.startsWith("/v1/reports/")) return json(detail());
            if (path.startsWith("/v1/me")) return json("{\"nickname\":\"찬형\"}");
            // 모음 목록이에요. 시트에서 하나를 뺐다고 보고 개수를 하나 줄여 줘요.
            if (path.startsWith("/v1/collections?")) {
              collectionLists.incrementAndGet();
              return json(
                  "{\"items\":[{\"id\":\"k1\",\"name\":\"AI 공부\",\"reportCount\":"
                      + (TOTAL - 1)
                      + "}],\"nextCursor\":null}");
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
            return json("{\"items\":[" + items + "],\"nextCursor\":" + cursor + "}");
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
    try (ActivityScenario<MainActivity> screen = open()) {
      await(screen, activity -> rows(activity) == 20);
      screen.onActivity(
          activity -> {
            assertEquals("리포트 0", title(activity, 0));
            View more = view(activity, R.id.detail_more);
            assertEquals(View.VISIBLE, more.getVisibility());
            more.performClick();
            // 받는 동안 다시 눌러도 한 번만 보내요.
            more.performClick();
          });
      await(screen, activity -> rows(activity) == TOTAL);
      screen.onActivity(
          activity -> {
            assertEquals("리포트 24", title(activity, TOTAL - 1));
            assertEquals(View.GONE, view(activity, R.id.detail_more).getVisibility());
          });
      assertEquals(2, lists.get());
    }
  }

  @Test
  public void 빼면_목록과_개수에서_사라져요() {
    try (ActivityScenario<MainActivity> screen = open()) {
      await(screen, activity -> rows(activity) == 20);
      remove(screen, 1);
      await(screen, activity -> rows(activity) == 19);
      screen.onActivity(
          activity -> {
            assertEquals("리포트 2", title(activity, 1));
            assertEquals(
                activity.getString(R.string.collection_detail_summary, TOTAL - 1),
                text(activity, R.id.detail_count));
          });
      assertEquals(List.of("/v1/collections/k1/reports/r1"), removes);
    }
  }

  @Test
  public void 빼는_중에_화면을_다시_만들어도_한_번만_보내고_결과를_반영해요() {
    removeDelay = 1500;
    try (ActivityScenario<MainActivity> screen = open()) {
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
    }
  }

  @Test
  public void 빼는_중에는_이름_바꾸기를_열지_않아서_개수가_한_번만_줄어요() {
    removeDelay = 1500;
    try (ActivityScenario<MainActivity> screen = open()) {
      await(screen, activity -> rows(activity) == 20);
      remove(screen, 0);
      // 빼기 응답이 오기 전에 이름 바꾸기를 눌러도 시트가 열리지 않아요.
      await(screen, activity -> !view(activity, R.id.detail_rename_button).isEnabled());
      screen.onActivity(
          activity -> {
            view(activity, R.id.detail_rename_button).performClick();
            detail(activity).getChildFragmentManager().executePendingTransactions();
            assertNull(
                detail(activity)
                    .getChildFragmentManager()
                    .findFragmentByTag("collection_name_sheet"));
          });
      await(screen, activity -> rows(activity) == 19);
      screen.onActivity(
          activity -> {
            assertEquals(true, view(activity, R.id.detail_rename_button).isEnabled());
            assertEquals(
                activity.getString(R.string.collection_detail_summary, TOTAL - 1),
                text(activity, R.id.detail_count));
          });
      assertEquals(1, removes.size());
    }
  }

  @Test
  public void 줄을_누르면_리포트_상세와_댓글을_열고_돌려도_남고_뒤로_가면_목록으로_돌아와요() {
    try (ActivityScenario<MainActivity> screen = open()) {
      await(screen, activity -> rows(activity) == 20);
      screen.onActivity(activity -> row(activity, 0).performClick());
      // 본문을 받으면 댓글 영역도 붙어요.
      await(
          screen,
          activity ->
              report(activity) != null
                  && report(activity).getView() != null
                  && report(activity)
                          .getChildFragmentManager()
                          .findFragmentById(R.id.detail_comments)
                      != null);
      // 상세를 연 채로 돌려도 상세가 남고, 댓글 영역이 두 번 붙지 않아요.
      screen.recreate();
      await(
          screen,
          activity ->
              report(activity) != null
                  && report(activity).getView() != null
                  && text(report(activity).requireView(), R.id.detail_title).equals("상세 제목"));
      screen.onActivity(
          activity -> {
            int comments = 0;
            for (Fragment child : report(activity).getChildFragmentManager().getFragments())
              if (child instanceof ReportCommentsFragment) comments++;
            assertEquals(1, comments);
            View detail = report(activity).requireView();
            assertEquals("← AI 공부", text(detail, R.id.report_back));
            assertEquals(
                View.VISIBLE, detail.findViewById(R.id.detail_add_collection).getVisibility());
            // 모음 상세는 상세 자리를 내줘서 화면에 없어요.
            assertNull(detail(activity).getView());
            detail.findViewById(R.id.report_back).performClick();
          });
      await(screen, activity -> report(activity) == null && rows(activity) == 20);
      // 돌아올 때 목록을 다시 받지 않아요.
      assertEquals(1, lists.get());
    }
  }

  @Test
  public void 상세의_모음에_담기_시트에서_바뀌면_돌아와서_목록과_개수를_다시_받아요() {
    try (ActivityScenario<MainActivity> screen = open()) {
      await(screen, activity -> rows(activity) == 20);
      screen.onActivity(activity -> row(activity, 0).performClick());
      await(screen, activity -> report(activity) != null && report(activity).getView() != null);
      // 시트가 저장에 성공하면 보내는 결과예요.
      screen.onActivity(
          activity ->
              report(activity)
                  .getChildFragmentManager()
                  .setFragmentResult(AddToCollectionSheet.REQUEST_KEY, new Bundle()));
      screen.onActivity(
          activity -> report(activity).requireView().findViewById(R.id.report_back).performClick());
      // 목록과 개수 요청은 함께 나가서 어느 쪽이 먼저 올지 몰라요. 둘 다 기다려요.
      await(
          screen,
          activity ->
              lists.get() == 2
                  && rows(activity) == 20
                  && text(activity, R.id.detail_count)
                      .equals(activity.getString(R.string.collection_detail_summary, TOTAL - 1)));
      assertEquals(1, collectionLists.get());
    }
  }

  @Test
  public void 모음_탭에서_열고_뒤로_가면_하단_탭을_유지한_채_모음_목록을_다시_받아요() {
    try (ActivityScenario<MainActivity> screen = ActivityScenario.launch(MainActivity.class)) {
      onView(withId(R.id.tab_reports)).perform(click());
      onView(withText(R.string.report_collections)).perform(click());
      await(screen, activity -> collectionLists.get() == 1);
      onView(withText("AI 공부")).perform(click());
      await(screen, activity -> rows(activity) == 20);
      screen.onActivity(
          activity -> {
            // 리포트 탭의 머리말은 숨기고 하단 탭은 그대로 보여요.
            assertEquals(View.GONE, activity.findViewById(R.id.reports_header).getVisibility());
            assertEquals(View.VISIBLE, activity.findViewById(R.id.tabs).getVisibility());
          });
      pressBack();
      // 상세에서 이름·개수·삭제가 바뀌었을 수 있어 목록을 다시 받아요.
      await(
          screen,
          activity ->
              collectionLists.get() == 2
                  && activity.findViewById(R.id.reports_header).getVisibility() == View.VISIBLE);
    }
  }

  /** 리포트 탭을 거치지 않고 하단 탭 자리에 모음 상세만 바로 열어요. */
  private ActivityScenario<MainActivity> open() {
    ActivityScenario<MainActivity> screen = ActivityScenario.launch(MainActivity.class);
    screen.onActivity(
        activity ->
            activity
                .getSupportFragmentManager()
                .beginTransaction()
                .replace(
                    R.id.tab_content,
                    CollectionDetailFragment.create(new ReportCollection("AI 공부", TOTAL, "k1")),
                    TAG)
                .commitNow());
    return screen;
  }

  /** 줄의 빼기를 누르고 확인창에서 빼기를 눌러요. */
  private static void remove(ActivityScenario<MainActivity> screen, int position) {
    screen.onActivity(
        activity -> row(activity, position).findViewById(R.id.report_remove).performClick());
    await(screen, activity -> dialog(activity) != null && dialog(activity).getDialog() != null);
    screen.onActivity(
        activity -> dialog(activity).requireDialog().findViewById(R.id.confirm_ok).performClick());
  }

  /** 하단 탭 자리나 리포트 탭 안에 열린 모음 상세예요. */
  @Nullable
  private static Fragment detail(MainActivity activity) {
    Fragment direct = activity.getSupportFragmentManager().findFragmentByTag(TAG);
    if (direct != null) return direct;
    Fragment tab = activity.getSupportFragmentManager().findFragmentById(R.id.tab_content);
    if (tab == null) return null;
    for (Fragment child : tab.getChildFragmentManager().getFragments())
      if (child instanceof CollectionDetailFragment) return child;
    return null;
  }

  @Nullable
  private static Fragment report(MainActivity activity) {
    Fragment shown = activity.getSupportFragmentManager().findFragmentById(R.id.tab_content);
    return shown instanceof ReportDetailFragment ? shown : null;
  }

  @Nullable
  private static View view(MainActivity activity, int id) {
    Fragment fragment = detail(activity);
    View root = fragment == null ? null : fragment.getView();
    return root == null ? null : root.findViewById(id);
  }

  private static String text(MainActivity activity, int id) {
    View found = view(activity, id);
    return found == null ? "" : ((TextView) found).getText().toString();
  }

  private static String text(View root, int id) {
    return ((TextView) root.findViewById(id)).getText().toString();
  }

  private static DialogFragment dialog(MainActivity activity) {
    return (DialogFragment)
        detail(activity).getChildFragmentManager().findFragmentByTag("collection_remove_dialog");
  }

  private static MockResponse json(String body) {
    return new MockResponse().setHeader("Content-Type", "application/json").setBody(body);
  }

  private static String detail() {
    return "{\"id\":\"r0\",\"title\":\"상세 제목\",\"channelName\":null,\"channelUrl\":null,"
        + "\"videoId\":\"jNQXAC9IVRw\",\"timestampVerification\":\"unverified\","
        + "\"createdAt\":\"2026-11-21T00:00:00.000Z\",\"viewerContext\":{\"origin\":\"direct\","
        + "\"deliveryStatus\":\"not_applicable\",\"savedAt\":\"2026-11-21T00:00:00.000Z\"},"
        + "\"bodyMarkdown\":\"본문\"}";
  }

  private static String report(String id, String title) {
    return "{\"id\":\""
        + id
        + "\",\"title\":\""
        + title
        + "\",\"channelName\":\"@채널\",\"createdAt\":\"2026-11-20T00:00:00.000Z\","
        + "\"viewerContext\":{\"origin\":\"direct\",\"deliveryStatus\":null}}";
  }

  private static int rows(MainActivity activity) {
    View list = view(activity, R.id.detail_reports_list);
    if (list == null) return -1;
    RecyclerView.Adapter<?> adapter = ((RecyclerView) list).getAdapter();
    return adapter == null ? -1 : adapter.getItemCount();
  }

  /** 화면에 보이는 줄이에요. 위쪽 몇 줄만 눌러요. */
  private static View row(MainActivity activity, int position) {
    RecyclerView list = (RecyclerView) view(activity, R.id.detail_reports_list);
    return list.findViewHolderForAdapterPosition(position).itemView;
  }

  /** 화면 밖 줄도 읽을 수 있게 어댑터로 줄을 하나 따로 그려서 제목을 읽어요. */
  @SuppressWarnings("unchecked")
  private static String title(MainActivity activity, int position) {
    RecyclerView list = (RecyclerView) view(activity, R.id.detail_reports_list);
    RecyclerView.Adapter<RecyclerView.ViewHolder> adapter =
        (RecyclerView.Adapter<RecyclerView.ViewHolder>) list.getAdapter();
    RecyclerView.ViewHolder holder = adapter.createViewHolder(list, 0);
    adapter.bindViewHolder(holder, position);
    return ((TextView) holder.itemView.findViewById(R.id.report_title)).getText().toString();
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
