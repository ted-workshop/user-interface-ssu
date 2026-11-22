package kr.ac.ssu.qletter.auth;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModelProvider;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.ApiError;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.databinding.FragmentForgotPasswordBinding;

/** 이메일로 받은 코드와 새 비밀번호로 계정 비밀번호를 다시 정해요. */
public final class ForgotPasswordFragment extends Fragment {
  private static final String ARG_EMAIL = "email";
  private static final String ARG_CHANGE = "change";
  private static final String STATE_EMAIL = "requestedEmail";
  private static final String STATE_RESET = "resetStep";

  private FragmentForgotPasswordBinding binding;
  private AuthApi api;
  private AuthRequestViewModel requests;
  private String requestedEmail;
  private boolean resetStep;
  private boolean submitting;

  static ForgotPasswordFragment newInstance(@Nullable String email, boolean change) {
    ForgotPasswordFragment fragment = new ForgotPasswordFragment();
    Bundle args = new Bundle();
    args.putString(ARG_EMAIL, email);
    args.putBoolean(ARG_CHANGE, change);
    fragment.setArguments(args);
    return fragment;
  }

  @Nullable
  @Override
  public View onCreateView(
      @NonNull LayoutInflater inflater,
      @Nullable ViewGroup container,
      @Nullable Bundle savedInstanceState) {
    binding = FragmentForgotPasswordBinding.inflate(inflater, container, false);
    return binding.getRoot();
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
    super.onViewCreated(view, savedInstanceState);
    api = new AuthApi(((QletterApplication) requireActivity().getApplication()).api());
    requests = new ViewModelProvider(this).get(AuthRequestViewModel.class);
    binding.forgotTitle.setText(
        requireArguments().getBoolean(ARG_CHANGE)
            ? R.string.account_change_password
            : R.string.auth_forgot_title);
    binding.forgotEmail.setText(requireArguments().getString(ARG_EMAIL));
    binding.forgotBack.setOnClickListener(ignored -> ((AuthActivity) requireActivity()).back());
    binding.forgotRequestButton.setOnClickListener(ignored -> requestCode());
    binding.forgotSubmit.setOnClickListener(ignored -> submitReset());
    binding.forgotResend.setOnClickListener(ignored -> requestCode());
    binding.forgotEmail.setOnEditorActionListener(
        (field, action, event) -> {
          if (action == EditorInfo.IME_ACTION_DONE) {
            requestCode();
            return true;
          }
          return false;
        });
    binding.forgotCode.setOnEditorActionListener(
        (field, action, event) -> next(action, binding.forgotPassword));
    binding.forgotPassword.setOnEditorActionListener(
        (field, action, event) -> next(action, binding.forgotPasswordConfirm));
    binding.forgotPasswordConfirm.setOnEditorActionListener(
        (field, action, event) -> {
          if (action == EditorInfo.IME_ACTION_DONE) {
            submitReset();
            return true;
          }
          return false;
        });
    clearOnEdit(binding.forgotEmail);
    clearOnEdit(binding.forgotCode);
    clearOnEdit(binding.forgotPassword);
    clearOnEdit(binding.forgotPasswordConfirm);
    if (savedInstanceState != null) {
      requestedEmail = savedInstanceState.getString(STATE_EMAIL);
      resetStep = savedInstanceState.getBoolean(STATE_RESET);
      if (resetStep && requestedEmail != null) showResetStep(requestedEmail);
    }
    requests
        .resetRequest()
        .observe(
            getViewLifecycleOwner(),
            state -> {
              if (state == null) return;
              if (state.loading) {
                setBusy(true);
                return;
              }
              setBusy(false);
              if (state.error != null) {
                showResetRequestError(state.error);
              } else if (requestedEmail != null) {
                showResetStep(requestedEmail);
              }
              requests.clearResetRequest();
            });
    requests
        .resetConfirm()
        .observe(
            getViewLifecycleOwner(),
            state -> {
              if (state == null) return;
              if (state.loading) {
                setBusy(true);
                return;
              }
              if (state.error != null) {
                setBusy(false);
                showResetConfirmError(state.error);
              } else if (requestedEmail != null) {
                ((AuthActivity) requireActivity()).clearedAfterPasswordChange(requestedEmail);
              } else {
                setBusy(false);
              }
              requests.clearResetConfirm();
            });
  }

  private boolean next(int action, EditText target) {
    if (action == EditorInfo.IME_ACTION_NEXT) {
      target.requestFocus();
      return true;
    }
    return false;
  }

  private void requestCode() {
    if (binding == null || submitting) return;
    String email = AuthInput.email(binding.forgotEmail.getText().toString());
    binding.forgotEmail.setError(null);
    binding.forgotRequestError.setVisibility(View.GONE);
    binding.forgotError.setVisibility(View.GONE);
    if (!AuthInput.validEmail(email)) {
      binding.forgotEmail.setError(getString(R.string.auth_error_email));
      binding.forgotEmail.requestFocus();
      return;
    }
    requestedEmail = email;
    setBusy(true);
    requests.startResetRequest(api, email);
  }

  private void submitReset() {
    if (binding == null || submitting) return;
    String code = binding.forgotCode.getText().toString().trim();
    String password = binding.forgotPassword.getText().toString();
    String confirm = binding.forgotPasswordConfirm.getText().toString();
    binding.forgotCode.setError(null);
    binding.forgotPassword.setError(null);
    binding.forgotPasswordConfirm.setError(null);
    binding.forgotError.setVisibility(View.GONE);
    if (code.isEmpty()) {
      binding.forgotCode.setError(getString(R.string.auth_error_code));
      binding.forgotCode.requestFocus();
      return;
    }
    if (!AuthInput.validPassword(password)) {
      binding.forgotPassword.setError(getString(R.string.auth_error_password));
      binding.forgotPassword.requestFocus();
      return;
    }
    if (!password.equals(confirm)) {
      binding.forgotPasswordConfirm.setError(getString(R.string.auth_error_password_confirm));
      binding.forgotPasswordConfirm.requestFocus();
      return;
    }
    if (requestedEmail == null) {
      requestedEmail = AuthInput.email(binding.forgotEmail.getText().toString());
    }
    setBusy(true);
    requests.startResetConfirm(api, code, password);
  }

  private void showResetRequestError(ApiError error) {
    if (binding == null) return;
    String emailError = error.field("email");
    if (emailError != null) binding.forgotEmail.setError(emailError);
    String message =
        AuthErrors.message(getResources(), error, getString(R.string.auth_error_request_failed));
    if (resetStep) {
      binding.forgotError.setText(message);
      binding.forgotError.setVisibility(View.VISIBLE);
    } else {
      binding.forgotRequestError.setText(message);
      binding.forgotRequestError.setVisibility(View.VISIBLE);
    }
  }

  private void showResetConfirmError(ApiError error) {
    if (binding == null) return;
    String tokenError = error.field("token");
    if (tokenError != null) binding.forgotCode.setError(tokenError);
    String passwordError = error.field("password");
    if (passwordError != null) binding.forgotPassword.setError(passwordError);
    binding.forgotError.setText(
        AuthErrors.message(getResources(), error, getString(R.string.auth_error_reset_failed)));
    binding.forgotError.setVisibility(View.VISIBLE);
  }

  private void setBusy(boolean busy) {
    submitting = busy;
    binding.forgotRequestButton.setEnabled(!busy);
    binding.forgotRequestButton.setText(
        busy ? R.string.common_working : R.string.auth_forgot_request);
    binding.forgotSubmit.setEnabled(!busy);
    binding.forgotSubmit.setText(busy ? R.string.common_working : R.string.auth_reset_submit);
    binding.forgotResend.setEnabled(!busy);
    binding.forgotBack.setEnabled(!busy);
  }

  private void showResetStep(String email) {
    requestedEmail = email;
    resetStep = true;
    binding.forgotEmail.setText(email);
    binding.forgotSent.setText(getString(R.string.auth_forgot_sent_to, email));
    binding.forgotRequestGroup.setVisibility(View.GONE);
    binding.forgotResetGroup.setVisibility(View.VISIBLE);
  }

  private void clearOnEdit(EditText field) {
    field.addTextChangedListener(
        new android.text.TextWatcher() {
          @Override
          public void beforeTextChanged(CharSequence text, int start, int count, int after) {}

          @Override
          public void onTextChanged(CharSequence text, int start, int before, int count) {}

          @Override
          public void afterTextChanged(android.text.Editable text) {
            field.setError(null);
          }
        });
  }

  @Override
  public void onSaveInstanceState(@NonNull Bundle outState) {
    super.onSaveInstanceState(outState);
    outState.putString(STATE_EMAIL, requestedEmail);
    outState.putBoolean(STATE_RESET, resetStep);
  }

  @Override
  public void onDestroyView() {
    super.onDestroyView();
    binding = null;
  }
}
