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
import androidx.recyclerview.widget.LinearLayoutManager;
import com.google.android.material.bottomsheet.BottomSheetDialogFragment;
import java.util.ArrayList;
import java.util.List;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.databinding.BottomSheetAddToCollectionBinding;
import okhttp3.Call;

/**
 * 피그마 60:276 모음에 담기 시트예요. 리포트 상세(#28)의 "모음에 담기" 버튼에서 띄워요.
 *
 * <p>지금은 모음 목록과 담김 여부를 불러와 체크로 보여 주는 단계까지예요. 완료 시 담기·빼기 저장은 다음 단계에서 붙여요.
 */
public final class AddToCollectionSheet extends BottomSheetDialogFragment {
  private static final String ARG_REPORT_ID = "reportId";
  private static final String TAG = "add_to_collection_sheet";

  private final Handler main = new Handler(Looper.getMainLooper());
  private final List<CollectionCheck> checks = new ArrayList<>();
  private BottomSheetAddToCollectionBinding sheet;
  private CollectionCheckAdapter adapter;
  private Call loadCall;

  public static void open(FragmentManager manager, String reportId) {
    if (manager.findFragmentByTag(TAG) != null) return;
    AddToCollectionSheet fragment = new AddToCollectionSheet();
    Bundle args = new Bundle();
    args.putString(ARG_REPORT_ID, reportId);
    fragment.setArguments(args);
    fragment.show(manager, TAG);
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
    sheet = BottomSheetAddToCollectionBinding.inflate(inflater, container, false);
    return sheet.getRoot();
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
    super.onViewCreated(view, savedInstanceState);
    adapter = new CollectionCheckAdapter(checks);
    sheet.addCollectionsList.setLayoutManager(new LinearLayoutManager(requireContext()));
    sheet.addCollectionsList.setAdapter(adapter);
    sheet.addCancelButton.setOnClickListener(v -> dismiss());
    // 완료 시 바뀐 체크만 서버에 보내는 저장은 다음 단계에서 붙여요.
    sheet.addDoneButton.setOnClickListener(v -> dismiss());
    load();
  }

  @Override
  public void onDestroyView() {
    super.onDestroyView();
    if (loadCall != null) loadCall.cancel();
    loadCall = null;
    sheet = null;
  }

  private void load() {
    sheet.addLoading.setVisibility(View.VISIBLE);
    sheet.addMessage.setVisibility(View.GONE);
    QletterApplication app = (QletterApplication) requireActivity().getApplication();
    loadCall =
        new CollectionApi(app.api(), getResources())
            .checksForReport(
                requireArguments().getString(ARG_REPORT_ID),
                new CollectionApi.Result<CollectionApi.Page<CollectionCheck>>() {
                  @Override
                  public void onSuccess(CollectionApi.Page<CollectionCheck> page) {
                    main.post(
                        () -> {
                          if (sheet == null) return;
                          sheet.addLoading.setVisibility(View.GONE);
                          checks.clear();
                          checks.addAll(page.items);
                          adapter.notifyDataSetChanged();
                          if (checks.isEmpty()) showMessage(getString(R.string.collection_empty));
                        });
                  }

                  @Override
                  public void onError(String message) {
                    main.post(
                        () -> {
                          if (sheet == null) return;
                          sheet.addLoading.setVisibility(View.GONE);
                          showMessage(message);
                        });
                  }
                });
  }

  private void showMessage(String message) {
    sheet.addMessage.setText(message);
    sheet.addMessage.setVisibility(View.VISIBLE);
  }
}
