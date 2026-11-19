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
 */
public final class ReportCommentsViewModel extends ViewModel {
  static final int RELOADED = 0;
  static final int INSERTED = 1;
  static final int REMOVED = 2;

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

  /** 로딩·실패·권한 없음·등록 중 상태예요. */
  static final class Status {
    final boolean loading;
    @Nullable final String loadError;
    @Nullable final String noAccess;
    final boolean submitting;

    private Status(
        boolean loading,
        @Nullable String loadError,
        @Nullable String noAccess,
        boolean submitting) {
      this.loading = loading;
      this.loadError = loadError;
      this.noAccess = noAccess;
      this.submitting = submitting;
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
      new MutableLiveData<>(new Status(false, null, null, false));
  private final MutableLiveData<Notice> notice = new MutableLiveData<>();
  private CommentApi api;
  private String reportId;
  private Call loadCall;
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

  void load() {
    if (loadCall != null) loadCall.cancel();
    Status now = status.getValue();
    status.setValue(new Status(true, null, null, now.submitting));
    loadCall =
        track(
            api.list(
                reportId,
                new CommentApi.Result<List<Comment>>() {
                  @Override
                  public void onSuccess(List<Comment> value) {
                    onMain(
                        () -> {
                          comments.clear();
                          comments.addAll(value);
                          publish(RELOADED, -1);
                          Status now = status.getValue();
                          status.setValue(new Status(false, null, null, now.submitting));
                        });
                  }

                  @Override
                  public void onNoAccess(String message) {
                    onMain(() -> showNoAccess(message));
                  }

                  @Override
                  public void onError(String message) {
                    onMain(
                        () -> {
                          Status now = status.getValue();
                          status.setValue(new Status(false, message, null, now.submitting));
                        });
                  }
                }));
  }

  /** 등록 중이면 다시 보내지 않아요. 빈 글자 확인은 화면에서 먼저 해요. */
  void submit(String body) {
    Status current = status.getValue();
    if (current.submitting) return;
    status.setValue(new Status(current.loading, current.loadError, current.noAccess, true));
    track(
        api.create(
            reportId,
            body,
            new CommentApi.Result<Comment>() {
              @Override
              public void onSuccess(Comment comment) {
                onMain(
                    () -> {
                      setSubmitting(false);
                      comments.add(comment);
                      publish(INSERTED, comments.size() - 1);
                      notice.setValue(new Notice(null, true));
                    });
              }

              @Override
              public void onNoAccess(String message) {
                onMain(
                    () -> {
                      setSubmitting(false);
                      showNoAccess(message);
                    });
              }

              @Override
              public void onError(String message) {
                onMain(
                    () -> {
                      setSubmitting(false);
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
                      publish(REMOVED, position);
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

  private void publish(int kind, int position) {
    seq++;
    changes.setValue(new Change(seq, kind, position));
  }

  private void setSubmitting(boolean submitting) {
    Status now = status.getValue();
    status.setValue(new Status(now.loading, now.loadError, now.noAccess, submitting));
  }

  private void showNoAccess(String message) {
    Status now = status.getValue();
    status.setValue(new Status(false, null, message, now.submitting));
  }

  private int indexOf(String commentId) {
    for (int i = 0; i < comments.size(); i++) {
      if (comments.get(i).getId().equals(commentId)) return i;
    }
    return -1;
  }
}
