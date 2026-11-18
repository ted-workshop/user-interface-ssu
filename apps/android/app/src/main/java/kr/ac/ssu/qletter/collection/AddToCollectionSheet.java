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
 * <p>체크는 화면에서만 바꾸고, 완료를 누르면 바뀐 모음에만 담기(PUT)·빼기(DELETE)를 보내요. 다 반영되면 띄운 쪽에 Fragment Result로 알려요.
 */
public final class AddToCollectionSheet extends BottomSheetDialogFragment {
  /** 저장이 끝나면 이 키로 결과를 보내요. 띄운 쪽은 모음 개수·담김 표시를 다시 불러오면 돼요. */
  public static final String REQUEST_KEY = "add_to_collection_sheet";

  private static final String ARG_REPORT_ID = "reportId";
  private static final String STATE_CHECKED = "checked";
  private static final String STATE_UNCHECKED = "unchecked";
  private static final String TAG = "add_to_collection_sheet";

  private final Handler main = new Handler(Looper.getMainLooper());
  private final List<CollectionCheck> checks = new ArrayList<>();
  private BottomSheetAddToCollectionBinding sheet;
  private CollectionCheckAdapter adapter;
  private CollectionApi api;
  private Call loadCall;
  private int pending;
  private String lastError;

  /** 회전으로 다시 만들어질 때 사용자가 바꿔 둔 체크를 서버 값 위에 다시 입혀요. */
  private ArrayList<String> restoredChecked;

  private ArrayList<String> restoredUnchecked;

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
    if (savedInstanceState != null) {
      restoredChecked = savedInstanceState.getStringArrayList(STATE_CHECKED);
      restoredUnchecked = savedInstanceState.getStringArrayList(STATE_UNCHECKED);
    }
    QletterApplication app = (QletterApplication) requireActivity().getApplication();
    api = new CollectionApi(app.api(), getResources());
    adapter = new CollectionCheckAdapter(checks);
    sheet.addCollectionsList.setLayoutManager(new LinearLayoutManager(requireContext()));
    sheet.addCollectionsList.setAdapter(adapter);
    sheet.addCancelButton.setOnClickListener(v -> dismiss());
    sheet.addDoneButton.setOnClickListener(v -> save());
    sheet.addNewButton.setOnClickListener(v -> createCollection());
    load();
  }

  @Override
  public void onSaveInstanceState(@NonNull Bundle outState) {
    super.onSaveInstanceState(outState);
    // 아직 저장하지 않은 체크 변경만 남겨요. 저장 중 회전했다면 서버 값을 다시 불러와 그대로 보여 줘요.
    ArrayList<String> checked = new ArrayList<>();
    ArrayList<String> unchecked = new ArrayList<>();
    for (CollectionCheck check : checks) {
      if (!check.isChanged()) continue;
      (check.isChecked() ? checked : unchecked).add(check.getCollection().getId());
    }
    outState.putStringArrayList(STATE_CHECKED, checked);
    outState.putStringArrayList(STATE_UNCHECKED, unchecked);
  }

  @Override
  public void onDestroyView() {
    super.onDestroyView();
    if (loadCall != null) loadCall.cancel();
    loadCall = null;
    sheet = null;
  }

  private String reportId() {
    return requireArguments().getString(ARG_REPORT_ID);
  }

  private void load() {
    sheet.addLoading.setVisibility(View.VISIBLE);
    sheet.addMessage.setVisibility(View.GONE);
    loadCall =
        api.checksForReport(
            reportId(),
            new CollectionApi.Result<CollectionApi.Page<CollectionCheck>>() {
              @Override
              public void onSuccess(CollectionApi.Page<CollectionCheck> page) {
                main.post(
                    () -> {
                      if (sheet == null) return;
                      sheet.addLoading.setVisibility(View.GONE);
                      checks.clear();
                      checks.addAll(page.items);
                      restoreChecks();
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

  private void restoreChecks() {
    if (restoredChecked == null && restoredUnchecked == null) return;
    for (CollectionCheck check : checks) {
      String id = check.getCollection().getId();
      if (restoredChecked != null && restoredChecked.contains(id)) check.setChecked(true);
      if (restoredUnchecked != null && restoredUnchecked.contains(id)) check.setChecked(false);
    }
    restoredChecked = null;
    restoredUnchecked = null;
  }

  /** 시트 안에서 새 모음을 만들면 맨 위에 체크된 채로 넣어요. 완료를 눌러야 이 리포트가 담겨요. */
  private void createCollection() {
    String name = sheet.addNewName.getText().toString().trim();
    if (name.isEmpty()) {
      showNewError(getString(R.string.collection_name_required));
      return;
    }
    sheet.addNewError.setVisibility(View.GONE);
    setSaving(true);
    api.create(
        name,
        new CollectionApi.Result<ReportCollection>() {
          @Override
          public void onSuccess(ReportCollection value) {
            main.post(
                () -> {
                  if (sheet == null) return;
                  setSaving(false);
                  CollectionCheck check = new CollectionCheck(value, false);
                  check.setChecked(true);
                  checks.add(0, check);
                  adapter.notifyItemInserted(0);
                  sheet.addCollectionsList.scrollToPosition(0);
                  sheet.addMessage.setVisibility(View.GONE);
                  sheet.addNewName.setText("");
                });
          }

          @Override
          public void onError(String message) {
            main.post(
                () -> {
                  if (sheet == null) return;
                  setSaving(false);
                  showNewError(message);
                });
          }
        });
  }

  /** 체크가 바뀐 모음에만 담기·빼기를 보내고, 모든 응답이 온 뒤 결과를 정리해요. */
  private void save() {
    List<CollectionCheck> changed = new ArrayList<>();
    for (CollectionCheck check : checks) if (check.isChanged()) changed.add(check);
    if (changed.isEmpty()) {
      dismiss();
      return;
    }
    sheet.addSaveError.setVisibility(View.GONE);
    setSaving(true);
    pending = changed.size();
    lastError = null;
    for (CollectionCheck check : changed) {
      CollectionApi.Result<Void> result =
          new CollectionApi.Result<Void>() {
            @Override
            public void onSuccess(Void value) {
              main.post(() -> finishOne(check, null));
            }

            @Override
            public void onError(String message) {
              main.post(() -> finishOne(check, message));
            }
          };
      String collectionId = check.getCollection().getId();
      if (check.isChecked()) api.addReport(collectionId, reportId(), result);
      else api.removeReport(collectionId, reportId(), result);
    }
  }

  private void finishOne(CollectionCheck check, @Nullable String error) {
    if (error == null) check.markSaved();
    else lastError = error;
    if (--pending > 0) return;
    // 시트가 사라진 뒤 마지막 응답이 와도 서버에는 반영됐으니 결과만 보내요.
    if (lastError == null) {
      if (isAdded()) getParentFragmentManager().setFragmentResult(REQUEST_KEY, new Bundle());
      if (sheet != null) dismiss();
      return;
    }
    if (sheet == null) return;
    setSaving(false);
    // 일부만 실패하면 성공한 모음은 새 기준이 되고, 실패한 모음만 바뀐 채로 남아 다시 보낼 수 있어요.
    sheet.addSaveError.setText(getString(R.string.add_to_collection_save_failed, lastError));
    sheet.addSaveError.setVisibility(View.VISIBLE);
  }

  /** 저장 중에는 시트를 닫거나 체크·입력을 바꾸지 못하게 해요. */
  private void setSaving(boolean saving) {
    setCancelable(!saving);
    adapter.setEnabled(!saving);
    sheet.addCancelButton.setEnabled(!saving);
    sheet.addDoneButton.setEnabled(!saving);
    sheet.addNewButton.setEnabled(!saving);
    sheet.addNewName.setEnabled(!saving);
  }

  private void showNewError(String message) {
    sheet.addNewError.setText(message);
    sheet.addNewError.setVisibility(View.VISIBLE);
  }

  private void showMessage(String message) {
    sheet.addMessage.setText(message);
    sheet.addMessage.setVisibility(View.VISIBLE);
  }
}
