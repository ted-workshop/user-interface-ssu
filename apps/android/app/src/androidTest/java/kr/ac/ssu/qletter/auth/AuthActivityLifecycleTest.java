package kr.ac.ssu.qletter.auth;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.isDisplayed;
import static androidx.test.espresso.matcher.ViewMatchers.withId;
import static androidx.test.espresso.matcher.ViewMatchers.withText;
import static org.junit.Assert.assertTrue;

import android.app.UiAutomation;
import android.content.Context;
import android.os.Build;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.atomic.AtomicBoolean;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.QletterApplication;
import org.junit.After;
import org.junit.Before;
import org.junit.BeforeClass;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AuthActivityLifecycleTest {
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
  public void 로그아웃_상태로_시작해요() {
    app().sessions().clear();
  }

  @After
  public void 로그인_상태를_정리해요() {
    app().sessions().clear();
  }

  @Test
  public void 상태_저장_뒤_늦은_화면_전환은_재개할_때_한_번_열려요() {
    try (ActivityScenario<AuthActivity> scenario = ActivityScenario.launch(AuthActivity.class)) {
      onView(withId(R.id.login_email)).check(matches(isDisplayed()));

      scenario.moveToState(Lifecycle.State.CREATED);
      AtomicBoolean stateSaved = new AtomicBoolean();
      scenario.onActivity(
          activity -> stateSaved.set(activity.getSupportFragmentManager().isStateSaved()));
      assertTrue("재개 전 상태 저장을 확인하지 못했어요.", stateSaved.get());

      // 네트워크 응답이 홈 이동 뒤 도착한 상황을 화면 전환 요청으로 재현해요.
      scenario.onActivity(activity -> activity.showVerify("reader@example.com"));
      scenario.moveToState(Lifecycle.State.RESUMED);

      onView(withId(R.id.verify_code)).check(matches(isDisplayed()));
      onView(withId(R.id.verify_subtitle))
          .check(
              matches(
                  withText(app().getString(R.string.auth_verify_subtitle, "reader@example.com"))));
    }
  }

  @Test
  public void 비밀번호_변경_뒤_회원가입에서_뒤로_가면_로그인으로_돌아와요() {
    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    try (ActivityScenario<AuthActivity> scenario =
        ActivityScenario.launch(AuthActivity.passwordChangeIntent(context, "reader@example.com"))) {
      scenario.onActivity(activity -> activity.clearedAfterPasswordChange("reader@example.com"));
      onView(withId(R.id.login_signup)).perform(click());
      onView(withId(R.id.signup_back)).perform(click());
      onView(withId(R.id.login_email)).check(matches(isDisplayed()));
    }
  }
}
