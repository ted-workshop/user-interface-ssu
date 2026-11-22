package kr.ac.ssu.qletter.auth;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.fragment.app.Fragment;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.LocalNetworkPermission;
import kr.ac.ssu.qletter.common.MainActivity;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.databinding.ActivityAuthBinding;

/** 로그인·가입·비밀번호 찾기를 한 곳에서 보여 주고, 세션이 준비되면 메인 화면으로 넘겨요. */
public final class AuthActivity extends AppCompatActivity {
  private static final String EXTRA_START = "start";
  private static final String EXTRA_EMAIL = "email";
  private static final String START_FORGOT = "forgot";

  private static final String TAG_LOGIN = "login";
  private static final String TAG_SIGNUP = "signup";
  private static final String TAG_VERIFY = "verify";
  private static final String TAG_FORGOT = "forgot";

  private ActivityAuthBinding binding;

  /** 계정 화면에서 비밀번호를 바꾸려고 열었으면 뒤로 가기로 로그인 화면을 거치지 않아요. */
  private boolean openedForPasswordChange;

  private boolean openedMain;

  public static Intent passwordChangeIntent(Context context, String email) {
    return new Intent(context, AuthActivity.class)
        .putExtra(EXTRA_START, START_FORGOT)
        .putExtra(EXTRA_EMAIL, email);
  }

  @Override
  protected void onCreate(@Nullable Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    EdgeToEdge.enable(this);
    binding = ActivityAuthBinding.inflate(getLayoutInflater());
    setContentView(binding.getRoot());
    WindowInsetsControllerCompat bars =
        new WindowInsetsControllerCompat(getWindow(), binding.getRoot());
    bars.setAppearanceLightStatusBars(true);
    bars.setAppearanceLightNavigationBars(true);
    ViewCompat.setOnApplyWindowInsetsListener(
        binding.getRoot(),
        (view, insets) -> {
          Insets system =
              insets.getInsets(
                  WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
          view.setPadding(system.left, system.top, system.right, system.bottom);
          return new WindowInsetsCompat.Builder(insets)
              .setInsets(
                  WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout(),
                  Insets.NONE)
              .build();
        });

    getOnBackPressedDispatcher()
        .addCallback(
            this,
            new OnBackPressedCallback(true) {
              @Override
              public void handleOnBackPressed() {
                back();
              }
            });

    // 화면을 돌리면 FragmentManager가 현재 화면을 복원하므로 다시 고르지 않아요.
    if (savedInstanceState != null
        && getSupportFragmentManager().findFragmentById(R.id.auth_content) != null) {
      showLoading(false);
      return;
    }

    if (START_FORGOT.equals(getIntent().getStringExtra(EXTRA_START))) {
      openedForPasswordChange = true;
      showForgot(getIntent().getStringExtra(EXTRA_EMAIL));
      return;
    }

    QletterApplication app = (QletterApplication) getApplication();
    if (app.sessions().isSignedIn()) {
      openMain();
      return;
    }
    if (app.sessions().changes().getValue() == null) {
      // 저장된 세션을 읽는 동안 로그인 화면을 먼저 보여 주지 않아요.
      showLoading(true);
      app.sessions()
          .changes()
          .observe(
              this,
              ignored -> {
                if (openedMain) return;
                if (app.sessions().isSignedIn()) openMain();
                else showLogin(null, null);
              });
      return;
    }
    showLogin(null, null);
  }

  private void showLoading(boolean loading) {
    binding.authLoading.setVisibility(loading ? android.view.View.VISIBLE : android.view.View.GONE);
  }

  private void replace(Fragment fragment, String tag) {
    showLoading(false);
    getSupportFragmentManager()
        .beginTransaction()
        .setReorderingAllowed(true)
        .replace(R.id.auth_content, fragment, tag)
        .commit();
  }

  void showLogin(@Nullable String email, @Nullable String notice) {
    Fragment current = getSupportFragmentManager().findFragmentById(R.id.auth_content);
    if (current instanceof LoginFragment) return;
    LocalNetworkPermission.request(this);
    replace(LoginFragment.newInstance(email, notice), TAG_LOGIN);
  }

  void showSignup() {
    replace(new SignupFragment(), TAG_SIGNUP);
  }

  void showVerify(String email) {
    replace(VerifyEmailFragment.newInstance(email), TAG_VERIFY);
  }

  void showForgot(@Nullable String email) {
    replace(ForgotPasswordFragment.newInstance(email, openedForPasswordChange), TAG_FORGOT);
  }

  void openMain() {
    if (openedMain) return;
    openedMain = true;
    // 이전 계정의 화면과 back stack이 남지 않게 새 task로 시작해요.
    startActivity(
        new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
    finish();
  }

  /** 가입·확인·찾기 화면의 뒤로 가기는 로그인으로 돌아가요. */
  void back() {
    if (openedMain) return;
    Fragment current = getSupportFragmentManager().findFragmentById(R.id.auth_content);
    // 계정 화면에서 연 비밀번호 찾기는 뒤로 가면 계정으로 돌아가요.
    if (current == null
        || current instanceof LoginFragment
        || openedForPasswordChange
        || START_FORGOT.equals(getIntent().getStringExtra(EXTRA_START))) {
      finish();
      return;
    }
    String email =
        current instanceof VerifyEmailFragment ? ((VerifyEmailFragment) current).email() : null;
    showLogin(email, null);
  }

  /** 비밀번호를 바꾼 뒤에는 서버가 모든 세션을 폐기하므로 기기의 세션도 지워요. */
  void clearedAfterPasswordChange(String email) {
    openedForPasswordChange = false;
    QletterApplication app = (QletterApplication) getApplication();
    app.sessions().clear();
    showLogin(email, getString(R.string.auth_reset_success));
  }
}
