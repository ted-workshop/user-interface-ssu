package kr.ac.ssu.qletter.collection;

import android.app.Dialog;
import android.graphics.Rect;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.view.ViewCompat;
import androidx.fragment.app.FragmentManager;
import androidx.lifecycle.ViewModelProvider;
import androidx.recyclerview.widget.LinearLayoutManager;
import com.google.android.material.bottomsheet.BottomSheetBehavior;
import com.google.android.material.bottomsheet.BottomSheetDialog;
import com.google.android.material.bottomsheet.BottomSheetDialogFragment;
import java.util.ArrayList;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.databinding.BottomSheetAddToCollectionBinding;

/**
 * 피그마 60:276 모음에 담기 시트예요. 리포트 상세(#28)의 "모음에 담기" 버튼에서 띄워요.
 *
 * <p>체크는 화면에서만 바꾸고, 완료를 누르면 바뀐 모음에만 담기(PUT)·빼기(DELETE)를 보내요. 하나라도 반영되면 띄운 쪽에 Fragment Result로 알리고,
 * 다 반영되면 닫아요. 체크와 요청은 AddToCollectionViewModel이 들고 있어서 회전해도 이어져요.
 */
public final class AddToCollectionSheet extends BottomSheetDialogFragment {
  /**
   * 저장 한 번에서 하나라도 반영되면 이 키로 결과를 한 번 보내요. 띄운 쪽은 모음 개수·담김 표시를 다시 불러오면 돼요.
   *
   * <p>일부만 실패하면 시트가 열린 채로 결과가 가요. 다시 저장해 성공하면 한 번 더 가요(ADR-0045).
   */
  public static final String REQUEST_KEY = "add_to_collection_sheet";

  private static final String ARG_REPORT_ID = "reportId";
  private static final String STATE_CHECKED = "checked";
  private static final String STATE_UNCHECKED = "unchecked";
  private static final String TAG = "add_to_collection_sheet";

  private BottomSheetAddToCollectionBinding sheet;
  private CollectionCheckAdapter adapter;
  private AddToCollectionViewModel model;
  // 이 시트의 어댑터가 반영한 마지막 변경 번호예요.
  private int appliedSeq;

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

  @NonNull
  @Override
  public Dialog onCreateDialog(@Nullable Bundle savedInstanceState) {
    BottomSheetDialog dialog = (BottomSheetDialog) super.onCreateDialog(savedInstanceState);
    // 반만 펼치면 아래쪽 입력칸과 완료 버튼이 화면 밖이라 처음부터 다 펼쳐요.
    dialog.getBehavior().setSkipCollapsed(true);
    dialog.getBehavior().setState(BottomSheetBehavior.STATE_EXPANDED);
    return dialog;
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
    QletterApplication app = (QletterApplication) requireActivity().getApplication();
    model = new ViewModelProvider(this).get(AddToCollectionViewModel.class);
    model.start(
        new CollectionApi(app.api(), getResources()),
        reportId(),
        savedInstanceState == null ? null : savedInstanceState.getStringArrayList(STATE_CHECKED),
        savedInstanceState == null ? null : savedInstanceState.getStringArrayList(STATE_UNCHECKED));

    // 입력칸이 켜지면서 포커스를 가져가지 않게 시트가 먼저 잡아요. 사용자가 누르면 그때 키보드가 떠요.
    view.requestFocus();
    adapter = new CollectionCheckAdapter(model.checks());
    sheet.addCollectionsList.setLayoutManager(new LinearLayoutManager(requireContext()));
    sheet.addCollectionsList.setAdapter(adapter);
    // 새 어댑터는 지금 목록을 통째로 그리니 지금까지의 변경은 이미 반영한 셈이에요.
    appliedSeq = model.seq();
    sheet.addCancelButton.setOnClickListener(v -> dismiss());
    sheet.addDoneButton.setOnClickListener(v -> save());
    sheet.addNewButton.setOnClickListener(v -> createCollection());
    // 가로에서는 키보드가 시트를 덮으니 키보드의 완료로 바로 만들어요. false를 돌려줘야 키보드도 닫혀요.
    sheet.addNewName.setOnEditorActionListener(
        (field, action, event) -> {
          if (action == EditorInfo.IME_ACTION_DONE && !field.getText().toString().trim().isEmpty())
            createCollection();
          return false;
        });
    ViewCompat.setAccessibilityPaneTitle(view, getString(R.string.add_to_collection_title));

    model.changes().observe(getViewLifecycleOwner(), this::applyChange);
    model.status().observe(getViewLifecycleOwner(), this::renderStatus);
    model.notice().observe(getViewLifecycleOwner(), this::renderNotice);
  }

  @Override
  public void onSaveInstanceState(@NonNull Bundle outState) {
    super.onSaveInstanceState(outState);
    // 앱이 정리됐다가 돌아오면 ViewModel도 새로 생겨요. 그때 다시 입힐 수 있게 아직 저장하지 않은 체크 변경만 남겨요.
    ArrayList<String> checked = new ArrayList<>();
    ArrayList<String> unchecked = new ArrayList<>();
    for (CollectionCheck check : model.checks()) {
      if (!check.isChanged()) continue;
      (check.isChecked() ? checked : unchecked).add(check.getCollection().getId());
    }
    outState.putStringArrayList(STATE_CHECKED, checked);
    outState.putStringArrayList(STATE_UNCHECKED, unchecked);
  }

  @Override
  public void onDestroyView() {
    super.onDestroyView();
    sheet = null;
  }

  private String reportId() {
    return requireArguments().getString(ARG_REPORT_ID);
  }

  /** 목록이 바뀐 만큼 어댑터에 알려요. 화면이 보이지 않는 동안 놓친 변경이 있으면 전체를 다시 그려요. */
  private void applyChange(@Nullable AddToCollectionViewModel.Change change) {
    if (change == null || change.seq <= appliedSeq) return;
    boolean missed = change.seq != appliedSeq + 1;
    appliedSeq = change.seq;
    if (missed || change.kind == AddToCollectionViewModel.RELOADED) {
      adapter.notifyDataSetChanged();
    } else {
      adapter.notifyItemInserted(change.position);
      // 새 모음은 맨 위 줄이라 목록이 시작하는 곳으로 스크롤해요.
      sheet.addScroll.scrollTo(0, sheet.addListFrame.getTop());
    }
  }

  private void renderStatus(AddToCollectionViewModel.Status status) {
    sheet.addLoading.setVisibility(status.loading ? View.VISIBLE : View.GONE);
    if (status.message != null) showMessage(status.message);
    else if (!status.loading && model.checks().isEmpty())
      showMessage(getString(R.string.collection_empty));
    else sheet.addMessage.setVisibility(View.GONE);
    setSaving(status.busy);
    sheet.addNewButton.setEnabled(status.canCreate());
    sheet.addNewName.setEnabled(status.canCreate());
    sheet.addMore.setVisibility(model.hasMore() ? View.VISIBLE : View.GONE);
    sheet.addMore.setText(
        getString(R.string.collection_more_collections, CollectionApi.PAGE_LIMIT));
    if (status.saveError != null) {
      sheet.addSaveError.setText(
          getString(R.string.add_to_collection_save_failed, status.saveError));
      sheet.addSaveError.setVisibility(View.VISIBLE);
      reveal(sheet.addSaveError);
    }
  }

  /**
   * 새 모음·저장 결과처럼 한 번만 처리할 알림이에요.
   *
   * <p>LiveData는 시트가 화면에 보이는(STARTED) 동안에만 불러서, 여기서 결과를 보내고 닫아도 상태 저장 뒤 커밋이 생기지 않아요.
   */
  private void renderNotice(@Nullable AddToCollectionViewModel.Notice notice) {
    if (notice == null) return;
    model.consumeNotice();
    if (notice.newError != null) showNewError(notice.newError);
    if (notice.created) sheet.addNewName.setText("");
    if (notice.changed) getParentFragmentManager().setFragmentResult(REQUEST_KEY, new Bundle());
    if (notice.saved) dismiss();
  }

  private void createCollection() {
    String name = sheet.addNewName.getText().toString().trim();
    if (name.isEmpty()) {
      showNewError(getString(R.string.collection_name_required));
      return;
    }
    sheet.addNewError.setVisibility(View.GONE);
    // 입력칸이 잠겼다 풀릴 때 포커스를 되찾으면 키보드가 다시 떠서 시트에 넘겨 둬요.
    sheet.getRoot().requestFocus();
    model.create(name);
  }

  /** 바뀐 체크가 없으면 바로 닫고, 있으면 ViewModel이 담기·빼기를 보내요. */
  private void save() {
    if (!model.hasChanges()) {
      dismiss();
      return;
    }
    sheet.addSaveError.setVisibility(View.GONE);
    model.save();
  }

  /** 저장 중에는 시트를 닫거나 체크·입력을 바꾸지 못하게 해요. */
  private void setSaving(boolean saving) {
    setCancelable(!saving);
    adapter.setEnabled(!saving);
    sheet.addCancelButton.setEnabled(!saving);
    sheet.addDoneButton.setEnabled(!saving);
  }

  private void showNewError(String message) {
    sheet.addNewError.setText(message);
    sheet.addNewError.setVisibility(View.VISIBLE);
    reveal(sheet.addNewError);
  }

  /** 방금 보인 문구는 자리가 잡힌 다음에 그곳까지 스크롤해요. */
  private void reveal(View message) {
    message.post(
        () ->
            message.requestRectangleOnScreen(
                new Rect(0, 0, message.getWidth(), message.getHeight()), true));
  }

  private void showMessage(String message) {
    sheet.addMessage.setText(message);
    sheet.addMessage.setVisibility(View.VISIBLE);
  }
}
