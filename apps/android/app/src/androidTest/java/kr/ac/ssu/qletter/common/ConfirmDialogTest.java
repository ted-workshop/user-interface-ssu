package kr.ac.ssu.qletter.common;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.withId;
import static androidx.test.espresso.matcher.ViewMatchers.withText;
import static org.junit.Assert.assertEquals;

import android.app.UiAutomation;
import android.os.Build;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.atomic.AtomicReference;
import kr.ac.ssu.qletter.R;
import org.junit.After;
import org.junit.Before;
import org.junit.BeforeClass;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ConfirmDialogTest {
  private static final String REQUEST_KEY = "confirm_dialog_test";
  private static final String TOKEN = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  private static final String EXPIRY = "2099-01-01T00:00:00Z";

  private static QletterApplication app() {
    return (QletterApplication)
        InstrumentationRegistry.getInstrumentation().getTargetContext().getApplicationContext();
  }

  @BeforeClass
  public static void 로컬_네트워크_권한을_미리_허용해요() {
    if (Build.VERSION.SDK_INT < 37) return;
    UiAutomation automation = InstrumentationRegistry.getInstrumentation().getUiAutomation();
    try {
      automation.grantRuntimePermission(
          InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName(),
          "android.permission.ACCESS_LOCAL_NETWORK");
    } catch (RuntimeException ignored) {
      // 권한이 없는 빌드에서도 확인창 검사는 이어가요.
    }
  }

  @Before
  public void 로그인_상태로_준비해요() throws Exception {
    app().sessions().signIn(TOKEN, EXPIRY);
  }

  @After
  public void 로그인_상태를_정리해요() {
    app().sessions().clear();
  }

  @Test
  public void 화면을_다시_만들어도_확인한_대상_ID를_돌려줘요() {
    AtomicReference<String> lastId = new AtomicReference<>();
    try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
      scenario.onActivity(
          activity -> {
            register(activity, lastId);
            ConfirmDialog.show(
                activity.getSupportFragmentManager(),
                "test_confirm_dialog",
                REQUEST_KEY,
                "대상을 삭제할까요?",
                "테스트 대상만 삭제해요.",
                "삭제",
                "target-1");
          });

      scenario.recreate();
      scenario.onActivity(activity -> register(activity, lastId));
      onView(withId(R.id.confirm_title)).check(matches(withText("대상을 삭제할까요?")));
      onView(withId(R.id.confirm_ok)).perform(click());
      InstrumentationRegistry.getInstrumentation().waitForIdleSync();
      assertEquals("target-1", lastId.get());
    }
  }

  private static void register(MainActivity activity, AtomicReference<String> lastId) {
    activity
        .getSupportFragmentManager()
        .setFragmentResultListener(
            REQUEST_KEY,
            activity,
            (key, result) -> lastId.set(result.getString(ConfirmDialog.RESULT_ID)));
  }
}
