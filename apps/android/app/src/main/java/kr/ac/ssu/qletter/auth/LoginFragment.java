package kr.ac.ssu.qletter.auth;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModelProvider;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.ApiError;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.databinding.FragmentLoginBinding;

public final class LoginFragment extends Fragment {
  private static final String ARG_EMAIL = "email";
  private static final String ARG_NOTICE = "notice";

  private FragmentLoginBinding binding;
  private AuthApi api;
  private AuthRequestViewModel requests;
  private boolean submitting;

  static LoginFragment newInstance(@Nullable String email, @Nullable String notice) {
    LoginFragment fragment = new LoginFragment();
    Bundle args = new Bundle();
    args.putString(ARG_EMAIL, email);
    args.putString(ARG_NOTICE, notice);
    fragment.setArguments(args);
    return fragment;
  }

  @Nullable
  @Override
  public View onCreateView(
      @NonNull LayoutInflater inflater,
      @Nullable ViewGroup container,
      @Nullable Bundle savedInstanceState) {
    binding = FragmentLoginBinding.inflate(inflater, container, false);
    return binding.getRoot();
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
    super.onViewCreated(view, savedInstanceState);
    QletterApplication app = (QletterApplication) requireActivity().getApplication();
    api = new AuthApi(app.api());
    requests = new ViewModelProvider(this).get(AuthRequestViewModel.class);
    binding.loginEmail.setText(requireArguments().getString(ARG_EMAIL));
    String notice = requireArguments().getString(ARG_NOTICE);
    if (notice != null && !notice.isEmpty()) {
      binding.loginNotice.setText(notice);
      binding.loginNotice.setVisibility(View.VISIBLE);
    }
    binding.loginSubmit.setOnClickListener(ignored -> submit());
    binding.loginForgot.setOnClickListener(
        ignored -> ((AuthActivity) requireActivity()).showForgot(null));
    binding.loginSignup.setOnClickListener(
        ignored -> ((AuthActivity) requireActivity()).showSignup());
    binding.loginPassword.setOnEditorActionListener(
        (field, action, event) -> {
          if (action == EditorInfo.IME_ACTION_DONE) {
            submit();
            return true;
          }
          return false;
        });
    binding.loginEmail.setOnEditorActionListener(
        (field, action, event) -> {
          if (action == EditorInfo.IME_ACTION_NEXT) {
            binding.loginPassword.requestFocus();
            return true;
          }
          return false;
        });
    clearFieldErrorOnEdit(binding.loginEmail);
    clearFieldErrorOnEdit(binding.loginPassword);
    requests
        .login()
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
                AuthViewModel auth =
                    new ViewModelProvider(requireActivity()).get(AuthViewModel.class);
                showError(state.error, auth.pendingEmail(), auth.pendingPassword());
              } else if (state.value != null) {
                saveSession(state.value);
              } else {
                setBusy(false);
              }
              requests.clearLogin();
            });
  }

  private void submit() {
    if (binding == null || submitting) return;
    String email = AuthInput.email(binding.loginEmail.getText().toString());
    String password = binding.loginPassword.getText().toString();
    binding.loginEmail.setError(null);
    binding.loginPassword.setError(null);
    binding.loginError.setVisibility(View.GONE);
    if (!AuthInput.validEmail(email)) {
      binding.loginEmail.setError(getString(R.string.auth_error_email));
      binding.loginEmail.requestFocus();
      return;
    }
    if (!AuthInput.validPassword(password)) {
      binding.loginPassword.setError(getString(R.string.auth_error_password));
      binding.loginPassword.requestFocus();
      return;
    }
    new ViewModelProvider(requireActivity())
        .get(AuthViewModel.class)
        .holdCredentials(email, password);
    setBusy(true);
    requests.startLogin(api, email, password);
  }

  private void saveSession(AuthApi.Login login) {
    if (binding == null || !isAdded()) return;
    QletterApplication app = (QletterApplication) requireActivity().getApplication();
    app.sessions()
        .signInAsync(
            login.sessionToken,
            login.expiresAt,
            error -> {
              if (binding == null) return;
              if (error != null) {
                setBusy(false);
                showMessage(getString(R.string.auth_error_save));
                return;
              }
              ((AuthActivity) requireActivity()).openMain();
            });
  }

  private void showError(ApiError error, @Nullable String email, @Nullable String password) {
    if (binding == null) return;
    setBusy(false);
    if (error.is("EMAIL_VERIFICATION_REQUIRED")) {
      if (email != null && password != null) {
        new ViewModelProvider(requireActivity())
            .get(AuthViewModel.class)
            .holdCredentials(email, password);
        ((AuthActivity) requireActivity()).showVerify(email);
      } else {
        showMessage(getString(R.string.auth_error_verify_needed));
      }
      return;
    }
    String emailError = error.field("email");
    if (emailError != null) binding.loginEmail.setError(emailError);
    String passwordError = error.field("password");
    if (passwordError != null) binding.loginPassword.setError(passwordError);
    showMessage(
        AuthErrors.message(getResources(), error, getString(R.string.auth_error_login_failed)));
  }

  private void showMessage(String message) {
    binding.loginError.setText(message);
    binding.loginError.setVisibility(View.VISIBLE);
  }

  private void setBusy(boolean busy) {
    submitting = busy;
    binding.loginSubmit.setEnabled(!busy);
    binding.loginSubmit.setText(busy ? R.string.common_working : R.string.auth_login);
    binding.loginForgot.setEnabled(!busy);
    binding.loginSignup.setEnabled(!busy);
  }

  private void clearFieldErrorOnEdit(TextView field) {
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
  public void onDestroyView() {
    super.onDestroyView();
    binding = null;
  }
}
