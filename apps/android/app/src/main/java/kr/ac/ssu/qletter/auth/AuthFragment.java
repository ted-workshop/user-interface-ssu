package kr.ac.ssu.qletter.auth;

import android.os.Build;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.view.ContextThemeWrapper;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.ViewModel;
import androidx.lifecycle.ViewModelProvider;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;
import kr.ac.ssu.qletter.R;

public final class AuthFragment extends Fragment {
  public interface Host {
    AuthApi authApi();

    // 호스트는 토큰을 안전하게 보관한 뒤 앱의 로그인 상태와 탐색을 연결해요.
    void onAuthenticated(AuthApi.Session session);
  }

  private AuthViewModel model;
  private View root;
  private TextInputEditText email;
  private TextInputEditText nickname;
  private TextInputEditText password;
  private TextInputEditText confirmation;
  private AuthViewModel.Page renderedPage;

  @Nullable
  @Override
  public View onCreateView(
      @NonNull LayoutInflater inflater,
      @Nullable ViewGroup container,
      @Nullable Bundle savedInstanceState) {
    if (!(requireActivity() instanceof Host)) throw new IllegalStateException("인증 화면의 호스트가 필요해요.");
    return inflater
        .cloneInContext(new ContextThemeWrapper(requireContext(), R.style.Theme_Qletter_Auth))
        .inflate(R.layout.fragment_auth, container, false);
  }

  @Override
  public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
    root = view;
    email = view.findViewById(R.id.auth_email);
    nickname = view.findViewById(R.id.auth_nickname);
    password = view.findViewById(R.id.auth_password);
    confirmation = view.findViewById(R.id.auth_confirmation);
    AuthApi api = ((Host) requireActivity()).authApi();
    model =
        new ViewModelProvider(
                this,
                new ViewModelProvider.Factory() {
                  @NonNull
                  @Override
                  public <T extends ViewModel> T create(@NonNull Class<T> modelClass) {
                    if (modelClass != AuthViewModel.class)
                      throw new IllegalArgumentException("지원하지 않는 화면 상태예요.");
                    return modelClass.cast(new AuthViewModel(api));
                  }
                })
            .get(AuthViewModel.class);
    ViewCompat.setOnApplyWindowInsetsListener(
        view,
        (target, insets) -> {
          Insets bars =
              insets.getInsets(
                  WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime());
          target.setPadding(bars.left, bars.top, bars.right, bars.bottom);
          return insets;
        });
    view.findViewById(R.id.auth_submit).setOnClickListener(target -> submit());
    view.findViewById(R.id.auth_register)
        .setOnClickListener(target -> model.show(AuthViewModel.Page.REGISTER));
    view.findViewById(R.id.auth_reset)
        .setOnClickListener(target -> model.show(AuthViewModel.Page.RESET));
    view.findViewById(R.id.auth_back_login)
        .setOnClickListener(target -> model.show(AuthViewModel.Page.LOGIN));
    view.findViewById(R.id.auth_resend).setOnClickListener(target -> model.resendVerification());
    TextView.OnEditorActionListener action =
        (target, actionId, event) -> {
          if (actionId != EditorInfo.IME_ACTION_DONE) return false;
          submit();
          return true;
        };
    email.setOnEditorActionListener(action);
    password.setOnEditorActionListener(action);
    confirmation.setOnEditorActionListener(action);
    requireActivity()
        .getOnBackPressedDispatcher()
        .addCallback(
            getViewLifecycleOwner(),
            new OnBackPressedCallback(true) {
              @Override
              public void handleOnBackPressed() {
                AuthViewModel.State current = model.getState().getValue();
                if (current.page != AuthViewModel.Page.LOGIN && !current.isBusy()) {
                  model.show(AuthViewModel.Page.LOGIN);
                } else {
                  setEnabled(false);
                  requireActivity().getOnBackPressedDispatcher().onBackPressed();
                }
              }
            });
    model.getState().observe(getViewLifecycleOwner(), this::render);
  }

  private void submit() {
    AuthViewModel.State current = model.getState().getValue();
    if (current.isAccepted()) {
      model.show(AuthViewModel.Page.LOGIN);
      return;
    }
    model.submit(text(email), text(password), text(nickname), text(confirmation));
  }

  private void render(AuthViewModel.State state) {
    if (state.status == AuthViewModel.Status.AUTHENTICATED) {
      clearPasswords();
      AuthApi.Session session = model.takeSession();
      if (session != null) ((Host) requireActivity()).onAuthenticated(session);
      return;
    }
    boolean registration = state.page == AuthViewModel.Page.REGISTER;
    boolean reset = state.page == AuthViewModel.Page.RESET;
    boolean accepted = state.isAccepted();
    if (renderedPage != state.page || accepted) clearPasswords();
    renderedPage = state.page;
    ((TextView) root.findViewById(R.id.auth_title))
        .setText(
            accepted
                ? R.string.auth_mail_title
                : registration
                    ? R.string.auth_register_title
                    : reset ? R.string.auth_reset_title : R.string.auth_login_title);
    ((TextView) root.findViewById(R.id.auth_description))
        .setText(
            accepted
                ? (state.status == AuthViewModel.Status.RESET_ACCEPTED
                    ? R.string.auth_reset_accepted
                    : R.string.auth_mail_description)
                : registration
                    ? R.string.auth_register_description
                    : reset ? R.string.auth_reset_description : R.string.auth_login_description);
    visible(R.id.auth_fields, !accepted);
    visible(R.id.auth_nickname_layout, registration);
    visible(R.id.auth_password_layout, !reset);
    visible(R.id.auth_confirmation_layout, registration);
    visible(R.id.auth_back_login, registration || reset || accepted);
    visible(R.id.auth_links, state.page == AuthViewModel.Page.LOGIN && !accepted);
    visible(R.id.auth_footer, state.page == AuthViewModel.Page.LOGIN && !accepted);
    visible(R.id.auth_progress, state.isBusy());
    visible(
        R.id.auth_resend,
        state.page == AuthViewModel.Page.VERIFY_EMAIL
            || state.error == AuthApi.Error.EMAIL_VERIFICATION_REQUIRED);
    for (int id :
        new int[] {
          R.id.auth_email_layout,
          R.id.auth_nickname_layout,
          R.id.auth_password_layout,
          R.id.auth_confirmation_layout,
          R.id.auth_submit,
          R.id.auth_back_login,
          R.id.auth_register,
          R.id.auth_reset,
          R.id.auth_resend
        }) root.findViewById(id).setEnabled(!state.isBusy());
    input(R.id.auth_password_layout)
        .setHelperText(registration ? getString(R.string.auth_password_helper) : null);
    password.setImeOptions(registration ? EditorInfo.IME_ACTION_NEXT : EditorInfo.IME_ACTION_DONE);
    email.setImeOptions(reset ? EditorInfo.IME_ACTION_DONE : EditorInfo.IME_ACTION_NEXT);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
      password.setAutofillHints(registration ? "newPassword" : View.AUTOFILL_HINT_PASSWORD);
    MaterialButton submit = root.findViewById(R.id.auth_submit);
    submit.setText(
        state.isBusy()
            ? R.string.auth_processing
            : accepted
                ? R.string.auth_back_login
                : registration
                    ? R.string.auth_submit_registration
                    : reset ? R.string.auth_submit_reset : R.string.auth_login);
    input(R.id.auth_email_layout)
        .setError(
            state.invalidField == AuthViewModel.Field.EMAIL
                ? getString(R.string.auth_error_email)
                : null);
    input(R.id.auth_nickname_layout)
        .setError(
            state.invalidField == AuthViewModel.Field.NICKNAME
                ? getString(R.string.auth_error_nickname)
                : null);
    input(R.id.auth_password_layout)
        .setError(
            state.invalidField == AuthViewModel.Field.PASSWORD
                ? getString(R.string.auth_error_password)
                : null);
    input(R.id.auth_confirmation_layout)
        .setError(
            state.invalidField == AuthViewModel.Field.CONFIRMATION
                ? getString(R.string.auth_error_confirmation)
                : null);
    TextView notice = root.findViewById(R.id.auth_notice);
    visible(
        R.id.auth_notice,
        state.error != null
            || (accepted && state.status == AuthViewModel.Status.EMAIL_CONFIRMATION));
    if (state.error != null) {
      notice.setText(
          state.error == AuthApi.Error.RATE_LIMITED && state.retryAfterSeconds > 0
              ? getString(R.string.auth_error_rate_limit_wait, state.retryAfterSeconds)
              : getString(errorMessage(state.error)));
      notice.setTextColor(requireContext().getColor(R.color.auth_error));
    } else if (accepted) {
      notice.setText(R.string.auth_registration_accepted);
      notice.setTextColor(requireContext().getColor(R.color.auth_secondary));
    }
  }

  private int errorMessage(AuthApi.Error error) {
    switch (error) {
      case INVALID_CREDENTIALS:
        return R.string.auth_error_credentials;
      case EMAIL_VERIFICATION_REQUIRED:
        return R.string.auth_error_verification;
      case RATE_LIMITED:
        return R.string.auth_error_rate_limit;
      case NETWORK:
        return R.string.auth_error_network;
      case INVALID_RESPONSE:
        return R.string.auth_error_response;
      case INVALID_INPUT:
        return R.string.auth_error_input;
      default:
        return R.string.auth_error_unavailable;
    }
  }

  private void visible(int id, boolean visible) {
    root.findViewById(id).setVisibility(visible ? View.VISIBLE : View.GONE);
  }

  private TextInputLayout input(int id) {
    return root.findViewById(id);
  }

  private static String text(TextInputEditText field) {
    return field.getText() == null ? "" : field.getText().toString();
  }

  private void clearPasswords() {
    if (password != null) password.setText("");
    if (confirmation != null) confirmation.setText("");
  }

  @Override
  public void onDestroyView() {
    clearPasswords();
    root = null;
    email = null;
    nickname = null;
    password = null;
    confirmation = null;
    renderedPage = null;
    super.onDestroyView();
  }
}
