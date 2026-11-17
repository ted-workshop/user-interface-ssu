package kr.ac.ssu.qletter.common;

import android.app.Application;
import kr.ac.ssu.qletter.BuildConfig;

public final class QletterApplication extends Application {
  private SessionStore sessions;
  private QletterApi api;

  @Override
  public void onCreate() {
    super.onCreate();
    sessions = new SessionStore(this, BuildConfig.API_BASE_URL);
    sessions.restoreAsync();
    api =
        new QletterApi(
            BuildConfig.API_BASE_URL,
            new QletterApi.Sessions() {
              @Override
              public Session current() {
                return sessions.snapshot();
              }

              @Override
              public void invalidate(Session sent) {
                sessions.clearIfCurrent(sent);
              }
            });
  }

  public SessionStore sessions() {
    return sessions;
  }

  public QletterApi api() {
    return api;
  }
}
