package kr.ac.ssu.qletter.common;

import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.Field;

/**
 * 기기 검사 동안 앱의 API를 기기 안 테스트 서버로 바꿔요. 닫으면 원래 API로 돌려요.
 *
 * <p>기본 주소로 빌드해도 검사가 건너뛰어지지 않고, 실제 서버에는 요청하지 않아요.
 */
public final class TestApi implements AutoCloseable {
  private static final String TOKEN = "ttttttttttttttttttttttttttttttttttttttttttt";

  private final QletterApplication app;
  private final QletterApi original;
  private final Field field;

  public TestApi(int port) throws Exception {
    app =
        (QletterApplication)
            InstrumentationRegistry.getInstrumentation().getTargetContext().getApplicationContext();
    original = app.api();
    field = QletterApplication.class.getDeclaredField("api");
    field.setAccessible(true);
    SessionStore sessions = app.sessions();
    sessions.signIn(TOKEN, "2099-01-01T00:00:00Z");
    field.set(
        app,
        new QletterApi(
            "http://127.0.0.1:" + port + "/",
            new QletterApi.Sessions() {
              @Override
              public Session current() {
                return sessions.snapshot();
              }

              @Override
              public void invalidate(Session sent) {
                sessions.clearIfCurrent(sent);
              }
            }));
    InstrumentationRegistry.getInstrumentation().waitForIdleSync();
  }

  @Override
  public void close() throws Exception {
    app.sessions().clear();
    field.set(app, original);
  }
}
