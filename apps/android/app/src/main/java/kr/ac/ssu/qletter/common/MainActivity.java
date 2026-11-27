package kr.ac.ssu.qletter.common;

import android.content.Intent;
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
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.account.AccountFragment;
import kr.ac.ssu.qletter.auth.AuthActivity;
import kr.ac.ssu.qletter.channel.ChannelsFragment;
import kr.ac.ssu.qletter.databinding.ActivityMainBinding;
import kr.ac.ssu.qletter.home.HomeFragment;
import kr.ac.ssu.qletter.report.ReportDetailFragment;
import kr.ac.ssu.qletter.report.ReportsTabFragment;
import kr.ac.ssu.qletter.summary.SummaryFragment;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Request;
import okhttp3.Response;

/** 로그인한 사용자의 홈·탭 화면이에요. 세션이 없으면 인증 화면으로 돌려보내요. */
public class MainActivity extends AppCompatActivity {
  private boolean openingAuth;
  private Call validation;
  private ActivityMainBinding binding;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (!app().sessions().isSignedIn()) {
      openAuth();
      return;
    }
    EdgeToEdge.enable(this);
    binding = ActivityMainBinding.inflate(getLayoutInflater());
    setContentView(binding.getRoot());
    LocalNetworkPermission.request(this);
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
          int bottom =
              Math.max(barsInset.bottom, insets.getInsets(WindowInsetsCompat.Type.ime()).bottom);
          view.setPadding(barsInset.left, barsInset.top, barsInset.right, bottom);
          return new WindowInsetsCompat.Builder(insets)
              .setInsets(
                  WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout(),
                  Insets.NONE)
              .build();
        });
    binding.tabs.setOnItemSelectedListener(
        item -> {
          showTab(item.getItemId());
          return true;
        });
    if (savedInstanceState == null) showTab(R.id.tab_home);
    app()
        .sessions()
        .changes()
        .observe(
            this,
            ignored -> {
              if (!app().sessions().isSignedIn()) openAuth();
              else verifySession();
            });
  }

  private QletterApplication app() {
    return (QletterApplication) getApplication();
  }

  @Override
  protected void onStart() {
    super.onStart();
    if (openingAuth) return;
    if (!app().sessions().isSignedIn()) {
      openAuth();
      return;
    }
    app().sessions().refreshExpiryAsync();
    verifySession();
  }

  @Override
  protected void onStop() {
    if (validation != null) validation.cancel();
    super.onStop();
  }

  /** 만료·로그아웃·현재 세션의 401이면 로그인 화면으로 돌아가 이전 계정 화면을 남기지 않아요. */
  private void openAuth() {
    if (openingAuth) return;
    openingAuth = true;
    startActivity(new Intent(this, AuthActivity.class));
    finish();
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

  private void showTab(int id) {
    getSupportFragmentManager()
        .popBackStackImmediate(null, FragmentManager.POP_BACK_STACK_INCLUSIVE);
    String tag = getResources().getResourceEntryName(id);
    Fragment current = getSupportFragmentManager().findFragmentById(R.id.tab_content);
    if (current != null && tag.equals(current.getTag())) return;
    Fragment next;
    if (id == R.id.tab_channels) next = new ChannelsFragment();
    else if (id == R.id.tab_account) next = new AccountFragment();
    else if (id == R.id.tab_reports) next = new ReportsTabFragment();
    else if (id == R.id.tab_home) next = new HomeFragment();
    else if (id == R.id.tab_summary) next = new SummaryFragment();
    else next = TabFragment.create(id);
    getSupportFragmentManager()
        .beginTransaction()
        .setReorderingAllowed(true)
        .replace(R.id.tab_content, next, tag)
        .setPrimaryNavigationFragment(next)
        .commitNow();
  }

  /** 홈의 바로 가기도 하단 탭 선택 상태와 함께 이동해요. */
  public void openTab(int id) {
    if (binding != null && binding.tabs.getMenu().findItem(id) != null)
      binding.tabs.setSelectedItemId(id);
  }

  /** 홈·요약에서 읽은 뒤 뒤로 가면 열었던 화면으로 돌아와요. */
  public void openReport(String reportId) {
    if (getSupportFragmentManager().isStateSaved() || openingAuth) return;
    Fragment detail = ReportDetailFragment.create(reportId);
    getSupportFragmentManager()
        .beginTransaction()
        .setReorderingAllowed(true)
        .replace(R.id.tab_content, detail)
        .setPrimaryNavigationFragment(detail)
        .addToBackStack("report-from-tab")
        .commit();
  }
}
