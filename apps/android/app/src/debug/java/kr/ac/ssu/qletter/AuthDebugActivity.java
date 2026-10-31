package kr.ac.ssu.qletter;

import android.graphics.Color;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import kr.ac.ssu.qletter.auth.AuthApi;
import kr.ac.ssu.qletter.auth.AuthClient;
import kr.ac.ssu.qletter.auth.AuthFragment;

public final class AuthDebugActivity extends AppCompatActivity implements AuthFragment.Host {
  private final AuthApi api = new AuthClient(BuildConfig.API_BASE_URL);

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    setTheme(R.style.Theme_Qletter_Auth);
    super.onCreate(savedInstanceState);
    EdgeToEdge.enable(
        this,
        SystemBarStyle.light(Color.TRANSPARENT, Color.BLACK),
        SystemBarStyle.light(Color.TRANSPARENT, Color.BLACK));
    setContentView(R.layout.activity_auth_debug);
    if (savedInstanceState == null)
      getSupportFragmentManager()
          .beginTransaction()
          .replace(R.id.auth_debug_container, new AuthFragment())
          .commit();
  }

  @Override
  public AuthApi authApi() {
    return api;
  }

  @Override
  public void onAuthenticated(AuthApi.Session session) {
    new MaterialAlertDialogBuilder(this)
        .setTitle(R.string.auth_debug_success_title)
        .setMessage(getString(R.string.auth_debug_success_message, session.nickname))
        .setPositiveButton(R.string.auth_debug_close, (dialog, which) -> finish())
        .setOnCancelListener(dialog -> finish())
        .show();
  }
}
