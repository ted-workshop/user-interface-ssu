package kr.ac.ssu.qletter;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.withId;
import static androidx.test.espresso.matcher.ViewMatchers.withText;
import static org.junit.Assert.*;

import android.content.Context;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class FoundationTest {
  @Test
  public void 탭을_바꾸고_화면을_다시_만들어도_선택을_유지해요() {
    try (ActivityScenario<MainActivity> page = ActivityScenario.launch(MainActivity.class)) {
      onView(withId(R.id.tab_title)).check(matches(withText(R.string.tab_home)));
      onView(withId(R.id.tab_summary)).perform(click());
      onView(withId(R.id.tab_title)).check(matches(withText(R.string.page_summary)));
      onView(withId(R.id.tab_reports)).perform(click());
      onView(withId(R.id.tab_channels)).perform(click());
      page.recreate();
      onView(withId(R.id.tab_title)).check(matches(withText(R.string.tab_channels)));
      onView(withId(R.id.tab_account)).perform(click());
      onView(withId(R.id.tab_title)).check(matches(withText(R.string.tab_account)));
    }
  }

  @Test
  public void 암호화한_세션을_다시_읽고_로그아웃하면_보관한_값도_없어져요() throws Exception {
    Context context = InstrumentationRegistry.getInstrumentation().getContext();
    String server = "https://unit.example/";
    String token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    SessionStore store = newStore(context, server);
    try {
      store.signIn(token, "2099-01-01T00:00:00Z");
      File saved = new File(context.getNoBackupFilesDir(), "qletter.session");
      byte[] contents = new byte[(int) saved.length()];
      try (java.io.DataInputStream data = new java.io.DataInputStream(new FileInputStream(saved))) {
        data.readFully(contents);
      }
      assertFalse(new String(contents, StandardCharsets.ISO_8859_1).contains(token));
      SessionStore restored = newStore(context, server);
      assertEquals(token, restored.snapshot().token);
      restored.clear();
      assertFalse(newStore(context, server).isSignedIn());
      assertThrows(
          IllegalArgumentException.class, () -> store.signIn(token, "2000-01-01T00:00:00Z"));
    } finally {
      store.clear();
    }
  }

  private static SessionStore newStore(Context context, String server) {
    final SessionStore[] result = new SessionStore[1];
    InstrumentationRegistry.getInstrumentation()
        .runOnMainSync(() -> result[0] = new SessionStore(context, server));
    return result[0];
  }
}
