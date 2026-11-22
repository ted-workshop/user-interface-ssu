package kr.ac.ssu.qletter.account;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.matcher.ViewMatchers.withId;
import static org.junit.Assert.assertTrue;

import android.app.UiAutomation;
import android.os.Build;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.MainActivity;
import kr.ac.ssu.qletter.common.QletterApplication;
import org.junit.After;
import org.junit.Before;
import org.junit.BeforeClass;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AccountFragmentLifecycleTest {
  private static final String TOKEN = "ccccccccccccccccccccccccccccccccccccccccccc";
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
      // 권한이 없는 빌드에서도 화면 전환 검사는 이어가요.
    }
  }

  @Before
  public void 로그인_상태로_준비해요() throws Exception {
    CountDownLatch completed = new CountDownLatch(1);
    AtomicReference<Exception> failure = new AtomicReference<>();
    InstrumentationRegistry.getInstrumentation()
        .runOnMainSync(
            () ->
                app()
                    .sessions()
                    .signInAsync(
                        TOKEN,
                        EXPIRY,
                        error -> {
                          failure.set(error);
                          completed.countDown();
                        }));
    assertTrue(completed.await(10, TimeUnit.SECONDS));
    if (failure.get() != null) throw failure.get();
  }

  @After
  public void 로그인_상태를_정리해요() {
    app().sessions().clear();
  }

  @Test
  public void 상태_저장_뒤_늦은_수신_주소_확인은_재개할_때_한_번_열려요() {
    try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
      onView(withId(R.id.tab_account)).perform(click());
      AtomicBoolean stateSaved = new AtomicBoolean();
      scenario.moveToState(Lifecycle.State.CREATED);
      scenario.onActivity(
          activity -> {
            stateSaved.set(activity.getSupportFragmentManager().isStateSaved());
            AccountFragment fragment =
                (AccountFragment)
                    activity.getSupportFragmentManager().findFragmentByTag("tab_account");
            if (fragment != null) fragment.showRecipientCode("recipient-1", "reader@example.com");
          });
      assertTrue("재개 전 상태 저장을 확인하지 못했어요.", stateSaved.get());

      scenario.moveToState(Lifecycle.State.RESUMED);
      InstrumentationRegistry.getInstrumentation().waitForIdleSync();
      AtomicBoolean shown = new AtomicBoolean();
      scenario.onActivity(
          activity -> {
            AccountFragment fragment =
                (AccountFragment)
                    activity.getSupportFragmentManager().findFragmentByTag("tab_account");
            if (fragment == null) return;
            for (androidx.fragment.app.Fragment child :
                fragment.getChildFragmentManager().getFragments()) {
              if (child instanceof RecipientCodeDialog) shown.set(true);
            }
          });
      assertTrue("재개 뒤 확인 코드 창이 열리지 않았어요.", shown.get());

      scenario.onActivity(
          activity -> {
            AccountFragment fragment =
                (AccountFragment)
                    activity.getSupportFragmentManager().findFragmentByTag("tab_account");
            if (fragment == null) return;
            for (androidx.fragment.app.Fragment child :
                fragment.getChildFragmentManager().getFragments()) {
              if (child instanceof RecipientCodeDialog)
                ((RecipientCodeDialog) child).dismissAllowingStateLoss();
            }
          });
      InstrumentationRegistry.getInstrumentation().waitForIdleSync();
    }
  }
}
