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
import kr.ac.ssu.qletter.common.ApiError;
import kr.ac.ssu.qletter.common.JsonCall;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.common.Ui;
import kr.ac.ssu.qletter.databinding.DialogRecipientCodeBinding;
import okhttp3.Call;

/** 수신 주소로 받은 코드를 입력해 확인해요. 확인하면 Fragment Result로 주소 id를 돌려줘요. */
public final class RecipientCodeDialog extends DialogFragment {
  static final String REQUEST_KEY = "recipient_code_dialog";
  static final String RESULT_ID = "id";

  private static final String ARG_ID = "id";
  private static final String ARG_EMAIL = "email";
  private static final String TAG = "recipient_code_dialog";

  static void show(FragmentManager manager, String id, String email) {
    if (manager.findFragmentByTag(TAG) != null) return;
    RecipientCodeDialog dialog = new RecipientCodeDialog();
    Bundle args = new Bundle();
    args.putString(ARG_ID, id);
    args.putString(ARG_EMAIL, email);
    dialog.setArguments(args);
    dialog.show(manager, TAG);
  }

  private DialogRecipientCodeBinding binding;
  private AccountApi api;
  private Call call;
  private boolean submitting;

  @NonNull
  @Override
  public Dialog onCreateDialog(@Nullable Bundle savedInstanceState) {
    AlertDialog.Builder builder =
        new AlertDialog.Builder(requireContext(), R.style.ThemeOverlay_Qletter_Dialog);
    binding =
        DialogRecipientCodeBinding.inflate(
            getLayoutInflater().cloneInContext(builder.getContext()));
    api = new AccountApi(((QletterApplication) requireActivity().getApplication()).api());
    binding.codeMessage.setText(
        getString(R.string.account_code_message, requireArguments().getString(ARG_EMAIL)));
    binding.codeCancel.setOnClickListener(ignored -> dismiss());
    binding.codeConfirm.setOnClickListener(ignored -> confirm());
    binding.codeResend.setOnClickListener(ignored -> resend());
    binding.codeInput.setOnEditorActionListener(
        (field, action, event) -> {
          if (action == EditorInfo.IME_ACTION_DONE) {
            confirm();
            return true;
          }
          return false;
        });
    binding.codeInput.addTextChangedListener(
        new android.text.TextWatcher() {
          @Override
          public void beforeTextChanged(CharSequence text, int start, int count, int after) {}

          @Override
          public void onTextChanged(CharSequence text, int start, int before, int count) {}

          @Override
          public void afterTextChanged(android.text.Editable text) {
            binding.codeInput.setError(null);
            binding.codeError.setVisibility(View.GONE);
          }
        });
    return builder.setView(binding.getRoot()).create();
  }

  private void confirm() {
    if (binding == null || submitting) return;
    String code = binding.codeInput.getText().toString().trim();
    binding.codeInput.setError(null);
    binding.codeError.setVisibility(View.GONE);
    binding.codeMessageState.setVisibility(View.GONE);
    if (code.isEmpty()) {
      binding.codeInput.setError(getString(R.string.account_code_error));
      binding.codeInput.requestFocus();
      return;
    }
    setBusy(true);
    call =
        api.confirmRecipient(
            code,
            new JsonCall.Result<Void>() {
              @Override
              public void onSuccess(Void ignored) {
                Ui.on(
                    RecipientCodeDialog.this,
                    () -> {
                      Bundle result = new Bundle();
                      result.putString(RESULT_ID, requireArguments().getString(ARG_ID));
                      getParentFragmentManager().setFragmentResult(REQUEST_KEY, result);
                      dismiss();
                    });
              }

              @Override
              public void onError(ApiError error) {
                Ui.on(RecipientCodeDialog.this, () -> showError(error));
              }
            });
  }

  private void resend() {
    if (binding == null || submitting) return;
    binding.codeError.setVisibility(View.GONE);
    binding.codeMessageState.setVisibility(View.GONE);
    setBusy(true);
    call =
        api.requestVerification(
            requireArguments().getString(ARG_ID),
            new JsonCall.Result<Void>() {
              @Override
              public void onSuccess(Void ignored) {
                Ui.on(
                    RecipientCodeDialog.this,
                    () -> {
                      if (binding == null) return;
                      setBusy(false);
                      binding.codeMessageState.setText(R.string.account_code_resent);
                      binding.codeMessageState.setVisibility(View.VISIBLE);
                    });
              }

              @Override
              public void onError(ApiError error) {
                Ui.on(RecipientCodeDialog.this, () -> showError(error));
              }
            });
  }

  private void showError(ApiError error) {
    if (binding == null) return;
    setBusy(false);
    if (error.is("INVALID_TOKEN")) {
      binding.codeInput.setError(getString(R.string.account_code_error_token));
      binding.codeInput.requestFocus();
      return;
    }
    String field = error.field("token");
    if (field != null) {
      binding.codeInput.setError(field);
      binding.codeInput.requestFocus();
      return;
    }
    if (error.field("email") != null) {
      binding.codeError.setText(error.field("email"));
    } else {
      binding.codeError.setText(
          AccountErrors.message(getResources(), error, getString(R.string.account_error_mail)));
    }
    binding.codeError.setVisibility(View.VISIBLE);
  }

  private void setBusy(boolean busy) {
    submitting = busy;
    binding.codeConfirm.setEnabled(!busy);
    binding.codeConfirm.setText(busy ? R.string.common_working : R.string.account_code_confirm);
    binding.codeResend.setEnabled(!busy);
    binding.codeCancel.setEnabled(!busy);
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
