package kr.ac.ssu.qletter.collection;

import android.app.Dialog;
import android.os.Bundle;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.DialogFragment;
import androidx.fragment.app.FragmentManager;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.databinding.DialogConfirmBinding;

/**
 * 피그마 61:132 확인창 모양으로 댓글 삭제를 확인해요.
 *
 * <p>삭제하기를 누르면 REQUEST_KEY로 Fragment Result를 보내고, 결과 Bundle의 RESULT_ID에 댓글 id가 들어 있어요.
 */
public final class CommentDeleteDialog extends DialogFragment {
  static final String REQUEST_KEY = "comment_delete_dialog";
  static final String RESULT_ID = "id";

  private static final String ARG_ID = "id";
  private static final String TAG = "comment_delete_dialog";

  static void open(FragmentManager manager, String commentId) {
    if (manager.findFragmentByTag(TAG) != null) return;
    CommentDeleteDialog fragment = new CommentDeleteDialog();
    Bundle args = new Bundle();
    args.putString(ARG_ID, commentId);
    fragment.setArguments(args);
    fragment.show(manager, TAG);
  }

  @NonNull
  @Override
  public Dialog onCreateDialog(@Nullable Bundle savedInstanceState) {
    AlertDialog.Builder builder =
        new AlertDialog.Builder(requireContext(), R.style.ThemeOverlay_Qletter_Dialog);
    DialogConfirmBinding view =
        DialogConfirmBinding.inflate(getLayoutInflater().cloneInContext(builder.getContext()));
    view.confirmTitle.setText(R.string.comment_delete_title);
    view.confirmMessage.setText(R.string.comment_delete_message);
    view.confirmOk.setText(R.string.comment_delete_confirm);
    view.confirmCancel.setOnClickListener(v -> dismiss());
    view.confirmOk.setOnClickListener(
        v -> {
          Bundle result = new Bundle();
          result.putString(RESULT_ID, requireArguments().getString(ARG_ID));
          getParentFragmentManager().setFragmentResult(REQUEST_KEY, result);
          dismiss();
        });
    return builder.setView(view.getRoot()).create();
  }

  @Override
  public void onStart() {
    super.onStart();
    Dialog dialog = getDialog();
    if (dialog != null && dialog.getWindow() != null)
      dialog.getWindow().setBackgroundDrawableResource(R.drawable.q_dialog_background);
  }
}
