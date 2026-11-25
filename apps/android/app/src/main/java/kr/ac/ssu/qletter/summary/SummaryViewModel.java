package kr.ac.ssu.qletter.summary;

import android.app.Application;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import androidx.annotation.NonNull;
import androidx.lifecycle.AndroidViewModel;
import androidx.lifecycle.MutableLiveData;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.ThreadLocalRandom;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.ApiError;
import kr.ac.ssu.qletter.common.JsonCall;
import kr.ac.ssu.qletter.common.PollingDelay;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.common.SessionStore;
import okhttp3.Call;

/** 접수는 사용자 동작에서만 하고, 화면이 보일 때 기존 요청의 상태만 확인해요. */
public final class SummaryViewModel extends AndroidViewModel {
  final MutableLiveData<Integer> changes = new MutableLiveData<>(0);
  final List<SummaryRequest> history = new ArrayList<>();
  SummaryRequest current;
  String input = "";
  String cursor;
  boolean loadingHistory;
  boolean loading;
  boolean submitting;
  boolean initialized;
  int error;
  int historyError;
  private final SummaryApi api;
  private final SessionStore sessions;
  private final Long revision;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final Runnable poll = this::refreshCurrent;
  private Call call;
  private Call historyCall;
  private int generation;
  private int historyGeneration;
  private int sequence;
  private int failures;
  private long nextReadAt;
  private long nextWriteAt;
  private long nextHistoryAt;
  private boolean visible;
  private boolean stopPolling;
  private boolean mustRefresh;
  private String uncertainUrl;
  private String restoringId;

  public SummaryViewModel(@NonNull Application application) {
    super(application);
    QletterApplication app = (QletterApplication) application;
    api = new SummaryApi(app.api());
    sessions = app.sessions();
    revision = sessions.changes().getValue();
  }

  private boolean validSession() {
    return sessions.isSignedIn() && Objects.equals(revision, sessions.changes().getValue());
  }

  void start(String restoredId) {
    visible = true;
    if (!checkSession()) return;
    if (!initialized) {
      initialized = true;
      if (restoredId != null && !restoredId.isEmpty()) restoringId = restoredId;
      loadHistory(false);
      if (restoringId != null) read(restoringId);
    } else schedule();
  }

  void stop() {
    visible = false;
    main.removeCallbacks(poll);
  }

  boolean checkSession() {
    if (validSession()) return true;
    generation++;
    historyGeneration++;
    if (call != null) call.cancel();
    if (historyCall != null) historyCall.cancel();
    main.removeCallbacks(poll);
    current = null;
    history.clear();
    cursor = null;
    input = "";
    uncertainUrl = null;
    restoringId = null;
    loading = submitting = loadingHistory = false;
    error = R.string.report_sign_in;
    publish();
    return false;
  }

  boolean canSubmit() {
    String url = SummaryInput.normalize(input);
    return validSession()
        && !loading
        && !submitting
        && url != null
        && SystemClock.elapsedRealtime() >= nextWriteAt
        && !(current != null && current.pending() && current.url.equals(url));
  }

  boolean canRetry() {
    return current != null
        && current.canRetry()
        && !loading
        && !submitting
        && !mustRefresh
        && SystemClock.elapsedRealtime() >= nextWriteAt
        && validSession();
  }

  void submit() {
    if (!checkSession() || loading || submitting) return;
    String url = SummaryInput.normalize(input);
    if (url == null) {
      error = R.string.summary_invalid_url;
      publish();
      return;
    }
    if (!canSubmit()) return;
    beginWrite();
    call = api.submit(url, result(true, url, ++generation));
  }

  void retryAnalysis() {
    if (!checkSession() || !canRetry()) return;
    beginWrite();
    call = api.retry(current, result(true, null, ++generation));
  }

  private void beginWrite() {
    main.removeCallbacks(poll);
    submitting = true;
    error = 0;
    publish();
  }

  void select(SummaryRequest request) {
    if (loading || submitting || !checkSession()) return;
    current = request;
    stopPolling = false;
    mustRefresh = true;
    uncertainUrl = null;
    error = 0;
    publish();
    // 다른 항목을 눌러도 서버가 지정한 조회 대기 시간은 앞당기지 않아요.
    refreshCurrent();
  }

  void refreshCurrent() {
    if (!checkSession() || loading || submitting) return;
    if (uncertainUrl != null) {
      loadHistory(false);
      return;
    }
    if (current == null && restoringId == null) {
      loadHistory(false);
      return;
    }
    long remaining = nextReadAt - SystemClock.elapsedRealtime();
    if (remaining > 0) {
      if (visible) {
        main.removeCallbacks(poll);
        main.postDelayed(poll, remaining);
      }
      return;
    }
    read(current == null ? restoringId : current.id);
  }

  private void read(String id) {
    main.removeCallbacks(poll);
    loading = true;
    error = 0;
    publish();
    call = api.get(id, result(false, null, ++generation));
  }

  void loadHistory(boolean more) {
    if (!checkSession() || loadingHistory || (more && cursor == null)) return;
    if (SystemClock.elapsedRealtime() < nextHistoryAt) return;
    loadingHistory = true;
    historyError = 0;
    int request = ++historyGeneration;
    publish();
    historyCall =
        api.list(
            more ? cursor : null,
            new JsonCall.Result<SummaryApi.Page>() {
              @Override
              public void onSuccess(SummaryApi.Page page) {
                main.post(
                    () -> {
                      if (request != historyGeneration || !checkSession()) return;
                      loadingHistory = false;
                      if (!more) history.clear();
                      for (SummaryRequest row : page.items) replaceHistory(row, true);
                      cursor = page.cursor;
                      if (!loading && !submitting) {
                        SummaryRequest recovered = null;
                        for (SummaryRequest row : page.items) {
                          if (uncertainUrl != null && uncertainUrl.equals(row.url)) recovered = row;
                        }
                        if (recovered != null) {
                          current = recovered;
                          uncertainUrl = null;
                          mustRefresh = false;
                          error = 0;
                          stopPolling = false;
                        } else if (current == null && restoringId == null && !history.isEmpty()) {
                          stopPolling = false;
                          current = history.get(0);
                          for (SummaryRequest row : history)
                            if (row.pending()) {
                              current = row;
                              break;
                            }
                        }
                      }
                      publish();
                      schedule();
                    });
              }

              @Override
              public void onError(ApiError failure) {
                main.post(
                    () -> {
                      if (request != historyGeneration || !checkSession()) return;
                      loadingHistory = false;
                      historyError = SummaryText.apiError(failure);
                      nextHistoryAt = after(failure.retryAfterSeconds());
                      publish();
                    });
              }
            });
  }

  private JsonCall.Result<SummaryRequest> result(boolean write, String submittedUrl, int request) {
    return new JsonCall.Result<SummaryRequest>() {
      @Override
      public void onSuccess(SummaryRequest value) {
        main.post(
            () -> {
              if (request != generation || !checkSession()) return;
              loading = submitting = false;
              restoringId = null;
              current = value;
              uncertainUrl = null;
              mustRefresh = false;
              stopPolling = false;
              failures = 0;
              error = 0;
              nextReadAt = SystemClock.elapsedRealtime() + PollingDelay.millis(0, 0, 0);
              replaceHistory(value, false);
              publish();
              schedule();
            });
      }

      @Override
      public void onError(ApiError failure) {
        main.post(
            () -> {
              if (request != generation || !checkSession()) return;
              loading = submitting = false;
              error = SummaryText.apiError(failure);
              if (write) {
                nextWriteAt = after(failure.retryAfterSeconds());
                mustRefresh = true;
                if (submittedUrl != null
                    && (failure.isNetwork()
                        || failure.status() >= 500
                        || failure.is(ApiError.INVALID_RESPONSE))) {
                  uncertainUrl = submittedUrl;
                  error = R.string.summary_submit_unknown;
                }
              } else {
                mustRefresh = true;
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
                  current = null;
                  restoringId = null;
                  mustRefresh = false;
                }
              }
              publish();
              schedule();
            });
      }
    };
  }

  private void replaceHistory(SummaryRequest value, boolean append) {
    for (int i = 0; i < history.size(); i++)
      if (history.get(i).id.equals(value.id)) {
        history.set(i, value);
        return;
      }
    if (append) history.add(value);
    else history.add(0, value);
  }

  private void schedule() {
    main.removeCallbacks(poll);
    if (visible && !loading && !submitting && !stopPolling && current != null && current.pending())
      main.postDelayed(poll, Math.max(0, nextReadAt - SystemClock.elapsedRealtime()));
  }

  private void publish() {
    changes.setValue(++sequence);
  }

  private static long after(long seconds) {
    long now = SystemClock.elapsedRealtime();
    return now + Math.min((Long.MAX_VALUE - now) / 1000, Math.max(0, seconds)) * 1000;
  }

  @Override
  protected void onCleared() {
    generation++;
    historyGeneration++;
    stop();
    if (call != null) call.cancel();
    if (historyCall != null) historyCall.cancel();
  }
}
