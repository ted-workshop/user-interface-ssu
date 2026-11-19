package kr.ac.ssu.qletter.collection;

import android.view.View;
import androidx.fragment.app.Fragment;
import java.util.ArrayList;
import java.util.List;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.databinding.FragmentReportCommentsBinding;
import okhttp3.Call;

/**
 * 피그마 61:265 리포트 상세 맨 아래 댓글 영역이에요. 리포트 상세(#28)가 생기면 그 화면 아래에 끼워 넣어요.
 *
 * <p>쓰는 도구: CommentApi(목록·작성·삭제·내 닉네임), CommentAdapter(목록), CommentDeleteDialog(삭제 확인).
 */
public class ReportCommentsFragment extends Fragment {
  private static final String ARG_REPORT_ID = "reportId";

  private FragmentReportCommentsBinding binding;
  private final List<Comment> comments = new ArrayList<>();
  private CommentAdapter adapter;
  private CommentApi commentApi;
  private Call loadCall;

  // TODO ⑤-1: newInstance(String reportId)를 만들어요.
  //  Bundle에 ARG_REPORT_ID로 넣고 setArguments(...)로 붙여서 돌려줘요. (Lab12 FavoritesFragment.newInstance)

  // TODO ⑤-2: onCreateView에서 FragmentReportCommentsBinding.inflate(inflater, container, false)로 만들고
  //  getRoot()를 돌려줘요.

  // TODO ⑤-3: onViewCreated에서
  //  - commentList에 LinearLayoutManager와 CommentAdapter(comments, this::confirmDelete)를 붙여요.
  //  - QletterApplication에서 api()를 꺼내 new CommentApi(app.api(), getResources())를 만들어요.
  //  - commentSubmit 클릭 → submitComment(), 그리고 loadComments(), loadNote()를 불러요.
  //  - 삭제 확인 결과 받기: getChildFragmentManager().setFragmentResultListener(
  //      CommentDeleteDialog.REQUEST_KEY, getViewLifecycleOwner(), (key, result) -> ...)
  //    result.getString(CommentDeleteDialog.RESULT_ID)로 댓글 id를 꺼내 deleteComment(id)를 불러요.

  // TODO ⑤-4: onDestroyView에서 loadCall을 취소하고 binding = null로 비워요.

  /** 삭제를 누르면 확인창부터 띄워요. 삭제하기를 누르면 ⑤-3의 결과 받기로 돌아와요. */
  private void confirmDelete(Comment comment) {
    CommentDeleteDialog.open(getChildFragmentManager(), comment.getId());
  }

  private String reportId() {
    return requireArguments().getString(ARG_REPORT_ID);
  }

  // TODO ⑥-1: loadComments()
  //  - 로딩 보이기 → commentApi.list(reportId(), new CommentApi.Result<List<Comment>>() { ... })
  //  - onSuccess: 메인 스레드로 넘겨서(runOnUiThread 또는 view.post) binding null 확인 →
  //    comments 비우고 채우기 → notifyDataSetChanged → 개수(commentCount) 갱신 → 비었으면 commentEmpty 보이기
  //  - onNoAccess: 메인 스레드에서 showNoAccess(message)
  //  - onError: 메인 스레드에서 commentMessage에 문장 보이기

  // TODO ⑥-2: submitComment()
  //  - commentInput 글자를 trim, 비었으면 showError(R.string.comment_body_required)
  //  - 등록 버튼 잠그고 commentApi.create(...) → 성공하면 메인 스레드에서
  //    comments.add(새 댓글) → notifyItemInserted(comments.size() - 1) → 입력칸 비우기 → 개수·빈 안내 갱신
  //  - 실패하면 버튼 풀고 showError(message)

  // TODO ⑥-3: deleteComment(String commentId)
  //  - commentApi.delete(reportId(), commentId, ...) → 성공하면 메인 스레드에서
  //    comments에서 그 id의 위치를 찾아 remove → notifyItemRemoved(위치) → 개수·빈 안내 갱신

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

  /** ⑦ 권한이 없으면(404) 목록과 입력칸을 숨기고 안내만 보여 줘요. 메인 스레드에서 불러 주세요. */
  private void showNoAccess(String message) {
    if (binding == null) return;
    binding.commentLoading.setVisibility(View.GONE);
    binding.commentList.setVisibility(View.GONE);
    binding.commentEmpty.setVisibility(View.GONE);
    binding.commentForm.setVisibility(View.GONE);
    binding.commentNote.setVisibility(View.GONE);
    binding.commentMessage.setText(message);
    binding.commentMessage.setVisibility(View.VISIBLE);
  }

  /** 입력칸 아래 빨간 안내예요. 메인 스레드에서 불러 주세요. */
  private void showError(String message) {
    if (binding == null) return;
    binding.commentError.setText(message);
    binding.commentError.setVisibility(View.VISIBLE);
  }

  private void showError(int messageRes) {
    showError(getString(messageRes));
  }
}
