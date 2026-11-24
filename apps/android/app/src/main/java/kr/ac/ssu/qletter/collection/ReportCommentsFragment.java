package kr.ac.ssu.qletter.collection;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModelProvider;
import androidx.recyclerview.widget.LinearLayoutManager;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.databinding.FragmentReportCommentsBinding;

/**
 * 피그마 61:265 리포트 상세 맨 아래 댓글 영역이에요. 리포트 상세(#28)가 생기면 그 화면 아래에 끼워 넣어요.
 *
 * <p>쓰는 도구: ReportCommentsViewModel(목록·요청 보관), CommentAdapter(목록), CommentDeleteDialog(삭제 확인).
 */
public class ReportCommentsFragment extends Fragment {
  private static final String ARG_REPORT_ID = "reportId";

  private FragmentReportCommentsBinding binding;
  private CommentAdapter adapter;
  private CommentApi commentApi;
  private ReportCommentsViewModel model;
  // 이 화면의 어댑터가 반영한 마지막 변경 번호예요.
  private int appliedSeq;

  public static ReportCommentsFragment newInstance(String reportId) {
    ReportCommentsFragment fragment = new ReportCommentsFragment();
    Bundle args = new Bundle();
    args.putString(ARG_REPORT_ID, reportId);
    fragment.setArguments(args);
    return fragment;
  }

  @Nullable
  @Override
  public View onCreateView(
      @NonNull LayoutInflater inflater,
      @Nullable ViewGroup container,
      @Nullable Bundle savedInstanceState) {
    binding = FragmentReportCommentsBinding.inflate(inflater, container, false);
    return binding.getRoot();
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
    super.onViewCreated(view, savedInstanceState);
    QletterApplication app = (QletterApplication) requireActivity().getApplication();
    commentApi = new CommentApi(app.api(), getResources());
    // Fragment 범위 ViewModel이라 회전해도 같은 목록과 요청을 이어 받아요.
    model = new ViewModelProvider(this).get(ReportCommentsViewModel.class);
    model.start(commentApi, reportId());

    binding.commentList.setLayoutManager(new LinearLayoutManager(requireContext()));
    adapter = new CommentAdapter(model.comments(), this::confirmDelete);
    binding.commentList.setAdapter(adapter);
    // 새 어댑터는 지금 목록을 통째로 그리니 지금까지의 변경은 이미 반영한 셈이에요.
    appliedSeq = model.seq();
    updateCount();

    binding.commentSubmit.setOnClickListener(v -> submitComment());
    binding.commentRetry.setOnClickListener(v -> model.load());
    binding.commentOlder.setOnClickListener(v -> model.loadOlder());
    loadNote();

    model.changes().observe(getViewLifecycleOwner(), this::applyChange);
    model.status().observe(getViewLifecycleOwner(), this::renderStatus);
    model.notice().observe(getViewLifecycleOwner(), this::renderNotice);

    getChildFragmentManager()
        .setFragmentResultListener(
            CommentDeleteDialog.REQUEST_KEY,
            getViewLifecycleOwner(),
            (key, result) -> model.delete(result.getString(CommentDeleteDialog.RESULT_ID)));
  }

  @Override
  public void onDestroyView() {
    super.onDestroyView();
    binding = null;
  }

  /** 삭제를 누르면 확인창부터 띄워요. 삭제하기를 누르면 삭제 결과 받기로 돌아와요. */
  private void confirmDelete(Comment comment) {
    if (model.isDeleting(comment.getId())) return;
    CommentDeleteDialog.open(getChildFragmentManager(), comment.getId());
  }

  private String reportId() {
    return requireArguments().getString(ARG_REPORT_ID);
  }

  /** 목록이 바뀐 만큼 어댑터에 알려요. 화면이 보이지 않는 동안 놓친 변경이 있으면 전체를 다시 그려요. */
  private void applyChange(@Nullable ReportCommentsViewModel.Change change) {
    if (change == null || change.seq <= appliedSeq) return;
    boolean missed = change.seq != appliedSeq + 1;
    appliedSeq = change.seq;
    if (missed || change.kind == ReportCommentsViewModel.RELOADED) {
      adapter.notifyDataSetChanged();
    } else if (change.kind == ReportCommentsViewModel.PREPENDED) {
      // 이전 댓글은 "이전 댓글 보기" 바로 아래, 목록 맨 위에 붙어요.
      adapter.notifyItemRangeInserted(0, change.count);
    } else if (change.kind == ReportCommentsViewModel.INSERTED) {
      adapter.notifyItemInserted(change.position);
      binding.commentList.scrollToPosition(change.position);
    } else {
      adapter.notifyItemRemoved(change.position);
    }
    updateCount();
  }

  private void renderStatus(ReportCommentsViewModel.Status status) {
    if (status.noAccess != null) {
      showNoAccess(status.noAccess);
      return;
    }
    binding.commentLoading.setVisibility(status.loading ? View.VISIBLE : View.GONE);
    boolean failed = status.loadError != null;
    binding.commentState.setVisibility(failed ? View.VISIBLE : View.GONE);
    binding.commentRetry.setVisibility(failed ? View.VISIBLE : View.GONE);
    if (failed) binding.commentMessage.setText(status.loadError);
    binding.commentList.setVisibility(failed ? View.GONE : View.VISIBLE);
    setSubmitting(status);
    renderOlder(status);
    updateCount();
  }

  /** 서버에 더 오래된 댓글이 있으면 목록 위에 "이전 댓글 보기"를 보여 줘요. */
  private void renderOlder(ReportCommentsViewModel.Status status) {
    boolean show = model.hasOlder() && !status.loading && status.loadError == null;
    binding.commentOlder.setVisibility(show ? View.VISIBLE : View.GONE);
    binding.commentOlder.setEnabled(!status.olderLoading);
    binding.commentOlder.setText(
        status.olderLoading ? R.string.comment_older_loading : R.string.comment_older);
    boolean failed = show && status.olderError != null;
    binding.commentOlderError.setVisibility(failed ? View.VISIBLE : View.GONE);
    if (failed) binding.commentOlderError.setText(status.olderError);
  }

  /** 등록 성공·실패 같은 한 번만 보여 줄 알림이에요. 보여 준 뒤 비워서 회전해도 다시 뜨지 않아요. */
  private void renderNotice(@Nullable ReportCommentsViewModel.Notice notice) {
    if (notice == null) return;
    if (notice.submitted) binding.commentInput.setText("");
    if (notice.error != null) showError(notice.error);
    model.consumeNotice();
  }

  private void updateCount() {
    ReportCommentsViewModel.Status status = model.status().getValue();
    boolean ready = status != null && !status.loading && status.loadError == null;
    // 불러오기 전이나 실패했을 때 "댓글 0"으로 보이지 않게 개수를 비워 둬요.
    // 서버가 전체 개수를 주지 않아서, 이전 댓글이 더 있으면 받은 개수 뒤에 +를 붙여요.
    int count = adapter.getItemCount();
    String label =
        model.hasOlder() ? getString(R.string.comment_count_more, count) : String.valueOf(count);
    binding.commentCount.setText(ready ? label : "");
    binding.commentEmpty.setVisibility(
        ready && adapter.getItemCount() == 0 ? View.VISIBLE : View.GONE);
  }

  /** 입력한 댓글을 서버에 남겨요. 결과는 ViewModel이 목록에 붙이고 알려 줘요. */
  private void submitComment() {
    String body = binding.commentInput.getText().toString().trim();
    if (body.isEmpty()) {
      showError(R.string.comment_body_required);
      return;
    }
    binding.commentError.setVisibility(View.GONE);
    model.submit(body);
  }

  /** 등록 중에는 같은 댓글을 두 번 보내지 않게 잠가요. 목록을 받는 중에도 등록 버튼은 잠가요. */
  private void setSubmitting(ReportCommentsViewModel.Status status) {
    binding.commentInput.setEnabled(!status.submitting);
    binding.commentSubmit.setEnabled(status.canSubmit());
  }

  /** 안내 문구에 내 닉네임을 넣어요. 실패하면 닉네임 없이 보여 줘요. */
  private void loadNote() {
    binding.commentNote.setText(R.string.comment_note_plain);
    commentApi.myNickname(
        new CommentApi.Result<String>() {
          @Override
          public void onSuccess(String nickname) {
            View root = getView();
            if (root != null)
              root.post(
                  () -> {
                    if (binding != null)
                      binding.commentNote.setText(getString(R.string.comment_note, nickname));
                  });
          }

          @Override
          public void onNoAccess(String message) {}

          @Override
          public void onError(String message) {}
        });
  }

  /** 권한이 없으면(404) 목록과 입력칸을 숨기고 안내만 보여 줘요. */
  private void showNoAccess(String message) {
    binding.commentLoading.setVisibility(View.GONE);
    binding.commentList.setVisibility(View.GONE);
    binding.commentEmpty.setVisibility(View.GONE);
    binding.commentOlder.setVisibility(View.GONE);
    binding.commentOlderError.setVisibility(View.GONE);
    binding.commentForm.setVisibility(View.GONE);
    binding.commentNote.setVisibility(View.GONE);
    binding.commentRetry.setVisibility(View.GONE);
    binding.commentMessage.setText(message);
    binding.commentState.setVisibility(View.VISIBLE);
  }

  /** 입력칸 아래 빨간 안내예요. */
  private void showError(String message) {
    binding.commentError.setText(message);
    binding.commentError.setVisibility(View.VISIBLE);
  }

  private void showError(int messageRes) {
    showError(getString(messageRes));
  }
}
