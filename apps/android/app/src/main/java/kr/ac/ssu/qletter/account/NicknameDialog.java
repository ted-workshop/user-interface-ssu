package kr.ac.ssu.qletter.account;

import android.app.Dialog;
import android.os.Bundle;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.DialogFragment;
import androidx.fragment.app.FragmentManager;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.auth.Account;
import kr.ac.ssu.qletter.auth.AuthInput;
import kr.ac.ssu.qletter.common.ApiError;
import kr.ac.ssu.qletter.common.JsonCall;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.common.Ui;
import kr.ac.ssu.qletter.databinding.DialogNicknameBinding;
import okhttp3.Call;

/** 계정 닉네임을 바꾸고, 성공하면 Fragment Result로 새 이름을 돌려줘요. */
public final class NicknameDialog extends DialogFragment {
  static final String REQUEST_KEY = "nickname_dialog";
  static final String RESULT_NICKNAME = "nickname";
  static final String TAG = "nickname_dialog";

  private static final String ARG_NICKNAME = "nickname";
  private static final String STATE_DISMISS = "dismissWhenResumed";

  static void open(FragmentManager manager, String nickname) {
    if (manager.findFragmentByTag(TAG) != null) return;
    NicknameDialog dialog = new NicknameDialog();
    Bundle args = new Bundle();
    args.putString(ARG_NICKNAME, nickname);
    dialog.setArguments(args);
    dialog.show(manager, TAG);
  }

  private DialogNicknameBinding binding;
  private AccountApi api;
  private Call call;
  private boolean submitting;
  private boolean dismissWhenResumed;

  @Override
  public void onCreate(@Nullable Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (savedInstanceState != null)
      dismissWhenResumed = savedInstanceState.getBoolean(STATE_DISMISS);
  }

  @Override
  public void onResume() {
    super.onResume();
    if (dismissWhenResumed) {
      dismissWhenResumed = false;
      dismiss();
    }
  }

  @NonNull
  @Override
  public Dialog onCreateDialog(@Nullable Bundle savedInstanceState) {
    AlertDialog.Builder builder =
        new AlertDialog.Builder(requireContext(), R.style.ThemeOverlay_Qletter_Dialog);
    binding =
        DialogNicknameBinding.inflate(getLayoutInflater().cloneInContext(builder.getContext()));
    api = new AccountApi(((QletterApplication) requireActivity().getApplication()).api());
    String current = requireArguments().getString(ARG_NICKNAME, "");
    binding.nicknameInput.setText(current);
    binding.nicknameInput.setSelection(current.length());
    binding.nicknameCancel.setOnClickListener(ignored -> dismiss());
    binding.nicknameConfirm.setOnClickListener(ignored -> save());
    binding.nicknameInput.setOnEditorActionListener(
        (field, action, event) -> {
          if (action == EditorInfo.IME_ACTION_DONE) {
            save();
            return true;
          }
          return false;
        });
    binding.nicknameInput.addTextChangedListener(
        new android.text.TextWatcher() {
          @Override
          public void beforeTextChanged(CharSequence text, int start, int count, int after) {}

          @Override
          public void onTextChanged(CharSequence text, int start, int before, int count) {}

          @Override
          public void afterTextChanged(android.text.Editable text) {
            binding.nicknameInput.setError(null);
            binding.nicknameError.setVisibility(View.GONE);
          }
        });
    return builder.setView(binding.getRoot()).create();
  }

  private void save() {
    if (binding == null || submitting) return;
    String nickname = AuthInput.nickname(binding.nicknameInput.getText().toString());
    binding.nicknameInput.setError(null);
    binding.nicknameError.setVisibility(View.GONE);
    if (!AuthInput.validNickname(nickname)) {
      binding.nicknameInput.setError(getString(R.string.account_error_nickname));
      binding.nicknameInput.requestFocus();
      return;
    }
    if (nickname.equals(requireArguments().getString(ARG_NICKNAME, ""))) {
      dismissWhenSafe();
      return;
    }
    setBusy(true);
    call =
        api.updateNickname(
            nickname,
            new JsonCall.Result<Account>() {
              @Override
              public void onSuccess(Account account) {
                Ui.on(NicknameDialog.this, () -> completeChange(account.nickname()));
              }

              @Override
              public void onError(ApiError error) {
                Ui.on(NicknameDialog.this, () -> showError(error));
              }
            });
  }

  private void showError(ApiError error) {
    if (binding == null) return;
    setBusy(false);
    String field = error.field("nickname");
    if (field != null) {
      binding.nicknameInput.setError(field);
      binding.nicknameInput.requestFocus();
      return;
    }
    binding.nicknameError.setText(
        AccountErrors.message(
            getResources(), error, getString(R.string.account_error_nickname_save)));
    binding.nicknameError.setVisibility(View.VISIBLE);
  }

  private void setBusy(boolean busy) {
    submitting = busy;
    setCancelable(!busy);
    binding.nicknameConfirm.setEnabled(!busy);
    binding.nicknameConfirm.setText(
        busy ? R.string.common_working : R.string.account_nickname_confirm);
    binding.nicknameCancel.setEnabled(!busy);
  }

  private void dismissWhenSafe() {
    if (isStateSaved() || !isResumed()) {
      dismissWhenResumed = true;
      return;
    }
    dismiss();
  }

  /** 성공 결과를 부모에 넘기고, 상태 저장 중이면 재개할 때 닫아요. */
  void completeChange(String nickname) {
    Bundle result = new Bundle();
    result.putString(RESULT_NICKNAME, nickname);
    getParentFragmentManager().setFragmentResult(REQUEST_KEY, result);
    dismissWhenSafe();
  }

  @Override
  public void onSaveInstanceState(@NonNull Bundle outState) {
    super.onSaveInstanceState(outState);
    outState.putBoolean(STATE_DISMISS, dismissWhenResumed);
  }

  @Override
  public void onStart() {
    super.onStart();
    Dialog dialog = getDialog();
    if (dialog != null && dialog.getWindow() != null)
      dialog.getWindow().setBackgroundDrawableResource(R.drawable.q_dialog_background);
  }

  @Override
  public void onDestroyView() {
    super.onDestroyView();
    if (call != null) call.cancel();
    call = null;
    binding = null;
  }
}
