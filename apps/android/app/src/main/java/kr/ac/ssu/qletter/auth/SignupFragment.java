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
import kr.ac.ssu.qletter.common.JsonCall;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.common.Ui;
import kr.ac.ssu.qletter.databinding.FragmentSignupBinding;
import okhttp3.Call;

public final class SignupFragment extends Fragment {
  private FragmentSignupBinding binding;
  private AuthApi api;
  private Call call;
  private boolean submitting;

  @Nullable
  @Override
  public View onCreateView(
      @NonNull LayoutInflater inflater,
      @Nullable ViewGroup container,
      @Nullable Bundle savedInstanceState) {
    binding = FragmentSignupBinding.inflate(inflater, container, false);
    return binding.getRoot();
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
    super.onViewCreated(view, savedInstanceState);
    api = new AuthApi(((QletterApplication) requireActivity().getApplication()).api());
    binding.signupBack.setOnClickListener(ignored -> ((AuthActivity) requireActivity()).back());
    binding.signupLogin.setOnClickListener(
        ignored -> ((AuthActivity) requireActivity()).showLogin(null, null));
    binding.signupSubmit.setOnClickListener(ignored -> submit());
    binding.signupEmail.setOnEditorActionListener(
        (field, action, event) -> next(action, binding.signupNickname));
    binding.signupNickname.setOnEditorActionListener(
        (field, action, event) -> next(action, binding.signupPassword));
    binding.signupPassword.setOnEditorActionListener(
        (field, action, event) -> next(action, binding.signupPasswordConfirm));
    binding.signupPasswordConfirm.setOnEditorActionListener(
        (field, action, event) -> {
          if (action == EditorInfo.IME_ACTION_DONE) {
            submit();
            return true;
          }
          return false;
        });
    clearOnEdit(binding.signupEmail);
    clearOnEdit(binding.signupNickname);
    clearOnEdit(binding.signupPassword);
    clearOnEdit(binding.signupPasswordConfirm);
    binding.signupAgree.setOnCheckedChangeListener(
        (button, checked) -> binding.signupError.setVisibility(View.GONE));
  }

  private boolean next(int action, EditText target) {
    if (action == EditorInfo.IME_ACTION_NEXT) {
      target.requestFocus();
      return true;
    }
    return false;
  }

  private void submit() {
    if (binding == null || submitting) return;
    String email = AuthInput.email(binding.signupEmail.getText().toString());
    String nickname = AuthInput.nickname(binding.signupNickname.getText().toString());
    String password = binding.signupPassword.getText().toString();
    String confirm = binding.signupPasswordConfirm.getText().toString();
    binding.signupEmail.setError(null);
    binding.signupNickname.setError(null);
    binding.signupPassword.setError(null);
    binding.signupPasswordConfirm.setError(null);
    binding.signupError.setVisibility(View.GONE);

    if (!AuthInput.validEmail(email)) {
      binding.signupEmail.setError(getString(R.string.auth_error_email));
      binding.signupEmail.requestFocus();
      return;
    }
    if (!AuthInput.validNickname(nickname)) {
      binding.signupNickname.setError(getString(R.string.auth_error_nickname));
      binding.signupNickname.requestFocus();
      return;
    }
    if (!AuthInput.validPassword(password)) {
      binding.signupPassword.setError(getString(R.string.auth_error_password));
      binding.signupPassword.requestFocus();
      return;
    }
    if (!password.equals(confirm)) {
      binding.signupPasswordConfirm.setError(getString(R.string.auth_error_password_confirm));
      binding.signupPasswordConfirm.requestFocus();
      return;
    }
    if (!binding.signupAgree.isChecked()) {
      showMessage(getString(R.string.auth_error_agree));
      binding.signupAgree.requestFocus();
      return;
    }

    setBusy(true);
    call =
        api.register(
            email,
            password,
            nickname,
            new JsonCall.Result<Void>() {
              @Override
              public void onSuccess(Void ignored) {
                Ui.on(
                    SignupFragment.this,
                    () -> {
                      if (binding == null) return;
                      new ViewModelProvider(requireActivity())
                          .get(AuthViewModel.class)
                          .holdCredentials(email, password);
                      ((AuthActivity) requireActivity()).showVerify(email);
                    });
              }

              @Override
              public void onError(ApiError error) {
                Ui.on(SignupFragment.this, () -> showError(error));
              }
            });
  }

  private void showError(ApiError error) {
    if (binding == null) return;
    setBusy(false);
    String emailError = error.field("email");
    if (emailError != null) binding.signupEmail.setError(emailError);
    String nicknameError = error.field("nickname");
    if (nicknameError != null) binding.signupNickname.setError(nicknameError);
    String passwordError = error.field("password");
    if (passwordError != null) binding.signupPassword.setError(passwordError);
    showMessage(
        AuthErrors.message(getResources(), error, getString(R.string.auth_error_signup_failed)));
  }

  private void showMessage(String message) {
    binding.signupError.setText(message);
    binding.signupError.setVisibility(View.VISIBLE);
  }

  private void setBusy(boolean busy) {
    submitting = busy;
    binding.signupSubmit.setEnabled(!busy);
    binding.signupSubmit.setText(busy ? R.string.common_working : R.string.auth_signup_submit);
    binding.signupBack.setEnabled(!busy);
    binding.signupLogin.setEnabled(!busy);
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
  public void onDestroyView() {
    super.onDestroyView();
    if (call != null) call.cancel();
    call = null;
    binding = null;
  }
}
