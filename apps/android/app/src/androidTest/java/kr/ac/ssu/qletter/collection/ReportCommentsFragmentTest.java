package kr.ac.ssu.qletter.collection;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.widget.NestedScrollView;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModelProvider;
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
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.After;
import org.junit.Before;
import org.junit.BeforeClass;
import org.junit.Test;
import org.junit.runner.RunWith;

/** 댓글 영역이 이전 댓글을 이어 받고, 등록 결과를 잃거나 두 번 남기지 않는지 확인해요. 요청은 기기 안 테스트 서버로만 가요. */
@RunWith(AndroidJUnit4.class)
public class ReportCommentsFragmentTest {
  private static final String TAG = "comments";
  private static final int HOST_ID = View.generateViewId();
  // 서버에 있는 댓글 수예요. 한 번에 20개씩 줘서 두 번 받아야 다 보여요.
  private static final int TOTAL = 25;

  private final List<String> posts = new CopyOnWriteArrayList<>();
  private final AtomicInteger lists = new AtomicInteger();
  private MockWebServer server;
  private TestApi api;
  private volatile long listDelay;
  private volatile long postDelay;
  private volatile boolean listFails;
  // 서버가 새 댓글을 저장하는 시각이에요. 이보다 먼저 온 목록 요청에는 새 댓글이 없어요.
  private volatile long committedAt = Long.MAX_VALUE;

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
            if (!path.contains("/comments")) return json("{\"nickname\":\"찬형\"}");
            if ("POST".equals(request.getMethod())) {
              posts.add(request.getBody().readUtf8());
              committedAt = SystemClock.uptimeMillis() + Math.min(200, postDelay);
              return json(comment("new", "새 댓글", true))
                  .setResponseCode(201)
                  .setHeadersDelay(postDelay, TimeUnit.MILLISECONDS);
            }
            lists.incrementAndGet();
            if (listFails) return json("{}").setResponseCode(500);
            boolean saved = SystemClock.uptimeMillis() >= committedAt;
            // 서버처럼 최신순으로 20개를 주고, cursor가 있으면 그보다 오래된 댓글을 줘요.
            boolean older = request.getRequestUrl().queryParameter("cursor") != null;
            int from = older ? TOTAL - 21 : TOTAL - 1;
            int to = older ? 0 : TOTAL - 20;
            StringBuilder items = new StringBuilder();
            // 저장된 새 댓글은 가장 최신이라 첫 페이지 맨 앞에 와요.
            if (!older && saved) items.append(comment("new", "새 댓글", true)).append(",");
            for (int i = from; i >= to; i--)
              items.append(i == from ? "" : ",").append(comment("c" + i, "댓글 " + i, false));
            String next = older ? "null" : "\"older\"";
            return json("{\"items\":[" + items + "],\"nextCursor\":" + next + "}")
                .setHeadersDelay(listDelay, TimeUnit.MILLISECONDS);
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
  public void 이전_댓글을_목록_위에_한_번씩만_붙여요() {
    try (ActivityScenario<MainActivity> screen = open()) {
      await(screen, activity -> rows(activity) == 20);
      screen.onActivity(
          activity -> {
            assertEquals("댓글 5", body(activity, 0));
            assertEquals("20+", text(activity, R.id.comment_count));
            assertEquals(View.VISIBLE, view(activity, R.id.comment_older).getVisibility());
            view(activity, R.id.comment_older).performClick();
            // 받는 동안 다시 눌러도 한 번만 보내요.
            view(activity, R.id.comment_older).performClick();
          });
      await(screen, activity -> rows(activity) == TOTAL);
      screen.onActivity(
          activity -> {
            assertEquals("댓글 0", body(activity, 0));
            assertEquals("댓글 24", body(activity, TOTAL - 1));
            assertEquals(String.valueOf(TOTAL), text(activity, R.id.comment_count));
            assertEquals(View.GONE, view(activity, R.id.comment_older).getVisibility());
          });
      assertEquals(2, lists.get());
    }
  }

  @Test
  public void 목록을_받는_중에는_등록하지_않고_받은_뒤에_맨_아래에_붙여요() {
    listDelay = 1500;
    try (ActivityScenario<MainActivity> screen = open()) {
      AtomicBoolean enabled = new AtomicBoolean(true);
      screen.onActivity(
          activity -> {
            ((EditText) view(activity, R.id.comment_input)).setText("새 댓글");
            enabled.set(view(activity, R.id.comment_submit).isEnabled());
            view(activity, R.id.comment_submit).performClick();
          });
      assertFalse("목록을 받는 중에 등록 버튼이 눌려요", enabled.get());
      await(screen, activity -> rows(activity) == 20);
      assertTrue(posts.isEmpty());

      screen.onActivity(activity -> view(activity, R.id.comment_submit).performClick());
      await(screen, activity -> rows(activity) == 21);
      screen.onActivity(
          activity -> {
            assertEquals("새 댓글", body(activity, 20));
            assertEquals("", text(activity, R.id.comment_input));
          });
      assertEquals(1, posts.size());
    }
  }

  @Test
  public void 등록_중에_화면을_다시_만들어도_한_번만_남아요() {
    postDelay = 1500;
    try (ActivityScenario<MainActivity> screen = open()) {
      await(screen, activity -> rows(activity) == 20);
      screen.onActivity(
          activity -> {
            ((EditText) view(activity, R.id.comment_input)).setText("새 댓글");
            view(activity, R.id.comment_submit).performClick();
          });
      screen.recreate();
      await(screen, activity -> rows(activity) == 21);
      screen.onActivity(activity -> assertEquals("새 댓글", body(activity, 20)));
      SystemClock.sleep(500);
      assertEquals(1, posts.size());
    }
  }

  @Test
  public void 등록_중에_다시_불러온_목록이_먼저_와도_새_댓글은_한_번만_남아요() {
    postDelay = 1500;
    try (ActivityScenario<MainActivity> screen = open()) {
      await(screen, activity -> rows(activity) == 20);
      screen.onActivity(
          activity -> {
            ((EditText) view(activity, R.id.comment_input)).setText("새 댓글");
            view(activity, R.id.comment_submit).performClick();
          });
      // 서버가 새 댓글을 저장한 뒤, 등록 응답이 오기 전에 다시 불러와요(삭제 404와 같은 경로).
      SystemClock.sleep(600);
      screen.onActivity(activity -> model(activity).load());
      await(screen, activity -> posts.size() == 1 && count(activity, "새 댓글") >= 1);
      SystemClock.sleep(2500);
      screen.onActivity(
          activity -> {
            assertEquals(1, count(activity, "새 댓글"));
            assertEquals(21, rows(activity));
          });
    }
  }

  @Test
  public void 목록_실패_뒤_등록_중에_다시_시도해도_새_댓글이_남아요() {
    listFails = true;
    postDelay = 1500;
    try (ActivityScenario<MainActivity> screen = open()) {
      await(screen, activity -> view(activity, R.id.comment_retry).getVisibility() == View.VISIBLE);
      listFails = false;
      // 다시 받은 목록이 등록 응답보다 늦게 와요. 등록 전에 보낸 목록이면 새 댓글이 없어요.
      listDelay = 2500;
      screen.onActivity(
          activity -> {
            ((EditText) view(activity, R.id.comment_input)).setText("새 댓글");
            view(activity, R.id.comment_submit).performClick();
            view(activity, R.id.comment_retry).performClick();
          });
      await(screen, activity -> rows(activity) == 21);
      SystemClock.sleep(1000);
      screen.onActivity(
          activity -> {
            assertEquals(1, count(activity, "새 댓글"));
            assertEquals(21, rows(activity));
            assertEquals(View.VISIBLE, view(activity, R.id.comment_list).getVisibility());
          });
      assertEquals(1, posts.size());
    }
  }

  /** 리포트 상세 자리에 넣는 테스트용 화면이에요. 스크롤 안에 댓글 영역을 붙여서 실제 상세처럼 모든 줄을 그려요. */
  public static final class DetailHost extends Fragment {
    @Override
    public View onCreateView(
        @NonNull LayoutInflater inflater, @Nullable ViewGroup parent, @Nullable Bundle saved) {
      NestedScrollView scroll = new NestedScrollView(requireContext());
      // 리포트 상세처럼 좌우·위에 16dp 여백을 둬요.
      int gap = (int) (16 * getResources().getDisplayMetrics().density);
      scroll.setPadding(gap, gap, gap, gap);
      FrameLayout container = new FrameLayout(requireContext());
      container.setId(HOST_ID);
      scroll.addView(container);
      return scroll;
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle saved) {
      // 다시 만들어질 때는 FragmentManager가 댓글 영역을 복원해요.
      String report = getArguments() == null ? "r" : getArguments().getString("report", "r");
      if (saved == null)
        getChildFragmentManager()
            .beginTransaction()
            .add(HOST_ID, ReportCommentsFragment.newInstance(report), TAG)
            .commitNow();
    }
  }

  private ActivityScenario<MainActivity> open() {
    ActivityScenario<MainActivity> screen = ActivityScenario.launch(MainActivity.class);
    screen.onActivity(
        activity ->
            activity
                .getSupportFragmentManager()
                .beginTransaction()
                .replace(R.id.tab_content, new DetailHost(), "detail")
                .commitNow());
    return screen;
  }

  private static String comment(String id, String body, boolean mine) {
    return "{\"id\":\""
        + id
        + "\",\"body\":\""
        + body
        + "\",\"author\":{\"nickname\":\"테스터\"},\"createdAt\":\"2026-11-20T00:00:00.000Z\","
        + "\"canDelete\":"
        + mine
        + "}";
  }

  private static MockResponse json(String body) {
    return new MockResponse().setHeader("Content-Type", "application/json").setBody(body);
  }

  private static View root(MainActivity activity) {
    Fragment host = activity.getSupportFragmentManager().findFragmentByTag("detail");
    if (host == null) return null;
    Fragment comments = host.getChildFragmentManager().findFragmentByTag(TAG);
    return comments == null ? null : comments.getView();
  }

  private static View view(MainActivity activity, int id) {
    return root(activity).findViewById(id);
  }

  private static ReportCommentsViewModel model(MainActivity activity) {
    Fragment comments =
        activity
            .getSupportFragmentManager()
            .findFragmentByTag("detail")
            .getChildFragmentManager()
            .findFragmentByTag(TAG);
    return new ViewModelProvider(comments).get(ReportCommentsViewModel.class);
  }

  /** 목록에서 같은 내용의 댓글이 몇 줄인지 세요. */
  private static int count(MainActivity activity, String text) {
    int found = 0;
    for (int i = 0; i < rows(activity); i++) if (text.equals(body(activity, i))) found++;
    return found;
  }

  private static String text(MainActivity activity, int id) {
    return ((TextView) view(activity, id)).getText().toString();
  }

  private static int rows(MainActivity activity) {
    View root = root(activity);
    if (root == null) return -1;
    RecyclerView.Adapter<?> adapter =
        ((RecyclerView) root.findViewById(R.id.comment_list)).getAdapter();
    return adapter == null ? -1 : adapter.getItemCount();
  }

  /** 스크롤 안의 목록은 모든 줄을 그려서 화면 밖 줄도 읽을 수 있어요. */
  private static String body(MainActivity activity, int position) {
    RecyclerView list = (RecyclerView) view(activity, R.id.comment_list);
    RecyclerView.ViewHolder holder = list.findViewHolderForAdapterPosition(position);
    return ((TextView) holder.itemView.findViewById(R.id.comment_body)).getText().toString();
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
