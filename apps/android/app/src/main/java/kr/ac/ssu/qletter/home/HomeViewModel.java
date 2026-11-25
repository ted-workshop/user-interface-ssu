package kr.ac.ssu.qletter.home;

import android.app.Application;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import androidx.annotation.NonNull;
import androidx.lifecycle.AndroidViewModel;
import androidx.lifecycle.MutableLiveData;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.ApiError;
import kr.ac.ssu.qletter.common.JsonCall;
import kr.ac.ssu.qletter.common.PollingDelay;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.common.SessionStore;
import okhttp3.Call;

/** 홈 조회는 읽기만 해요. 채널 지금 확인은 버튼을 눌렀을 때 한 번 접수해요. */
public final class HomeViewModel extends AndroidViewModel {
  final MutableLiveData<Integer> changes = new MutableLiveData<>(0);
  final Map<String, HomeApi.ChannelResult> channels = new LinkedHashMap<>();
  HomeApi.Dashboard dashboard;
  HomeApi.Check check;
  String checkId;
  boolean loading;
  boolean checking;
  int error;
  int checkError;
  private final SessionStore sessions;
  private final Long revision;
  private final HomeApi api;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final Runnable poll = () -> runCheck(false);
  private final Set<String> visited = new HashSet<>();
  private Call dashboardCall;
  private Call checkCall;
  private int generation;
  private int checkGeneration;
  private int sequence;
  private int failures;
  private long nextReadAt;
  private long nextWriteAt;
  private long dashboardReadAt;
  private boolean visible;
  private boolean stopPolling;

  public HomeViewModel(@NonNull Application application) {
    super(application);
    QletterApplication app = (QletterApplication) application;
    sessions = app.sessions();
    revision = sessions.changes().getValue();
    api = new HomeApi(app.api());
  }

  void start(String restoredId) {
    visible = true;
    if (!checkSession()) return;
    if (checkId == null && restoredId != null) checkId = restoredId;
    refresh();
    schedule();
  }

  void stop() {
    visible = false;
    main.removeCallbacks(poll);
  }

  boolean checkSession() {
    if (sessions.isSignedIn() && Objects.equals(revision, sessions.changes().getValue()))
      return true;
    generation++;
    checkGeneration++;
    if (dashboardCall != null) dashboardCall.cancel();
    if (checkCall != null) checkCall.cancel();
    main.removeCallbacks(poll);
    dashboard = null;
    check = null;
    checkId = null;
    channels.clear();
    visited.clear();
    loading = checking = false;
    error = R.string.report_sign_in;
    publish();
    return false;
  }

  void refresh() {
    if (!checkSession() || loading || SystemClock.elapsedRealtime() < dashboardReadAt) return;
    loading = true;
    error = 0;
    int request = ++generation;
    publish();
    dashboardCall =
        api.dashboard(
            new JsonCall.Result<HomeApi.Dashboard>() {
              @Override
              public void onSuccess(HomeApi.Dashboard value) {
                main.post(
                    () -> {
                      if (request != generation || !checkSession()) return;
                      loading = false;
                      dashboard = value;
                      publish();
                    });
              }

              @Override
              public void onError(ApiError failure) {
                main.post(
                    () -> {
                      if (request != generation || !checkSession()) return;
                      loading = false;
                      error =
                          failure.isNetwork()
                              ? R.string.report_error_network
                              : R.string.home_load_error;
                      dashboardReadAt = after(failure.retryAfterSeconds());
                      publish();
                    });
              }
            });
  }

  boolean activeCheck() {
    return checkId != null && (check == null || !check.id.equals(checkId) || check.pending());
  }

  boolean canCheck() {
    return !checking
        && !activeCheck()
        && SystemClock.elapsedRealtime() >= nextWriteAt
        && dashboard != null
        && dashboard.activeChannels > 0;
  }

  void requestCheck() {
    if (!checkSession() || !canCheck()) return;
    check = null;
    checkId = null;
    channels.clear();
    visited.clear();
    stopPolling = false;
    runCheck(true);
  }

  void refreshCheck() {
    if (checkId != null) runCheck(false);
  }

  private void runCheck(boolean create) {
    if (!checkSession() || checking || (!create && checkId == null)) return;
    long wait = nextReadAt - SystemClock.elapsedRealtime();
    if (!create && wait > 0) {
      if (visible) {
        main.removeCallbacks(poll);
        main.postDelayed(poll, wait);
      }
      return;
    }
    checking = true;
    checkError = 0;
    int request = ++checkGeneration;
    main.removeCallbacks(poll);
    publish();
    checkCall =
        api.check(
            create ? null : checkId,
            new JsonCall.Result<HomeApi.Check>() {
              @Override
              public void onSuccess(HomeApi.Check value) {
                main.post(
                    () -> {
                      if (request != checkGeneration || !checkSession()) return;
                      checking = false;
                      check = value;
                      checkId = value.id;
                      failures = 0;
                      stopPolling = false;
                      for (HomeApi.ChannelResult row : value.channels) channels.put(row.id, row);
                      if (!value.pending() && value.nextId != null) {
                        visited.add(value.id);
                        if (visited.contains(value.nextId)) {
                          stopPolling = true;
                          checkError = R.string.home_check_read_error;
                        } else checkId = value.nextId;
                      }
                      nextReadAt = SystemClock.elapsedRealtime() + 5000;
                      if (create) nextWriteAt = SystemClock.elapsedRealtime() + 60000;
                      if (!value.pending()) refresh();
                      publish();
                      schedule();
                    });
              }

              @Override
              public void onError(ApiError failure) {
                main.post(
                    () -> {
                      if (request != checkGeneration || !checkSession()) return;
                      checking = false;
                      checkError = message(failure, create);
                      if (create) nextWriteAt = after(failure.retryAfterSeconds());
                      else {
                        nextReadAt =
                            PollingDelay.deadline(
                                SystemClock.elapsedRealtime(),
                                PollingDelay.millis(
                                    ++failures,
                                    failure.retryAfterSeconds(),
                                    ThreadLocalRandom.current().nextLong(501)));
                        stopPolling =
                            failure.status() == 404
                                || failure.isUnauthorized()
                                || failure.is(ApiError.INVALID_RESPONSE);
                        if (failure.status() == 404) {
                          checkId = null;
                          check = null;
                        }
                      }
                      publish();
                      schedule();
                    });
              }
            });
  }

  private static int message(ApiError failure, boolean create) {
    if (failure.is("AUTOMATION_NOT_READY")) return R.string.home_check_not_ready;
    if (failure.is("AUTOMATION_UNAVAILABLE")) return R.string.home_check_unavailable;
    if (failure.status() == 429) return R.string.home_check_rate_limit;
    if (create && (failure.isNetwork() || failure.status() >= 500))
      return R.string.home_check_unknown;
    return R.string.home_check_read_error;
  }

  private static long after(long seconds) {
    long now = SystemClock.elapsedRealtime();
    return now + Math.min((Long.MAX_VALUE - now) / 1000, Math.max(0, seconds)) * 1000;
  }

  private void schedule() {
    main.removeCallbacks(poll);
    if (visible && !checking && !stopPolling && activeCheck())
      main.postDelayed(poll, Math.max(0, nextReadAt - SystemClock.elapsedRealtime()));
  }

  private void publish() {
    changes.setValue(++sequence);
  }

  @Override
  protected void onCleared() {
    generation++;
    checkGeneration++;
    stop();
    if (dashboardCall != null) dashboardCall.cancel();
    if (checkCall != null) checkCall.cancel();
  }
}
