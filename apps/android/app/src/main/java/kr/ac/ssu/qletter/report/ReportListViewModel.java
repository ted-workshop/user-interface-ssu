package kr.ac.ssu.qletter.report;

import android.app.Application;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.lifecycle.AndroidViewModel;
import androidx.lifecycle.MutableLiveData;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.common.SessionStore;
import okhttp3.Call;

/** 회전 중 조회와 페이지를 유지하되 다른 계정에는 넘기지 않아요. */
public final class ReportListViewModel extends AndroidViewModel {
  final MutableLiveData<Integer> changes = new MutableLiveData<>(0);
  final List<ReportItem> items = new ArrayList<>();
  ReportQuery query = new ReportQuery("", "", "", "");
  String cursor;
  boolean loading;
  boolean initialized;
  boolean nextFailed;
  int error;
  private final SessionStore sessions;
  private final ReportApi api;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final Long revision;
  private Call call;
  private int generation;

  public ReportListViewModel(@NonNull Application application) {
    super(application);
    QletterApplication app = (QletterApplication) application;
    sessions = app.sessions();
    revision = sessions.changes().getValue();
    api = new ReportApi(app.api(), app.getResources());
  }

  boolean validSession() {
    return sessions.isSignedIn() && Objects.equals(revision, sessions.changes().getValue());
  }

  void refresh(ReportQuery query) {
    this.query = query;
    items.clear();
    cursor = null;
    load(false);
  }

  void load(boolean next) {
    if (next && (loading || cursor == null)) return;
    if (call != null) call.cancel();
    final int request = ++generation;
    initialized = true;
    error = 0;
    nextFailed = false;
    if (!validSession()) {
      items.clear();
      cursor = null;
      loading = false;
      error = R.string.report_sign_in;
      publish();
      return;
    }
    loading = true;
    publish();
    call =
        api.list(
            query,
            next ? cursor : null,
            new ReportApi.Result<ReportApi.Page>() {
              @Override
              public void success(ReportApi.Page page) {
                main.post(
                    () -> {
                      if (request != generation) return;
                      if (!validSession()) {
                        load(false);
                        return;
                      }
                      if (!next) items.clear();
                      // 페이지를 읽는 사이 목록이 바뀌어도 같은 리포트를 두 번 표시하지 않아요.
                      for (ReportItem item : page.items) {
                        boolean exists = false;
                        for (ReportItem current : items)
                          if (current.id.equals(item.id)) {
                            exists = true;
                            break;
                          }
                        if (!exists) items.add(item);
                      }
                      cursor = page.cursor;
                      loading = false;
                      publish();
                    });
              }

              @Override
              public void failure(int message) {
                main.post(
                    () -> {
                      if (request != generation) return;
                      if (!validSession()) {
                        load(false);
                        return;
                      }
                      loading = false;
                      error = message;
                      nextFailed = next;
                      publish();
                    });
              }
            });
  }

  void checkSession() {
    if (!validSession()) load(false);
  }

  private void publish() {
    changes.setValue(generation);
  }

  @Override
  protected void onCleared() {
    generation++;
    if (call != null) call.cancel();
  }
}
