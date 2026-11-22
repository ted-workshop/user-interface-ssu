package kr.ac.ssu.qletter.auth;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.Lifecycle;
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

  private static final String STATE_FOR_CHANGE = "openedForPasswordChange";
  private static final String STATE_MAIN_PENDING = "mainPending";
  private static final String STATE_PENDING_SCREEN = "pendingScreen";
  private static final String STATE_PENDING_EMAIL = "pendingEmail";
  private static final String STATE_PENDING_NOTICE = "pendingNotice";
  private static final String STATE_PENDING_CHANGE = "pendingChange";

  private ActivityAuthBinding binding;

  /** 계정 화면에서 비밀번호를 바꾸려고 열었으면 뒤로 가기로 로그인 화면을 거치지 않아요. */
  private boolean openedForPasswordChange;

  private boolean openedMain;
  private boolean mainPending;

  // 응답이 Activity 상태 저장 뒤에 와도 잃지 않고 재개 때 한 번 적용해요.
  @Nullable private String pendingScreen;
  @Nullable private String pendingEmail;
  @Nullable private String pendingNotice;
  private boolean pendingChange;

  public static Intent passwordChangeIntent(Context context, String email) {
    return new Intent(context, AuthActivity.class)
        .putExtra(EXTRA_START, START_FORGOT)
        .putExtra(EXTRA_EMAIL, email);
  }

  @Override
  protected void onCreate(@Nullable Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    restorePending(savedInstanceState);
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
      // 로그인한 채로 앱 아이콘을 다시 눌렀으면 기존 메인 화면을 그대로 보여 줘요.
      if (!isTaskRoot()) {
        finish();
        return;
      }
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

  @Override
  protected void onResume() {
    super.onResume();
    if (openedMain) return;
    QletterApplication app = (QletterApplication) getApplication();
    if (mainPending) {
      mainPending = false;
      if (app.sessions().isSignedIn()) startMain();
      else showLogin(null, null);
      return;
    }
    if (pendingScreen != null) {
      String screen = pendingScreen;
      String email = pendingEmail;
      String notice = pendingNotice;
      boolean change = pendingChange;
      clearPending();
      apply(screen, email, notice, change);
    }
  }

  @Override
  protected void onSaveInstanceState(@NonNull Bundle outState) {
    super.onSaveInstanceState(outState);
    outState.putBoolean(STATE_FOR_CHANGE, openedForPasswordChange);
    outState.putBoolean(STATE_MAIN_PENDING, mainPending);
    if (pendingScreen != null) {
      outState.putString(STATE_PENDING_SCREEN, pendingScreen);
      outState.putString(STATE_PENDING_EMAIL, pendingEmail);
      outState.putString(STATE_PENDING_NOTICE, pendingNotice);
      outState.putBoolean(STATE_PENDING_CHANGE, pendingChange);
    }
  }

  private void restorePending(@Nullable Bundle savedInstanceState) {
    if (savedInstanceState == null) return;
    openedForPasswordChange = savedInstanceState.getBoolean(STATE_FOR_CHANGE);
    mainPending = savedInstanceState.getBoolean(STATE_MAIN_PENDING);
    pendingScreen = savedInstanceState.getString(STATE_PENDING_SCREEN);
    pendingEmail = savedInstanceState.getString(STATE_PENDING_EMAIL);
    pendingNotice = savedInstanceState.getString(STATE_PENDING_NOTICE);
    pendingChange = savedInstanceState.getBoolean(STATE_PENDING_CHANGE);
  }

  private void showLoading(boolean loading) {
    binding.authLoading.setVisibility(loading ? android.view.View.VISIBLE : android.view.View.GONE);
  }

  /** 지금 화면을 바꿀 수 있으면 바꾸고, 상태가 저장됐으면 재개 때 한 번 적용해요. */
  private void navigate(
      String screen, @Nullable String email, @Nullable String notice, boolean change) {
    if (isFinishing() || isDestroyed()) return;
    if (getSupportFragmentManager().isStateSaved()
        || !getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)) {
      pendingScreen = screen;
      pendingEmail = email;
      pendingNotice = notice;
      pendingChange = change;
      return;
    }
    clearPending();
    apply(screen, email, notice, change);
  }

  private void apply(
      String screen, @Nullable String email, @Nullable String notice, boolean change) {
    switch (screen) {
      case TAG_LOGIN:
        Fragment current = getSupportFragmentManager().findFragmentById(R.id.auth_content);
        if (current instanceof LoginFragment) return;
        LocalNetworkPermission.request(this);
        replace(LoginFragment.newInstance(email, notice), TAG_LOGIN);
        break;
      case TAG_SIGNUP:
        replace(new SignupFragment(), TAG_SIGNUP);
        break;
      case TAG_VERIFY:
        replace(VerifyEmailFragment.newInstance(email), TAG_VERIFY);
        break;
      case TAG_FORGOT:
        replace(ForgotPasswordFragment.newInstance(email, change), TAG_FORGOT);
        break;
      default:
        break;
    }
  }

  private void replace(Fragment fragment, String tag) {
    showLoading(false);
    getSupportFragmentManager()
        .beginTransaction()
        .setReorderingAllowed(true)
        .replace(R.id.auth_content, fragment, tag)
        .commitNow();
  }

  void showLogin(@Nullable String email, @Nullable String notice) {
    navigate(TAG_LOGIN, email, notice, false);
  }

  void showSignup() {
    navigate(TAG_SIGNUP, null, null, false);
  }

  void showVerify(String email) {
    navigate(TAG_VERIFY, email, null, false);
  }

  void showForgot(@Nullable String email) {
    navigate(TAG_FORGOT, email, null, openedForPasswordChange);
  }

  void openMain() {
    if (openedMain) return;
    if (getSupportFragmentManager().isStateSaved()
        || !getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.STARTED)) {
      mainPending = true;
      showLoading(true);
      return;
    }
    startMain();
  }

  private void startMain() {
    if (openedMain) return;
    openedMain = true;
    mainPending = false;
    clearPending();
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
    if (current == null || current instanceof LoginFragment || openedForPasswordChange) {
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

  private void clearPending() {
    pendingScreen = null;
    pendingEmail = null;
    pendingNotice = null;
    pendingChange = false;
  }
}
