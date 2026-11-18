package kr.ac.ssu.qletter.collection;

import android.content.Context;
import android.view.LayoutInflater;
import androidx.appcompat.app.AlertDialog;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.databinding.DialogConfirmBinding;

/** 피그마 61:132 확인창 모양으로 모음 삭제를 확인해요. 목록과 상세에서 함께 써요. */
final class CollectionDeleteDialog {
  private CollectionDeleteDialog() {}

  static void show(Context context, String name, Runnable onConfirm) {
    AlertDialog.Builder builder =
        new AlertDialog.Builder(context, R.style.ThemeOverlay_Qletter_Dialog);
    // 확인창의 테마로 inflate해야 버튼이 피그마처럼 흰 바탕으로 보여요.
    DialogConfirmBinding view =
        DialogConfirmBinding.inflate(LayoutInflater.from(builder.getContext()));
    view.confirmTitle.setText(R.string.collection_delete_title);
    view.confirmMessage.setText(context.getString(R.string.collection_delete_message, name));
    view.confirmOk.setText(R.string.collection_delete_confirm);

    AlertDialog dialog = builder.setView(view.getRoot()).create();
    view.confirmCancel.setOnClickListener(v -> dialog.dismiss());
    view.confirmOk.setOnClickListener(
        v -> {
          dialog.dismiss();
          onConfirm.run();
        });
    dialog.show();
    // 기본 확인창 바탕 대신 피그마처럼 좌우 24 여백의 흰 둥근 상자를 써요.
    if (dialog.getWindow() != null)
      dialog.getWindow().setBackgroundDrawableResource(R.drawable.q_dialog_background);
  }
}
