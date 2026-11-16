package kr.ac.ssu.qletter;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.fragment.app.Fragment;
import androidx.fragment.app.FragmentManager;
import java.io.IOException;
import kr.ac.ssu.qletter.databinding.ActivityMainBinding;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Request;
import okhttp3.Response;

public class MainActivity extends AppCompatActivity {
  private Session observed;
  private boolean observedInitialSession;
  private Call validation;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    EdgeToEdge.enable(this);
    ActivityMainBinding binding = ActivityMainBinding.inflate(getLayoutInflater());
    setContentView(binding.getRoot());
    WindowInsetsControllerCompat bars =
        new WindowInsetsControllerCompat(getWindow(), binding.getRoot());
    bars.setAppearanceLightStatusBars(true);
    bars.setAppearanceLightNavigationBars(true);
    ViewCompat.setOnApplyWindowInsetsListener(
        binding.getRoot(),
        (view, insets) -> {
          Insets barsInset =
              insets.getInsets(
                  WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
          view.setPadding(barsInset.left, barsInset.top, barsInset.right, barsInset.bottom);
          return new WindowInsetsCompat.Builder(insets)
              .setInsets(
                  WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout(),
                  Insets.NONE)
              .build();
        });
    binding.tabs.setOnItemSelectedListener(
        item -> {
          showTab(item.getItemId(), false);
          return true;
        });
    if (savedInstanceState == null) showTab(R.id.tab_home, false);
    SessionStore sessions = app().sessions();
    observed = sessions.snapshot();
    observedInitialSession = sessions.changes().getValue() != null;
    sessions
        .changes()
        .observe(
            this,
            ignored -> {
              Session next = sessions.snapshot();
              if (!observedInitialSession) {
                observedInitialSession = true;
                observed = next;
                if (next != null) verifySession();
              } else if (next != observed) {
                observed = next;
                getSupportFragmentManager()
                    .popBackStackImmediate(null, FragmentManager.POP_BACK_STACK_INCLUSIVE);
                if (binding.tabs.getSelectedItemId() == R.id.tab_home) showTab(R.id.tab_home, true);
                else binding.tabs.setSelectedItemId(R.id.tab_home);
                verifySession();
              }
            });
  }

  private QletterApplication app() {
    return (QletterApplication) getApplication();
  }

  @Override
  protected void onStart() {
    super.onStart();
    verifySession();
  }

  @Override
  protected void onStop() {
    if (validation != null) validation.cancel();
    super.onStop();
  }

  private void verifySession() {
    if (validation != null) validation.cancel();
    if (!app().sessions().isSignedIn()) return;
    QletterApi api = app().api();
    validation = api.newCall(new Request.Builder().url(api.endpoint("me").build()).build());
    validation.enqueue(
        new Callback() {
          @Override
          public void onFailure(Call call, IOException error) {
            // 오프라인 상태에서는 로그인 세션을 유지하고 다음 진입 때 다시 확인해요.
          }

          @Override
          public void onResponse(Call call, Response response) {
            response.close();
          }
        });
  }

  private void showTab(int id, boolean refresh) {
    String tag = getResources().getResourceEntryName(id);
    Fragment current = getSupportFragmentManager().findFragmentById(R.id.tab_content);
    if (!refresh && current != null && tag.equals(current.getTag())) return;
    getSupportFragmentManager()
        .beginTransaction()
        .setReorderingAllowed(true)
        .replace(R.id.tab_content, TabFragment.create(id), tag)
        .commitNow();
  }
}
