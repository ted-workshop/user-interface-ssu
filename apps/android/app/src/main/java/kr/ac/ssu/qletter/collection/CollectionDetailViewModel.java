package kr.ac.ssu.qletter.collection;

import android.os.Handler;
import android.os.Looper;
import androidx.annotation.Nullable;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.ViewModel;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import okhttp3.Call;

/**
 * 모음 상세의 리포트 목록과 빼기 요청을 화면보다 오래 들고 있어요.
 *
 * <p>화면을 돌려 Activity가 다시 만들어져도 같은 ViewModel이 목록과 진행 중인 요청을 이어 받아요. 서버는 담은 시각 최신순으로 20개씩 줘요. "리포트 더
 * 보기"를 누르면 그다음 20개를 목록 아래에 붙여요.
 */
public final class CollectionDetailViewModel extends ViewModel {
  static final int RELOADED = 0;
  static final int APPENDED = 1;
  static final int REMOVED = 2;
  // 빼기 버튼 잠금처럼 줄 내용만 바뀌었어요.
  static final int CHANGED = 3;

  /** 목록이 어떻게 바뀌었는지예요. seq가 1씩 늘어서 화면이 놓친 변경이 있는지 알 수 있어요. */
  static final class Change {
    final int seq;
    final int kind;
    final int position;
    // APPENDED일 때 아래에 붙은 리포트 수예요.
    final int count;

    private Change(int seq, int kind, int position, int count) {
      this.seq = seq;
      this.kind = kind;
      this.position = position;
      this.count = count;
    }
  }

  /** 처음 불러오기와 더 불러오기 상태예요. */
  static final class Status {
    final boolean loading;
    @Nullable final String loadError;
    final boolean moreLoading;
    @Nullable final String moreError;

    private Status(
        boolean loading,
        @Nullable String loadError,
        boolean moreLoading,
        @Nullable String moreError) {
      this.loading = loading;
      this.loadError = loadError;
      this.moreLoading = moreLoading;
      this.moreError = moreError;
    }

    private Status loading(boolean value, @Nullable String error) {
      return new Status(value, error, false, null);
    }

    private Status more(boolean value, @Nullable String error) {
      return new Status(loading, loadError, value, error);
    }
  }

  private final Handler main = new Handler(Looper.getMainLooper());
  private final List<CollectionReport> reports = new ArrayList<>();
  private final Set<String> removing = new HashSet<>();
  // 다시 불러오기를 시작한 뒤 빼기에 성공한 리포트예요. 그보다 늦게 온 목록 응답에 남아 있어도 다시 넣지 않아요.
  private final Set<String> removedSinceLoad = new HashSet<>();
  private final List<Call> calls = new ArrayList<>();
  private final MutableLiveData<Change> changes = new MutableLiveData<>();
  private final MutableLiveData<Status> status =
      new MutableLiveData<>(new Status(false, null, false, null));
  // 한 번만 보여 줄 빼기 실패 문구예요. 화면이 보여 준 뒤 consumeError()로 비워요.
  private final MutableLiveData<String> error = new MutableLiveData<>();
  // 헤더에 보여 줄 리포트 수예요. 빼기에 성공하면 줄어요.
  private final MutableLiveData<Integer> reportCount = new MutableLiveData<>();
  // 빼는 요청이 하나라도 남아 있는지예요. 그동안 이름 바꾸기를 잠가요.
  private final MutableLiveData<Boolean> removingAny = new MutableLiveData<>(false);
  private CollectionApi api;
  private String collectionId;
  private Call loadCall;
  private Call moreCall;
  // 다음 20개를 받을 위치예요. null이면 더 없어요.
  @Nullable private String cursor;
  // 다시 불러오면 1 늘려서, 그 전에 보낸 더 불러오기 요청의 응답을 버려요.
  private int generation;
  private int seq;
  // 헤더 개수를 바꾼 횟수예요. 개수 조회를 보낸 뒤 바뀌었으면 그 응답은 낡은 값이라 버려요.
  private int countEdits;
  // 시트에서 돌아와 개수를 다시 받아야 하는데 아직 맞추지 못했는지예요. 빼기가 끝나면 다시 조회해요.
  private boolean countWanted;
  // 개수 조회는 한 번에 하나만 보내요.
  private boolean countLoading;
  private boolean cleared;

  /** 처음 한 번만 목록을 불러와요. 회전 뒤에는 들고 있던 목록을 그대로 써요. */
  void start(CollectionApi api, String collectionId, int count) {
    if (this.api != null) return;
    this.api = api;
    this.collectionId = collectionId;
    reportCount.setValue(count);
    load();
  }

  /** 화면 목록과 같은 리스트예요. 메인 스레드에서만 바꿔요. */
  List<CollectionReport> reports() {
    return Collections.unmodifiableList(reports);
  }

  int seq() {
    return seq;
  }

  /** 서버에 더 받을 리포트가 남아 있는지예요. */
  boolean hasMore() {
    return cursor != null;
  }

  boolean isRemoving(String reportId) {
    return removing.contains(reportId);
  }

  /**
   * 빼는 중인지예요. 이름 바꾸기 응답의 개수는 서버가 그 순간 센 값이라, 빼기와 겹치면 늦게 온 빼기 성공이 한 번 더 줄여요. 그래서 빼는 동안에는 이름 바꾸기를 열지
   * 않아요.
   */
  LiveData<Boolean> removingAny() {
    return removingAny;
  }

  LiveData<Change> changes() {
    return changes;
  }

  LiveData<Status> status() {
    return status;
  }

  LiveData<String> error() {
    return error;
  }

  void consumeError() {
    error.setValue(null);
  }

  LiveData<Integer> reportCount() {
    return reportCount;
  }

  /** 이름을 바꾸면 서버가 준 최신 개수로 맞춰요. */
  void setReportCount(int count) {
    countEdits++;
    countWanted = false;
    reportCount.setValue(count);
  }

  /** 처음 20개부터 다시 받아요. 이어 받던 더 불러오기 요청은 버려요. */
  void load() {
    if (loadCall != null) loadCall.cancel();
    if (moreCall != null) moreCall.cancel();
    int request = ++generation;
    removedSinceLoad.clear();
    status.setValue(current().loading(true, null));
    loadCall =
        track(
            api.reports(
                collectionId,
                null,
                new CollectionApi.Result<CollectionApi.Page<CollectionReport>>() {
                  @Override
                  public void onSuccess(CollectionApi.Page<CollectionReport> page) {
                    onMain(
                        () -> {
                          if (request != generation) return;
                          reports.clear();
                          for (CollectionReport report : page.items)
                            if (!removedSinceLoad.contains(report.getId())) reports.add(report);
                          cursor = page.nextCursor;
                          publish(RELOADED, -1, 0);
                          status.setValue(current().loading(false, null));
                        });
                  }

                  @Override
                  public void onError(String message) {
                    onMain(
                        () -> {
                          if (request != generation) return;
                          // 실패하면 예전 목록을 남기지 않고 오류와 다시 시도만 보여 줘요.
                          reports.clear();
                          cursor = null;
                          publish(RELOADED, -1, 0);
                          status.setValue(current().loading(false, message));
                        });
                  }
                }));
  }

  /** 리포트 상세의 모음에 담기 시트에서 이 모음이 바뀌었을 수 있을 때 불러요. 목록은 처음부터 다시 받고, 헤더 개수는 모음 목록에서 다시 받아요. */
  void refresh() {
    load();
    countWanted = true;
    loadCount();
  }

  /**
   * 모음 목록에서 이 모음의 개수를 받아 헤더에 맞춰요. 빼는 중이면 보내지 않고, 빼기가 끝난 뒤 다시 불러요.
   *
   * <p>응답이 오기 전에 빼기가 성공하면 그 응답은 빼기 전 개수일 수 있어요. 그때는 버리고 다시 조회해요.
   */
  private void loadCount() {
    if (!countWanted || countLoading || !removing.isEmpty()) return;
    countLoading = true;
    int edits = countEdits;
    track(
        api.list(
            new CollectionApi.Result<CollectionApi.Page<ReportCollection>>() {
              @Override
              public void onSuccess(CollectionApi.Page<ReportCollection> page) {
                onMain(
                    () -> {
                      countLoading = false;
                      if (!countWanted) return;
                      if (edits != countEdits) {
                        loadCount();
                        return;
                      }
                      // 그사이 빼기를 시작했으면 그 빼기가 끝난 뒤 다시 조회해요.
                      if (!removing.isEmpty()) return;
                      countWanted = false;
                      for (ReportCollection item : page.items)
                        if (item.getId().equals(collectionId))
                          reportCount.setValue(item.getReportCount());
                    });
              }

              @Override
              public void onError(String message) {
                // 개수만 못 맞춘 거라 목록 오류와 따로 알리지 않아요. 다음에 들어오면 다시 받아요.
                onMain(
                    () -> {
                      countLoading = false;
                      countWanted = false;
                    });
              }
            }));
  }

  /** 다음 20개를 받아 목록 아래에 붙여요. 받는 중이면 다시 보내지 않아요. */
  void loadMore() {
    Status now = current();
    if (cursor == null || now.loading || now.moreLoading) return;
    int request = generation;
    status.setValue(now.more(true, null));
    moreCall =
        track(
            api.reports(
                collectionId,
                cursor,
                new CollectionApi.Result<CollectionApi.Page<CollectionReport>>() {
                  @Override
                  public void onSuccess(CollectionApi.Page<CollectionReport> page) {
                    onMain(
                        () -> {
                          if (request != generation) return;
                          // 그사이 같은 리포트를 이미 받았으면 두 번 넣지 않아요.
                          int start = reports.size();
                          // 요청 뒤에 뺀 리포트도 다시 넣지 않아요.
                          for (CollectionReport report : page.items)
                            if (indexOf(report.getId()) == -1
                                && !removedSinceLoad.contains(report.getId())) reports.add(report);
                          cursor = page.nextCursor;
                          publish(APPENDED, start, reports.size() - start);
                          status.setValue(current().more(false, null));
                        });
                  }

                  @Override
                  public void onError(String message) {
                    onMain(
                        () -> {
                          if (request == generation)
                            status.setValue(current().more(false, message));
                        });
                  }
                }));
  }

  /** 리포트를 모음에서 빼요. 빼는 중인 리포트는 다시 보내지 않아요. 리포트는 내 리포트에 남아요. */
  void remove(String reportId) {
    if (reportId == null || !removing.add(reportId)) return;
    removingAny.setValue(true);
    // 빼는 동안 그 줄의 빼기 버튼을 잠가요.
    notifyRow(reportId);
    track(
        api.removeReport(
            collectionId,
            reportId,
            new CollectionApi.Result<Void>() {
              @Override
              public void onSuccess(Void value) {
                onMain(
                    () -> {
                      removing.remove(reportId);
                      removingAny.setValue(!removing.isEmpty());
                      removedSinceLoad.add(reportId);
                      countEdits++;
                      Integer count = reportCount.getValue();
                      if (count != null && count > 0) reportCount.setValue(count - 1);
                      // 시트에서 돌아와 맞추던 개수가 있으면 빼기가 다 끝난 지금 다시 받아요.
                      loadCount();
                      // 요청 중에 목록이 다시 불러와졌을 수 있어 id로 위치를 다시 찾아요.
                      int position = indexOf(reportId);
                      if (position == -1) return;
                      reports.remove(position);
                      publish(REMOVED, position, 1);
                      // 받은 리포트를 다 뺐는데 서버에 더 있으면, 빈 화면 대신 다음 20개를 받아요.
                      if (reports.isEmpty()) loadMore();
                    });
              }

              @Override
              public void onError(String message) {
                onMain(
                    () -> {
                      removing.remove(reportId);
                      removingAny.setValue(!removing.isEmpty());
                      notifyRow(reportId);
                      error.setValue(message);
                      loadCount();
                    });
              }
            }));
  }

  @Override
  protected void onCleared() {
    // Activity가 완전히 끝날 때만 불려요. 회전 때는 불리지 않아 요청이 이어져요.
    cleared = true;
    for (Call call : calls) call.cancel();
    main.removeCallbacksAndMessages(null);
  }

  private Status current() {
    return status.getValue();
  }

  private Call track(Call call) {
    calls.add(call);
    return call;
  }

  /** 작업 스레드에서 온 응답을 메인 스레드로 넘겨요. ViewModel이 정리된 뒤에는 버려요. */
  private void onMain(Runnable action) {
    main.post(
        () -> {
          if (!cleared) action.run();
        });
  }

  private void publish(int kind, int position, int count) {
    seq++;
    changes.setValue(new Change(seq, kind, position, count));
  }

  /** 빼기 버튼의 잠금 상태만 바뀐 줄을 다시 그려요. 화면에서는 CHANGED로 받아요. */
  private void notifyRow(String reportId) {
    int position = indexOf(reportId);
    if (position != -1) publish(CHANGED, position, 1);
  }

  private int indexOf(String reportId) {
    for (int i = 0; i < reports.size(); i++) {
      if (reports.get(i).getId().equals(reportId)) return i;
    }
    return -1;
  }
}
