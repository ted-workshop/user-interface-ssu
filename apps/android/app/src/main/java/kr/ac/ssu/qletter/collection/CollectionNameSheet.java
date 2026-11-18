package kr.ac.ssu.qletter.collection;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.FragmentManager;
import com.google.android.material.bottomsheet.BottomSheetDialogFragment;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.databinding.BottomSheetNewCollectionBinding;

/**
 * 피그마 60:308 새 모음 시트예요. 모음 목록과 상세에서 새 모음·이름 바꾸기에 함께 써요.
 *
 * <p>화면을 돌려도 시트와 입력 중인 이름이 남도록 DialogFragment로 만들고, 저장 결과는 Fragment Result로 띄운 쪽에 돌려줘요.
 */
public final class CollectionNameSheet extends BottomSheetDialogFragment {
  static final String REQUEST_KEY = "collection_name_sheet";
  static final String RESULT_ID = "id";
  static final String RESULT_NAME = "name";
  static final String RESULT_REPORT_COUNT = "reportCount";
  static final String RESULT_CREATED = "created";

  private static final String ARG_ID = "id";
  private static final String ARG_NAME = "name";
  private static final String ARG_REPORT_COUNT = "reportCount";
  private static final String TAG = "collection_name_sheet";

  private final Handler main = new Handler(Looper.getMainLooper());
  private BottomSheetNewCollectionBinding sheet;

  /** original이 null이면 새 모음, 아니면 그 모음의 이름 바꾸기예요. */
  static void show(FragmentManager manager, @Nullable ReportCollection original) {
    if (manager.findFragmentByTag(TAG) != null) return;
    CollectionNameSheet fragment = new CollectionNameSheet();
    Bundle args = new Bundle();
    if (original != null) {
      args.putString(ARG_ID, original.getId());
      args.putString(ARG_NAME, original.getName());
      args.putInt(ARG_REPORT_COUNT, original.getReportCount());
    }
    fragment.setArguments(args);
    fragment.show(manager, TAG);
  }

  /** Fragment Result로 받은 값을 모음 객체로 바꿔요. */
  static ReportCollection collectionFrom(Bundle result) {
    return new ReportCollection(
        result.getString(RESULT_NAME),
        result.getInt(RESULT_REPORT_COUNT),
        result.getString(RESULT_ID));
  }

  @Override
  public int getTheme() {
    return R.style.ThemeOverlay_Qletter_BottomSheet;
  }

  @Nullable
  @Override
  public View onCreateView(
      @NonNull LayoutInflater inflater,
      @Nullable ViewGroup container,
      @Nullable Bundle savedInstanceState) {
    sheet = BottomSheetNewCollectionBinding.inflate(inflater, container, false);
    return sheet.getRoot();
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
    super.onViewCreated(view, savedInstanceState);
    String originalId = requireArguments().getString(ARG_ID);
    String originalName = requireArguments().getString(ARG_NAME);
    if (originalId != null) {
      sheet.sheetTitle.setText(R.string.collection_rename);
      sheet.createCollectionButton.setText(R.string.collection_save);
      // 회전으로 다시 만들어질 때는 EditText가 입력 중이던 글자를 스스로 복원해요.
      if (savedInstanceState == null) {
        sheet.collectionNameInput.setText(originalName);
        sheet.collectionNameInput.setSelection(originalName.length());
      }
    }
    sheet.cancelCollectionButton.setOnClickListener(v -> dismiss());
    sheet.createCollectionButton.setOnClickListener(v -> save(originalId));
  }

  @Override
  public void onDestroyView() {
    super.onDestroyView();
    sheet = null;
  }

  private void save(@Nullable String originalId) {
    String name = sheet.collectionNameInput.getText().toString().trim();
    if (name.isEmpty()) {
      showError(getString(R.string.collection_name_required));
      return;
    }
    clearError();
    setSaving(true);
    QletterApplication app = (QletterApplication) requireActivity().getApplication();
    CollectionApi api = new CollectionApi(app.api());
    CollectionApi.Result<ReportCollection> result =
        new CollectionApi.Result<ReportCollection>() {
          @Override
          public void onSuccess(ReportCollection value) {
            main.post(() -> deliver(value, originalId == null));
          }

          @Override
          public void onError(String message) {
            main.post(
                () -> {
                  if (sheet == null) return;
                  setSaving(false);
                  showError(message);
                });
          }
        };
    if (originalId == null) api.create(name, result);
    else api.rename(originalId, name, result);
  }

  private void deliver(ReportCollection saved, boolean created) {
    // 저장 중에는 닫을 수 없지만, 응답 전에 화면을 돌리면 이 시트는 이미 떨어져 있을 수 있어요.
    if (!isAdded()) return;
    Bundle result = new Bundle();
    result.putString(RESULT_ID, saved.getId());
    result.putString(RESULT_NAME, saved.getName());
    result.putInt(RESULT_REPORT_COUNT, saved.getReportCount());
    result.putBoolean(RESULT_CREATED, created);
    getParentFragmentManager().setFragmentResult(REQUEST_KEY, result);
    dismiss();
  }

  /** 저장 중에는 취소·뒤로 가기·바깥 터치로 시트를 닫지 못하게 해요. 닫힌 시트에서는 결과를 목록에 반영할 수 없어서 서버에만 모음이 생기는 일을 막아요. */
  private void setSaving(boolean saving) {
    setCancelable(!saving);
    sheet.cancelCollectionButton.setEnabled(!saving);
    sheet.createCollectionButton.setEnabled(!saving);
    sheet.collectionNameInput.setEnabled(!saving);
  }

  /** 피그마처럼 입력칸 테두리를 빨갛게 하고 아래에 문구를 보여 줘요. */
  private void showError(String message) {
    sheet.collectionNameInput.setBackgroundResource(R.drawable.q_input_error);
    sheet.collectionNameError.setText(message);
    sheet.collectionNameError.setVisibility(View.VISIBLE);
  }

  private void clearError() {
    sheet.collectionNameInput.setBackgroundResource(R.drawable.q_input);
    sheet.collectionNameError.setVisibility(View.GONE);
  }
}
