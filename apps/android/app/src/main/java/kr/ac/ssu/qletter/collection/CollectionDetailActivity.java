package kr.ac.ssu.qletter.collection;

import android.os.Bundle;
import android.view.View;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.common.SessionStore;
import kr.ac.ssu.qletter.databinding.ActivityCollectionDetailBinding;
import okhttp3.Call;

public class CollectionDetailActivity extends AppCompatActivity {
  public static final String EXTRA_ID = "id";
  public static final String EXTRA_NAME = "name";
  public static final String EXTRA_REPORT_COUNT = "reportCount";
  private static final String STATE_NAME = "state_name";
  private static final String STATE_REPORT_COUNT = "state_report_count";
  private static final String STATE_CHANGED = "state_changed";

  private ActivityCollectionDetailBinding binding;
  private final List<CollectionReport> reports = new ArrayList<>();
  private CollectionReportAdapter adapter;
  private Call loadCall;
  private CollectionApi collectionApi;
  private ReportCollection collection;
  private SessionStore sessions;
  private Long openedRevision;
  private boolean changed;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    WindowCompat.enableEdgeToEdge(getWindow());

    binding = ActivityCollectionDetailBinding.inflate(getLayoutInflater());
    setContentView(binding.getRoot());

    // 회전으로 다시 만들어지면 처음 Intent 대신 저장해 둔 이름·개수·변경 여부를 써요(07강).
    String name = getIntent().getStringExtra(EXTRA_NAME);
    int reportCount = getIntent().getIntExtra(EXTRA_REPORT_COUNT, 0);
    if (savedInstanceState != null) {
      name = savedInstanceState.getString(STATE_NAME, name);
      reportCount = savedInstanceState.getInt(STATE_REPORT_COUNT, reportCount);
      changed = savedInstanceState.getBoolean(STATE_CHANGED);
      if (changed) setResult(RESULT_OK);
    }
    collection = new ReportCollection(name, reportCount, getIntent().getStringExtra(EXTRA_ID));
    QletterApplication app = (QletterApplication) getApplication();
    collectionApi = new CollectionApi(app.api(), getResources());
    binding.detailRetry.setOnClickListener(v -> loadReports(collection.getId()));
    showHeader();

    // 상세는 별도 Activity라 MainActivity의 세션 관찰이 닿지 않아요. 여기서도 세션이 바뀌면 닫아요(ADR-0038).
    sessions = app.sessions();
    openedRevision = sessions.changes().getValue();
    sessions
        .changes()
        .observe(
            this,
            revision -> {
              if (!Objects.equals(revision, openedRevision)) closeForSessionChange();
            });

    binding.detailBack.setOnClickListener(v -> finish());
    binding.detailRenameButton.setOnClickListener(
        v -> CollectionNameSheet.show(getSupportFragmentManager(), collection));
    getSupportFragmentManager()
        .setFragmentResultListener(
            CollectionNameSheet.REQUEST_KEY,
            this,
            (key, result) -> {
              if (sessionChanged()) return;
              // 저장 중 회전으로 결과를 놓쳤으면 목록 화면이 다시 불러오게만 알려요.
              if (result.getBoolean(CollectionNameSheet.RESULT_RELOAD)) {
                changed = true;
                setResult(RESULT_OK);
                return;
              }
              collection = CollectionNameSheet.collectionFrom(result);
              changed = true;
              showHeader();
              // 목록 화면도 바뀐 이름을 다시 불러오게 알려요.
              setResult(RESULT_OK);
            });
    getSupportFragmentManager()
        .setFragmentResultListener(
            CollectionDeleteDialog.REQUEST_KEY, this, (key, result) -> deleteCollection());
    binding.detailDeleteButton.setOnClickListener(v -> confirmDelete());

    adapter = new CollectionReportAdapter(reports);
    binding.detailReportsList.setLayoutManager(new LinearLayoutManager(this));
    binding.detailReportsList.setAdapter(adapter);

    // XML의 피그마 여백(좌우 16, 위 32)에 시스템 바 영역을 더해요.
    int start = binding.getRoot().getPaddingStart();
    int top = binding.getRoot().getPaddingTop();
    int end = binding.getRoot().getPaddingEnd();
    ViewCompat.setOnApplyWindowInsetsListener(
        binding.getRoot(),
        (v, insets) -> {
          Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
          v.setPaddingRelative(
              start + systemBars.left,
              top + systemBars.top,
              end + systemBars.right,
              systemBars.bottom);
          return insets;
        });

    loadReports(collection.getId());
  }

  @Override
  protected void onStart() {
    super.onStart();
    // 백그라운드에 있는 동안 만료됐으면 돌아오자마자 개인 데이터를 지우고 닫아요.
    if (sessionChanged()) closeForSessionChange();
  }

  @Override
  protected void onSaveInstanceState(@NonNull Bundle outState) {
    super.onSaveInstanceState(outState);
    outState.putString(STATE_NAME, collection.getName());
    outState.putInt(STATE_REPORT_COUNT, collection.getReportCount());
    outState.putBoolean(STATE_CHANGED, changed);
  }

  /** 상세를 연 뒤 로그인이 풀리거나 만료되거나 다른 계정으로 바뀌었는지 봐요. */
  private boolean sessionChanged() {
    return !sessions.isSignedIn() || !Objects.equals(sessions.changes().getValue(), openedRevision);
  }

  private void closeForSessionChange() {
    if (isFinishing()) return;
    if (loadCall != null) loadCall.cancel();
    binding.detailName.setText("");
    binding.detailCount.setText("");
    reports.clear();
    adapter.notifyDataSetChanged();
    finish();
  }

  private void showHeader() {
    binding.detailName.setText(collection.getName());
    binding.detailCount.setText(
        getString(R.string.collection_detail_summary, collection.getReportCount()));
  }

  private void confirmDelete() {
    CollectionDeleteDialog.show(getSupportFragmentManager(), collection);
  }

  private void deleteCollection() {
    collectionApi.delete(
        collection.getId(),
        new CollectionApi.Result<Void>() {
          @Override
          public void onSuccess(Void value) {
            runOnUiThread(
                () -> {
                  if (isDestroyed() || sessionChanged()) return;
                  setResult(RESULT_OK);
                  finish();
                });
          }

          @Override
          public void onError(String message) {
            runOnUiThread(
                () -> {
                  if (isDestroyed()) return;
                  Toast.makeText(CollectionDetailActivity.this, message, Toast.LENGTH_SHORT).show();
                });
          }
        });
  }

  @Override
  protected void onDestroy() {
    if (loadCall != null) loadCall.cancel();
    loadCall = null;
    super.onDestroy();
  }

  private void loadReports(String id) {
    binding.detailLoading.setVisibility(View.VISIBLE);
    binding.detailMore.setVisibility(View.GONE);
    binding.detailState.setVisibility(View.GONE);
    if (loadCall != null) loadCall.cancel();

    loadCall =
        collectionApi.reports(
            id,
            new CollectionApi.Result<CollectionApi.Page<CollectionReport>>() {
              @Override
              public void onSuccess(CollectionApi.Page<CollectionReport> page) {
                runOnUiThread(
                    () -> {
                      if (isDestroyed() || sessionChanged()) return;
                      binding.detailLoading.setVisibility(View.GONE);
                      reports.clear();
                      reports.addAll(page.items);
                      adapter.notifyDataSetChanged();
                      if (reports.isEmpty())
                        showState(getString(R.string.collection_detail_empty), false);
                      // 헤더의 리포트 수보다 적게 받았으면 몇 편까지 보이는지 알려요.
                      if (page.hasMore) {
                        binding.detailMore.setText(
                            getString(R.string.collection_more_reports, reports.size()));
                        binding.detailMore.setVisibility(View.VISIBLE);
                      }
                    });
              }

              @Override
              public void onError(String message) {
                runOnUiThread(
                    () -> {
                      if (isDestroyed() || sessionChanged()) return;
                      binding.detailLoading.setVisibility(View.GONE);
                      reports.clear();
                      adapter.notifyDataSetChanged();
                      showState(message, true);
                    });
              }
            });
  }

  private void showState(String message, boolean retry) {
    binding.detailMessage.setText(message);
    binding.detailRetry.setVisibility(retry ? View.VISIBLE : View.GONE);
    binding.detailState.setVisibility(View.VISIBLE);
  }
}
