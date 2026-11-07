package kr.ac.ssu.qletter;

import android.app.Application;

public final class QletterApplication extends Application {
  private SessionStore sessions;
  private QletterApi api;

  @Override
  public void onCreate() {
    super.onCreate();
    sessions = new SessionStore(this, BuildConfig.API_BASE_URL);
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
