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
 * 피그마 61:132 확인창 모양으로 모음 삭제를 확인해요. 목록과 상세에서 함께 써요.
 *
 * <p>화면을 돌려도 확인창이 남도록 DialogFragment로 만들고, 삭제하기를 누르면 Fragment Result로 모음 id를 돌려줘요.
 */
public final class CollectionDeleteDialog extends DialogFragment {
  static final String REQUEST_KEY = "collection_delete_dialog";
  static final String RESULT_ID = "id";

  private static final String ARG_ID = "id";
  private static final String ARG_NAME = "name";
  private static final String TAG = "collection_delete_dialog";

  static void show(FragmentManager manager, ReportCollection target) {
    if (manager.findFragmentByTag(TAG) != null) return;
    CollectionDeleteDialog fragment = new CollectionDeleteDialog();
    Bundle args = new Bundle();
    args.putString(ARG_ID, target.getId());
    args.putString(ARG_NAME, target.getName());
    fragment.setArguments(args);
    fragment.show(manager, TAG);
  }

  @NonNull
  @Override
  public Dialog onCreateDialog(@Nullable Bundle savedInstanceState) {
    AlertDialog.Builder builder =
        new AlertDialog.Builder(requireContext(), R.style.ThemeOverlay_Qletter_Dialog);
    // 확인창의 테마로 inflate해야 버튼이 피그마처럼 흰 바탕으로 보여요.
    DialogConfirmBinding view =
        DialogConfirmBinding.inflate(getLayoutInflater().cloneInContext(builder.getContext()));
    view.confirmTitle.setText(R.string.collection_delete_title);
    view.confirmMessage.setText(
        getString(R.string.collection_delete_message, requireArguments().getString(ARG_NAME)));
    view.confirmOk.setText(R.string.collection_delete_confirm);
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
    // 기본 확인창 바탕 대신 피그마처럼 좌우 24 여백의 흰 둥근 상자를 써요.
    Dialog dialog = getDialog();
    if (dialog != null && dialog.getWindow() != null)
      dialog.getWindow().setBackgroundDrawableResource(R.drawable.q_dialog_background);
  }
}
