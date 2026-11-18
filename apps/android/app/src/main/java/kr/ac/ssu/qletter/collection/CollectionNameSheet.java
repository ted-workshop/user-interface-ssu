package kr.ac.ssu.qletter.collection;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import androidx.annotation.Nullable;
import com.google.android.material.bottomsheet.BottomSheetDialog;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.databinding.BottomSheetNewCollectionBinding;

/** 피그마 60:308 새 모음 시트예요. 모음 목록과 상세에서 새 모음·이름 바꾸기에 함께 써요. */
final class CollectionNameSheet {
  interface OnSaved {
    void onSaved(ReportCollection saved);
  }

  private CollectionNameSheet() {}

  /** original이 null이면 새 모음, 아니면 그 모음의 이름 바꾸기예요. 저장 결과는 메인 스레드에서 전달해요. */
  static void show(
      Context context, CollectionApi api, @Nullable ReportCollection original, OnSaved onSaved) {
    BottomSheetDialog dialog =
        new BottomSheetDialog(context, R.style.ThemeOverlay_Qletter_BottomSheet);
    BottomSheetNewCollectionBinding sheet =
        BottomSheetNewCollectionBinding.inflate(LayoutInflater.from(dialog.getContext()));
    dialog.setContentView(sheet.getRoot());
    if (original != null) {
      sheet.sheetTitle.setText(R.string.collection_rename);
      sheet.createCollectionButton.setText(R.string.collection_save);
      sheet.collectionNameInput.setText(original.getName());
      sheet.collectionNameInput.setSelection(original.getName().length());
    }
    sheet.cancelCollectionButton.setOnClickListener(view -> dialog.dismiss());
    sheet.createCollectionButton.setOnClickListener(
        view -> {
          String name = sheet.collectionNameInput.getText().toString().trim();
          if (name.isEmpty()) {
            showError(sheet, context.getString(R.string.collection_name_required));
            return;
          }
          clearError(sheet);
          setSaving(dialog, sheet, true);
          CollectionApi.Result<ReportCollection> result =
              new CollectionApi.Result<ReportCollection>() {
                @Override
                public void onSuccess(ReportCollection value) {
                  sheet
                      .getRoot()
                      .post(
                          () -> {
                            dialog.dismiss();
                            onSaved.onSaved(value);
                          });
                }

                @Override
                public void onError(String message) {
                  sheet
                      .getRoot()
                      .post(
                          () -> {
                            setSaving(dialog, sheet, false);
                            showError(sheet, message);
                          });
                }
              };
          if (original == null) api.create(name, result);
          else api.rename(original.getId(), name, result);
        });
    dialog.show();
  }

  /** 저장 중에는 취소·뒤로 가기·바깥 터치로 시트를 닫지 못하게 해요. 닫힌 시트에서는 결과를 목록에 반영할 수 없어서 서버에만 모음이 생기는 일을 막아요. */
  private static void setSaving(
      BottomSheetDialog dialog, BottomSheetNewCollectionBinding sheet, boolean saving) {
    dialog.setCancelable(!saving);
    sheet.cancelCollectionButton.setEnabled(!saving);
    sheet.createCollectionButton.setEnabled(!saving);
    sheet.collectionNameInput.setEnabled(!saving);
  }

  /** 피그마처럼 입력칸 테두리를 빨갛게 하고 아래에 문구를 보여 줘요. */
  private static void showError(BottomSheetNewCollectionBinding sheet, String message) {
    sheet.collectionNameInput.setBackgroundResource(R.drawable.q_input_error);
    sheet.collectionNameError.setText(message);
    sheet.collectionNameError.setVisibility(View.VISIBLE);
  }

  private static void clearError(BottomSheetNewCollectionBinding sheet) {
    sheet.collectionNameInput.setBackgroundResource(R.drawable.q_input);
    sheet.collectionNameError.setVisibility(View.GONE);
  }
}
