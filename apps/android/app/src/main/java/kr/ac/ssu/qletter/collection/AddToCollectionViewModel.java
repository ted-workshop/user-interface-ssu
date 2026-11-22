package kr.ac.ssu.qletter.collection;

import android.os.Handler;
import android.os.Looper;
import androidx.annotation.Nullable;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.ViewModel;
import java.util.ArrayList;
import java.util.List;
import okhttp3.Call;

/**
 * 모음에 담기 시트의 체크 목록과 저장·새 모음 요청을 시트보다 오래 들고 있어요.
 *
 * <p>화면을 돌려 시트가 다시 만들어져도 같은 ViewModel이 체크와 진행 중인 요청을 이어 받아요. 결과는 LiveData로 알려서, 시트가 화면에 보일 때만 결과를
 * 보내고 닫아요. 그래서 백그라운드에서 상태 저장 뒤 dismiss하는 일이 없어요.
 */
public final class AddToCollectionViewModel extends ViewModel {
  static final int RELOADED = 0;
  static final int INSERTED = 1;

  /** 목록이 어떻게 바뀌었는지예요. seq가 1씩 늘어서 화면이 놓친 변경이 있는지 알 수 있어요. */
  static final class Change {
    final int seq;
    final int kind;
    final int position;

    private Change(int seq, int kind, int position) {
      this.seq = seq;
      this.kind = kind;
      this.position = position;
    }
  }

  /** 로딩·목록 안내·저장 중·저장 실패 상태예요. */
  static final class Status {
    final boolean loading;
    @Nullable final String message;
    final boolean busy;
    @Nullable final String saveError;

    private Status(
        boolean loading, @Nullable String message, boolean busy, @Nullable String saveError) {
      this.loading = loading;
      this.message = message;
      this.busy = busy;
      this.saveError = saveError;
    }

    /** 목록을 다 받은 뒤에만 새 모음을 만들어요. 먼저 만들면 뒤늦게 온 목록이 새 모음의 체크를 덮어써요. */
    boolean canCreate() {
      return !loading && message == null && !busy;
    }
  }

  /** 한 번만 처리할 알림이에요. 화면이 반영한 뒤 consumeNotice()로 비워요. */
  static final class Notice {
    @Nullable final String newError;
    final boolean created;
    final boolean saved;

    private Notice(@Nullable String newError, boolean created, boolean saved) {
      this.newError = newError;
      this.created = created;
      this.saved = saved;
    }
  }

  private final Handler main = new Handler(Looper.getMainLooper());
  private final List<CollectionCheck> checks = new ArrayList<>();
  private final MutableLiveData<Change> changes = new MutableLiveData<>();
  private final MutableLiveData<Status> status =
      new MutableLiveData<>(new Status(false, null, false, null));
  private final MutableLiveData<Notice> notice = new MutableLiveData<>();
  private CollectionApi api;
  private String reportId;
  private Call loadCall;
  private List<String> restoredChecked;
  private List<String> restoredUnchecked;
  private int pending;
  private String lastError;
  private int seq;
  private boolean hasMore;
  private boolean cleared;

  /**
   * 처음 한 번만 목록을 불러와요. 회전 뒤에는 들고 있던 체크를 그대로 써요.
   *
   * <p>앱이 백그라운드에서 정리됐다가 돌아오면 ViewModel도 새로 만들어져요. 그때는 저장해 둔 체크 변경을 서버 값 위에 다시 입혀요.
   */
  void start(
      CollectionApi api,
      String reportId,
      @Nullable List<String> restoredChecked,
      @Nullable List<String> restoredUnchecked) {
    if (this.api != null) return;
    this.api = api;
    this.reportId = reportId;
    this.restoredChecked = restoredChecked;
    this.restoredUnchecked = restoredUnchecked;
    load();
  }

  /** 화면 목록과 같은 리스트예요. 메인 스레드에서만 바꿔요. */
  List<CollectionCheck> checks() {
    return checks;
  }

  int seq() {
    return seq;
  }

  LiveData<Change> changes() {
    return changes;
  }

  LiveData<Status> status() {
    return status;
  }

  LiveData<Notice> notice() {
    return notice;
  }

  void consumeNotice() {
    notice.setValue(null);
  }

  /** 서버에 한 번에 받는 개수보다 모음이 더 있는지예요. */
  boolean hasMore() {
    return hasMore;
  }

  boolean hasChanges() {
    for (CollectionCheck check : checks) if (check.isChanged()) return true;
    return false;
  }

  private void load() {
    status.setValue(new Status(true, null, false, null));
    loadCall =
        api.checksForReport(
            reportId,
            new CollectionApi.Result<CollectionApi.Page<CollectionCheck>>() {
              @Override
              public void onSuccess(CollectionApi.Page<CollectionCheck> page) {
                onMain(
                    () -> {
                      checks.clear();
                      checks.addAll(page.items);
                      hasMore = page.hasMore;
                      restoreChecks();
                      publish(RELOADED, -1);
                      status.setValue(new Status(false, null, false, null));
                    });
              }

              @Override
              public void onError(String message) {
                onMain(() -> status.setValue(new Status(false, message, false, null)));
              }
            });
  }

  private void restoreChecks() {
    if (restoredChecked == null && restoredUnchecked == null) return;
    for (CollectionCheck check : checks) {
      String id = check.getCollection().getId();
      if (restoredChecked != null && restoredChecked.contains(id)) check.setChecked(true);
      if (restoredUnchecked != null && restoredUnchecked.contains(id)) check.setChecked(false);
    }
    restoredChecked = null;
    restoredUnchecked = null;
  }

  /** 시트 안에서 새 모음을 만들면 맨 위에 체크된 채로 넣어요. 완료를 눌러야 이 리포트가 담겨요. */
  void create(String name) {
    if (!current().canCreate()) return;
    setBusy(true, null);
    api.create(
        name,
        new CollectionApi.Result<ReportCollection>() {
          @Override
          public void onSuccess(ReportCollection value) {
            onMain(
                () -> {
                  CollectionCheck check = new CollectionCheck(value, false);
                  check.setChecked(true);
                  checks.add(0, check);
                  publish(INSERTED, 0);
                  status.setValue(new Status(false, null, false, null));
                  notice.setValue(new Notice(null, true, false));
                });
          }

          @Override
          public void onError(String message) {
            onMain(
                () -> {
                  setBusy(false, null);
                  notice.setValue(new Notice(message, false, false));
                });
          }
        });
  }

  /** 체크가 바뀐 모음에만 담기·빼기를 보내고, 모든 응답이 온 뒤 결과를 정리해요. */
  void save() {
    if (current().busy) return;
    List<CollectionCheck> changed = new ArrayList<>();
    for (CollectionCheck check : checks) if (check.isChanged()) changed.add(check);
    if (changed.isEmpty()) return;
    setBusy(true, null);
    pending = changed.size();
    lastError = null;
    for (CollectionCheck check : changed) {
      CollectionApi.Result<Void> result =
          new CollectionApi.Result<Void>() {
            @Override
            public void onSuccess(Void value) {
              onMain(() -> finishOne(check, null));
            }

            @Override
            public void onError(String message) {
              onMain(() -> finishOne(check, message));
            }
          };
      String collectionId = check.getCollection().getId();
      if (check.isChecked()) api.addReport(collectionId, reportId, result);
      else api.removeReport(collectionId, reportId, result);
    }
  }

  private void finishOne(CollectionCheck check, @Nullable String error) {
    if (error == null) check.markSaved();
    else lastError = error;
    if (--pending > 0) return;
    if (lastError == null) {
      notice.setValue(new Notice(null, false, true));
      return;
    }
    // 일부만 실패하면 성공한 모음은 새 기준이 되고, 실패한 모음만 바뀐 채로 남아 다시 보낼 수 있어요.
    setBusy(false, lastError);
  }

  @Override
  protected void onCleared() {
    // 시트가 완전히 사라질 때만 불려요. 회전 때는 불리지 않아 요청이 이어져요.
    // 담기·빼기는 서버에 반영되도록 두고, 결과를 받을 화면이 없으니 목록 요청만 취소해요.
    cleared = true;
    if (loadCall != null) loadCall.cancel();
    main.removeCallbacksAndMessages(null);
  }

  /** 작업 스레드에서 온 응답을 메인 스레드로 넘겨요. ViewModel이 정리된 뒤에는 버려요. */
  private void onMain(Runnable action) {
    main.post(
        () -> {
          if (!cleared) action.run();
        });
  }

  private Status current() {
    return status.getValue();
  }

  private void setBusy(boolean busy, @Nullable String saveError) {
    Status now = current();
    status.setValue(new Status(now.loading, now.message, busy, saveError));
  }

  private void publish(int kind, int position) {
    seq++;
    changes.setValue(new Change(seq, kind, position));
  }
}
