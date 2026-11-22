package kr.ac.ssu.qletter.account;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
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
import kr.ac.ssu.qletter.common.MainActivity;
import kr.ac.ssu.qletter.common.QletterApplication;
import org.junit.After;
import org.junit.Before;
import org.junit.BeforeClass;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class RecipientCodeDialogLifecycleTest {
  private static final String REQUEST_KEY = "recipient_code_dialog";
  private static final String TOKEN = "ddddddddddddddddddddddddddddddddddddddddddd";
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
  public void 상태_저장_뒤_확인_성공은_재개할_때_닫고_결과를_남겨요() {
    AtomicReference<String> lastId = new AtomicReference<>();
    try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
      scenario.onActivity(
          activity -> {
            activity
                .getSupportFragmentManager()
                .setFragmentResultListener(
                    REQUEST_KEY,
                    activity,
                    (key, result) -> lastId.set(result.getString(RecipientCodeDialog.RESULT_ID)));
            RecipientCodeDialog.show(
                activity.getSupportFragmentManager(), "recipient-1", "reader@example.com");
            activity.getSupportFragmentManager().executePendingTransactions();
          });

      scenario.moveToState(Lifecycle.State.CREATED);
      AtomicBoolean stateSaved = new AtomicBoolean();
      scenario.onActivity(
          activity -> {
            stateSaved.set(activity.getSupportFragmentManager().isStateSaved());
            RecipientCodeDialog dialog =
                (RecipientCodeDialog)
                    activity.getSupportFragmentManager().findFragmentByTag(RecipientCodeDialog.TAG);
            if (dialog != null) dialog.completeVerification();
          });
      assertTrue("재개 전 상태 저장을 확인하지 못했어요.", stateSaved.get());

      scenario.moveToState(Lifecycle.State.RESUMED);
      InstrumentationRegistry.getInstrumentation().waitForIdleSync();
      scenario.onActivity(
          activity ->
              assertNull(
                  activity.getSupportFragmentManager().findFragmentByTag(RecipientCodeDialog.TAG)));
      assertEquals("recipient-1", lastId.get());
    }
  }
}
