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
 * 댓글 목록과 등록·삭제 요청을 화면보다 오래 들고 있어요.
 *
 * <p>화면을 돌려 Fragment가 다시 만들어져도 같은 ViewModel이 목록과 진행 중인 요청을 이어 받아요. 서버 응답은 메인 스레드에서 목록을 바꾸고, 바뀐 내용은
 * LiveData로 알려요. LiveData는 화면이 보일 때만 전달해서 회전 중에 온 결과도 새 화면에 반영돼요.
 *
 * <p>서버는 최신 댓글부터 20개씩 줘요. 처음에는 최신 20개를 받고, "이전 댓글 보기"를 누르면 더 오래된 댓글을 목록 위에 붙여요.
 */
public final class ReportCommentsViewModel extends ViewModel {
  static final int RELOADED = 0;
  static final int INSERTED = 1;
  static final int REMOVED = 2;
  static final int PREPENDED = 3;

  /** 목록이 어떻게 바뀌었는지예요. seq가 1씩 늘어서 화면이 놓친 변경이 있는지 알 수 있어요. */
  static final class Change {
    final int seq;
    final int kind;
    final int position;
    // PREPENDED일 때 위에 붙은 댓글 수예요.
    final int count;

    private Change(int seq, int kind, int position, int count) {
      this.seq = seq;
      this.kind = kind;
      this.position = position;
      this.count = count;
    }
  }

  /** 로딩·실패·권한 없음·등록 중·이전 댓글 불러오기 상태예요. */
  static final class Status {
    final boolean loading;
    @Nullable final String loadError;
    @Nullable final String noAccess;
    final boolean submitting;
    final boolean olderLoading;
    @Nullable final String olderError;

    private Status(
        boolean loading,
        @Nullable String loadError,
        @Nullable String noAccess,
        boolean submitting,
        boolean olderLoading,
        @Nullable String olderError) {
      this.loading = loading;
      this.loadError = loadError;
      this.noAccess = noAccess;
      this.submitting = submitting;
      this.olderLoading = olderLoading;
      this.olderError = olderError;
    }

    /** 목록을 받는 중에는 등록하지 않아요. 먼저 등록하면 뒤늦게 온 목록이 새 댓글을 덮어써요. */
    boolean canSubmit() {
      return !loading && noAccess == null && !submitting;
    }

    private Status loading(boolean value, @Nullable String error) {
      return new Status(value, error, null, submitting, false, null);
    }

    private Status submitting(boolean value) {
      return new Status(loading, loadError, noAccess, value, olderLoading, olderError);
    }

    private Status older(boolean value, @Nullable String error) {
      return new Status(loading, loadError, noAccess, submitting, value, error);
    }

    private Status noAccess(String message) {
      return new Status(false, null, message, submitting, false, null);
    }
  }

  /** 한 번만 보여 줄 알림이에요. 화면이 반영한 뒤 consumeNotice()로 비워요. */
  static final class Notice {
    @Nullable final String error;
    final boolean submitted;

    private Notice(@Nullable String error, boolean submitted) {
      this.error = error;
      this.submitted = submitted;
    }
  }

  private final Handler main = new Handler(Looper.getMainLooper());
  private final List<Comment> comments = new ArrayList<>();
  private final Set<String> deleting = new HashSet<>();
  private final List<Call> calls = new ArrayList<>();
  private final MutableLiveData<Change> changes = new MutableLiveData<>();
  private final MutableLiveData<Status> status =
      new MutableLiveData<>(new Status(false, null, null, false, false, null));
  private final MutableLiveData<Notice> notice = new MutableLiveData<>();
  private CommentApi api;
  private String reportId;
  private Call loadCall;
  private Call olderCall;
  // 더 오래된 댓글을 받을 위치예요. null이면 더 없어요.
  @Nullable private String cursor;
  // 다시 불러오면 1 늘려서, 그 전에 보낸 이전 댓글 요청의 응답을 버려요.
  private int generation;
  private int seq;
  private boolean cleared;

  /** 처음 한 번만 목록을 불러와요. 회전 뒤에는 들고 있던 목록을 그대로 써요. */
  void start(CommentApi api, String reportId) {
    if (this.api != null) return;
    this.api = api;
    this.reportId = reportId;
    load();
  }

  /** 화면 목록과 같은 리스트예요. 메인 스레드에서만 바꿔요. */
  List<Comment> comments() {
    return Collections.unmodifiableList(comments);
  }

  int seq() {
    return seq;
  }

  /** 서버에 더 오래된 댓글이 남아 있는지예요. */
  boolean hasOlder() {
    return cursor != null;
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

  boolean isDeleting(String commentId) {
    return deleting.contains(commentId);
  }

  /** 최신 댓글부터 다시 받아요. 이어 받던 이전 댓글 요청은 버려요. */
  void load() {
    if (loadCall != null) loadCall.cancel();
    if (olderCall != null) olderCall.cancel();
    int request = ++generation;
    status.setValue(current().loading(true, null));
    loadCall =
        track(
            api.list(
                reportId,
                null,
                new CommentApi.Result<CommentApi.Page>() {
                  @Override
                  public void onSuccess(CommentApi.Page page) {
                    onMain(
                        () -> {
                          if (request != generation) return;
                          comments.clear();
                          comments.addAll(page.items);
                          cursor = page.nextCursor;
                          publish(RELOADED, -1, 0);
                          status.setValue(current().loading(false, null));
                        });
                  }

                  @Override
                  public void onNoAccess(String message) {
                    onMain(
                        () -> {
                          if (request == generation) showNoAccess(message);
                        });
                  }

                  @Override
                  public void onError(String message) {
                    onMain(
                        () -> {
                          if (request == generation)
                            status.setValue(current().loading(false, message));
                        });
                  }
                }));
  }

  /** 더 오래된 댓글을 받아 목록 위에 붙여요. 받는 중이면 다시 보내지 않아요. */
  void loadOlder() {
    Status now = current();
    if (cursor == null || now.loading || now.olderLoading || now.noAccess != null) return;
    int request = generation;
    status.setValue(now.older(true, null));
    olderCall =
        track(
            api.list(
                reportId,
                cursor,
                new CommentApi.Result<CommentApi.Page>() {
                  @Override
                  public void onSuccess(CommentApi.Page page) {
                    onMain(
                        () -> {
                          if (request != generation) return;
                          // 그사이 같은 댓글을 이미 받았으면 두 번 넣지 않아요.
                          List<Comment> older = new ArrayList<>();
                          for (Comment comment : page.items)
                            if (indexOf(comment.getId()) == -1) older.add(comment);
                          comments.addAll(0, older);
                          cursor = page.nextCursor;
                          publish(PREPENDED, 0, older.size());
                          status.setValue(current().older(false, null));
                        });
                  }

                  @Override
                  public void onNoAccess(String message) {
                    onMain(
                        () -> {
                          if (request == generation) showNoAccess(message);
                        });
                  }

                  @Override
                  public void onError(String message) {
                    onMain(
                        () -> {
                          if (request == generation)
                            status.setValue(current().older(false, message));
                        });
                  }
                }));
  }

  /** 등록할 수 없는 상태면 보내지 않아요. 빈 글자 확인은 화면에서 먼저 해요. */
  void submit(String body) {
    if (!current().canSubmit()) return;
    status.setValue(current().submitting(true));
    track(
        api.create(
            reportId,
            body,
            new CommentApi.Result<Comment>() {
              @Override
              public void onSuccess(Comment comment) {
                onMain(
                    () -> {
                      status.setValue(current().submitting(false));
                      comments.add(comment);
                      publish(INSERTED, comments.size() - 1, 1);
                      notice.setValue(new Notice(null, true));
                    });
              }

              @Override
              public void onNoAccess(String message) {
                onMain(
                    () -> {
                      status.setValue(current().submitting(false));
                      showNoAccess(message);
                    });
              }

              @Override
              public void onError(String message) {
                onMain(
                    () -> {
                      status.setValue(current().submitting(false));
                      notice.setValue(new Notice(message, false));
                    });
              }
            }));
  }

  /** 지우는 중인 댓글은 다시 보내지 않아요. 서버는 이미 지운 댓글에 404를 줘요. */
  void delete(String commentId) {
    if (!deleting.add(commentId)) return;
    track(
        api.delete(
            reportId,
            commentId,
            new CommentApi.Result<Void>() {
              @Override
              public void onSuccess(Void value) {
                onMain(
                    () -> {
                      deleting.remove(commentId);
                      // 요청 중에 목록이 다시 불러와졌을 수 있어 id로 위치를 다시 찾아요.
                      int position = indexOf(commentId);
                      if (position == -1) return;
                      comments.remove(position);
                      publish(REMOVED, position, 1);
                    });
              }

              @Override
              public void onNoAccess(String message) {
                // 삭제의 404는 이미 지운 댓글과 권한 없음이 같아요. 목록을 다시 받아 실제 상태를 보여 줘요.
                onMain(
                    () -> {
                      deleting.remove(commentId);
                      load();
                    });
              }

              @Override
              public void onError(String message) {
                onMain(
                    () -> {
                      deleting.remove(commentId);
                      notice.setValue(new Notice(message, false));
                    });
              }
            }));
  }

  @Override
  protected void onCleared() {
    // Fragment가 완전히 사라질 때만 불려요. 회전 때는 불리지 않아 요청이 이어져요.
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

  private void showNoAccess(String message) {
    status.setValue(current().noAccess(message));
  }

  private int indexOf(String commentId) {
    for (int i = 0; i < comments.size(); i++) {
      if (comments.get(i).getId().equals(commentId)) return i;
    }
    return -1;
  }
}
