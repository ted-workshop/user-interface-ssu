package kr.ac.ssu.qletter.common;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.isDisplayed;
import static androidx.test.espresso.matcher.ViewMatchers.withId;
import static androidx.test.espresso.matcher.ViewMatchers.withText;
import static org.junit.Assert.*;

import android.content.Context;
import android.content.ContextWrapper;
import android.os.Build;
import android.os.Looper;
import androidx.lifecycle.Observer;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.auth.AuthActivity;
import org.junit.After;
import org.junit.BeforeClass;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class FoundationTest {
  private static final String SERVER = "https://unit.example/";
  private static final String TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  private static final String EXPIRY = "2099-01-01T00:00:00Z";

  @Rule
  public final TemporaryFolder directory =
      new TemporaryFolder(
          InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir());

  private Context sessionContext() {
    return new ContextWrapper(InstrumentationRegistry.getInstrumentation().getTargetContext()) {
      @Override
      public File getNoBackupFilesDir() {
        return directory.getRoot();
      }
    };
  }

  private static QletterApplication app() {
    return (QletterApplication)
        InstrumentationRegistry.getInstrumentation().getTargetContext().getApplicationContext();
  }

  @After
  public void 로그인_상태를_정리해요() {
    app().sessions().clear();
  }

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
      // 권한이 없는 이전 빌드에서는 네트워크 요청이 실패해도 화면 제목 검사는 계속해요.
    }
  }

  @Test
  public void 탭을_바꾸고_화면을_다시_만들어도_선택을_유지해요() throws Exception {
    app().sessions().signIn(TOKEN, EXPIRY);
    try (ActivityScenario<MainActivity> page = ActivityScenario.launch(MainActivity.class)) {
      onView(withId(R.id.home_title)).check(matches(withText(R.string.tab_home)));
      onView(withId(R.id.tab_summary)).perform(click());
      onView(withId(R.id.summary_title)).check(matches(withText(R.string.page_summary)));
      onView(withId(R.id.tab_reports)).perform(click());
      onView(withId(R.id.tab_channels)).perform(click());
      onView(withId(R.id.channel_title)).check(matches(withText(R.string.channel_title)));
      page.recreate();
      onView(withId(R.id.channel_title)).check(matches(withText(R.string.channel_title)));
      onView(withId(R.id.tab_account)).perform(click());
      onView(withId(R.id.account_title)).check(matches(withText(R.string.account_title)));
    }
  }

  @Test
  public void 로그인하지_않으면_로그인_화면을_보여요() throws Exception {
    app().sessions().signIn(TOKEN, EXPIRY);
    app().sessions().clear();
    try (ActivityScenario<AuthActivity> page = ActivityScenario.launch(AuthActivity.class)) {
      onView(withId(R.id.login_email)).check(matches(isDisplayed()));
      onView(withId(R.id.login_submit)).check(matches(withText(R.string.auth_login)));
    }
  }

  @Test
  public void 암호화한_세션을_다시_읽고_로그아웃하면_보관한_값도_없어져요() throws Exception {
    Context context = sessionContext();
    SessionStore store = newStore(context);
    try {
      store.signIn(TOKEN, EXPIRY);
      File saved = new File(context.getNoBackupFilesDir(), "qletter.session");
      byte[] contents = new byte[(int) saved.length()];
      try (java.io.DataInputStream data = new java.io.DataInputStream(new FileInputStream(saved))) {
        data.readFully(contents);
      }
      assertFalse(new String(contents, StandardCharsets.ISO_8859_1).contains(TOKEN));
      SessionStore restored = newStore(context);
      assertEquals(TOKEN, restored.snapshot().token);
      restored.clear();
      assertFalse(newStore(context).isSignedIn());
      assertThrows(
          IllegalArgumentException.class, () -> store.signIn(TOKEN, "2000-01-01T00:00:00Z"));
    } finally {
      store.clear();
    }
  }

  @Test
  public void 복원보다_앞선_로그아웃은_이전_세션을_되살리지_않아요() throws Exception {
    Context context = sessionContext();
    SessionStore first = newStore(context);
    try {
      first.signIn(TOKEN, EXPIRY);
      SessionStore restarting = new SessionStore(context, SERVER);
      restarting.clear();
      restarting.restore();
      assertFalse(restarting.isSignedIn());
      assertFalse(newStore(context).isSignedIn());
    } finally {
      first.clear();
    }
  }

  @Test
  public void 만료된_세션_파일을_복원하면_삭제해요() throws Exception {
    Context context = sessionContext();
    long expiresAt = Session.expiryMillis(EXPIRY);
    SessionStore first = newStore(context);
    try {
      first.signIn(TOKEN, EXPIRY);
      File file = new File(context.getNoBackupFilesDir(), "qletter.session");
      assertTrue(file.isFile());
      SessionStore restarted = new SessionStore(context, SERVER, () -> expiresAt);
      restarted.restore();
      assertNull(restarted.snapshot());
      assertFalse(file.exists());
    } finally {
      first.clear();
    }
  }

  @Test
  public void 절전_중_만료된_세션은_전면_복귀_때_변경을_알려요() throws Exception {
    Context context = sessionContext();
    long expiry = Session.expiryMillis(EXPIRY);
    AtomicLong clock = new AtomicLong(expiry - TimeUnit.DAYS.toMillis(1));
    SessionStore store = new SessionStore(context, SERVER, clock::get);
    CountDownLatch expired = new CountDownLatch(1);
    Observer<Long> observer =
        ignored -> {
          if (!store.isSignedIn()) expired.countDown();
        };
    try {
      store.signIn(TOKEN, EXPIRY);
      InstrumentationRegistry.getInstrumentation()
          .runOnMainSync(() -> store.changes().observeForever(observer));
      assertTrue(store.isSignedIn());
      clock.set(expiry);
      InstrumentationRegistry.getInstrumentation().runOnMainSync(store::refreshExpiryAsync);
      assertTrue(expired.await(10, TimeUnit.SECONDS));
      assertFalse(new File(context.getNoBackupFilesDir(), "qletter.session").exists());
    } finally {
      InstrumentationRegistry.getInstrumentation()
          .runOnMainSync(() -> store.changes().removeObserver(observer));
      store.clear();
    }
  }

  @Test
  public void 메인에서_로그인을_요청하면_저장_후_메인에_결과를_알려요() throws Exception {
    Context context = sessionContext();
    SessionStore store = newStore(context);
    CountDownLatch completed = new CountDownLatch(1);
    AtomicBoolean onMain = new AtomicBoolean();
    AtomicReference<Exception> failure = new AtomicReference<>();
    try {
      InstrumentationRegistry.getInstrumentation()
          .runOnMainSync(
              () ->
                  store.signInAsync(
                      TOKEN,
                      EXPIRY,
                      error -> {
                        failure.set(error);
                        onMain.set(Looper.myLooper() == Looper.getMainLooper());
                        completed.countDown();
                      }));
      assertTrue(completed.await(10, TimeUnit.SECONDS));
      assertNull(failure.get());
      assertTrue(onMain.get());
      assertEquals(TOKEN, newStore(context).snapshot().token);
    } finally {
      store.clear();
    }
  }

  private static SessionStore newStore(Context context) {
    SessionStore store = new SessionStore(context, SERVER);
    store.restore();
    return store;
  }
}
