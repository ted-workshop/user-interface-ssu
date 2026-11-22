package kr.ac.ssu.qletter.common;

import android.app.Dialog;
import android.os.Bundle;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.DialogFragment;
import androidx.fragment.app.FragmentManager;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.databinding.DialogConfirmBinding;

/** 삭제처럼 되돌리기 어려운 동작을 한 번 확인해요. 확인하면 Fragment Result로 true를 돌려줘요. */
public final class ConfirmDialog extends DialogFragment {
  public static final String RESULT_CONFIRMED = "confirmed";
  public static final String RESULT_ID = "id";

  private static final String ARG_REQUEST_KEY = "requestKey";
  private static final String ARG_TITLE = "title";
  private static final String ARG_MESSAGE = "message";
  private static final String ARG_CONFIRM = "confirm";
  private static final String ARG_TARGET_ID = "targetId";

  public static void show(
      FragmentManager manager,
      String tag,
      String requestKey,
      String title,
      String message,
      String confirmLabel,
      String targetId) {
    if (manager.findFragmentByTag(tag) != null) return;
    ConfirmDialog dialog = new ConfirmDialog();
    Bundle args = new Bundle();
    args.putString(ARG_REQUEST_KEY, requestKey);
    args.putString(ARG_TITLE, title);
    args.putString(ARG_MESSAGE, message);
    args.putString(ARG_CONFIRM, confirmLabel);
    args.putString(ARG_TARGET_ID, targetId);
    dialog.setArguments(args);
    dialog.show(manager, tag);
  }

  @NonNull
  @Override
  public Dialog onCreateDialog(@Nullable Bundle savedInstanceState) {
    AlertDialog.Builder builder =
        new AlertDialog.Builder(requireContext(), R.style.ThemeOverlay_Qletter_Dialog);
    DialogConfirmBinding view =
        DialogConfirmBinding.inflate(getLayoutInflater().cloneInContext(builder.getContext()));
    Bundle args = requireArguments();
    view.confirmTitle.setText(args.getString(ARG_TITLE));
    view.confirmMessage.setText(args.getString(ARG_MESSAGE));
    view.confirmOk.setText(args.getString(ARG_CONFIRM));
    view.confirmCancel.setOnClickListener(ignored -> dismiss());
    view.confirmOk.setOnClickListener(
        ignored -> {
          Bundle result = new Bundle();
          result.putBoolean(RESULT_CONFIRMED, true);
          result.putString(RESULT_ID, args.getString(ARG_TARGET_ID));
          getParentFragmentManager().setFragmentResult(args.getString(ARG_REQUEST_KEY), result);
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
