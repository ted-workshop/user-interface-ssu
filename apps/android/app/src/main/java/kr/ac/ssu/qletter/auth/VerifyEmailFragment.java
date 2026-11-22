package kr.ac.ssu.qletter.auth;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModelProvider;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.ApiError;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.databinding.FragmentVerifyEmailBinding;

/** 가입 또는 로그인 응답 뒤에 메일로 받은 코드로 이메일을 확인해요. */
public final class VerifyEmailFragment extends Fragment {
  private static final String ARG_EMAIL = "email";

  private FragmentVerifyEmailBinding binding;
  private AuthApi api;
  private AuthRequestViewModel requests;
  private String email;
  private String password;
  private boolean submitting;

  static VerifyEmailFragment newInstance(String email) {
    VerifyEmailFragment fragment = new VerifyEmailFragment();
    Bundle args = new Bundle();
    args.putString(ARG_EMAIL, email);
    fragment.setArguments(args);
    return fragment;
  }

  String email() {
    return email;
  }

  @Nullable
  @Override
  public View onCreateView(
      @NonNull LayoutInflater inflater,
      @Nullable ViewGroup container,
      @Nullable Bundle savedInstanceState) {
    binding = FragmentVerifyEmailBinding.inflate(inflater, container, false);
    return binding.getRoot();
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
    super.onViewCreated(view, savedInstanceState);
    email = requireArguments().getString(ARG_EMAIL, "");
    password = new ViewModelProvider(requireActivity()).get(AuthViewModel.class).pendingPassword();
    api = new AuthApi(((QletterApplication) requireActivity().getApplication()).api());
    requests = new ViewModelProvider(this).get(AuthRequestViewModel.class);
    binding.verifySubtitle.setText(getString(R.string.auth_verify_subtitle, email));
    binding.verifyBack.setOnClickListener(ignored -> ((AuthActivity) requireActivity()).back());
    binding.verifySubmit.setOnClickListener(ignored -> submit());
    binding.verifyResend.setOnClickListener(ignored -> resend());
    binding.verifyCode.setOnEditorActionListener(
        (field, action, event) -> {
          if (action == EditorInfo.IME_ACTION_DONE) {
            submit();
            return true;
          }
          return false;
        });
    binding.verifyCode.addTextChangedListener(
        new android.text.TextWatcher() {
          @Override
          public void beforeTextChanged(CharSequence text, int start, int count, int after) {}

          @Override
          public void onTextChanged(CharSequence text, int start, int before, int count) {}

          @Override
          public void afterTextChanged(android.text.Editable text) {
            binding.verifyCode.setError(null);
          }
        });
    requests
        .verify()
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
                showError(state.error);
              } else {
                new ViewModelProvider(requireActivity())
                    .get(AuthViewModel.class)
                    .clearCredentials();
                ((AuthActivity) requireActivity())
                    .showLogin(email, getString(R.string.auth_verify_success));
              }
              requests.clearVerify();
            });
    requests
        .resend()
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
                showMessage(
                    AuthErrors.message(
                        getResources(), state.error, getString(R.string.auth_error_resend_failed)));
              } else {
                binding.verifyNotice.setText(R.string.auth_verify_resend_done);
                binding.verifyNotice.setVisibility(View.VISIBLE);
              }
              requests.clearResend();
            });
  }

  private void submit() {
    if (binding == null || submitting) return;
    String code = binding.verifyCode.getText().toString().trim();
    binding.verifyCode.setError(null);
    binding.verifyError.setVisibility(View.GONE);
    if (code.isEmpty()) {
      binding.verifyCode.setError(getString(R.string.auth_error_code));
      binding.verifyCode.requestFocus();
      return;
    }
    if (password == null || password.isEmpty()) {
      showMessage(getString(R.string.auth_verify_missing));
      return;
    }
    setBusy(true);
    requests.startVerify(api, code, password);
  }

  private void resend() {
    if (binding == null || submitting) return;
    binding.verifyError.setVisibility(View.GONE);
    binding.verifyNotice.setVisibility(View.GONE);
    setBusy(true);
    requests.startResend(api, email);
  }

  private void showError(ApiError error) {
    if (binding == null) return;
    setBusy(false);
    String codeError = error.field("token");
    if (codeError != null) binding.verifyCode.setError(codeError);
    showMessage(
        AuthErrors.message(getResources(), error, getString(R.string.auth_error_verify_failed)));
  }

  private void showMessage(String message) {
    binding.verifyError.setText(message);
    binding.verifyError.setVisibility(View.VISIBLE);
  }

  private void setBusy(boolean busy) {
    submitting = busy;
    binding.verifySubmit.setEnabled(!busy);
    binding.verifySubmit.setText(busy ? R.string.common_working : R.string.auth_verify_submit);
    binding.verifyResend.setEnabled(!busy);
    binding.verifyBack.setEnabled(!busy);
  }

  @Override
  public void onDestroyView() {
    super.onDestroyView();
    binding = null;
    password = null;
  }
}
