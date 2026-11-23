package kr.ac.ssu.qletter.collection;

import android.annotation.SuppressLint;
import android.os.Bundle;
import android.view.View;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.lifecycle.ViewModelProvider;
import androidx.recyclerview.widget.LinearLayoutManager;
import java.util.Objects;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.ConfirmDialog;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.common.SessionStore;
import kr.ac.ssu.qletter.databinding.ActivityCollectionDetailBinding;

public class CollectionDetailActivity extends AppCompatActivity {
  public static final String EXTRA_ID = "id";
  public static final String EXTRA_NAME = "name";
  public static final String EXTRA_REPORT_COUNT = "reportCount";
  private static final String STATE_NAME = "state_name";
  private static final String STATE_REPORT_COUNT = "state_report_count";
  private static final String STATE_CHANGED = "state_changed";

  private static final String REMOVE_REQUEST_KEY = "collection_remove_report";
  private static final String REMOVE_DIALOG_TAG = "collection_remove_dialog";

  private ActivityCollectionDetailBinding binding;
  private CollectionReportAdapter adapter;
  private CollectionDetailViewModel model;
  // 이 화면의 어댑터가 반영한 마지막 변경 번호예요.
  private int appliedSeq;
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
    // Activity 범위 ViewModel이라 회전해도 같은 목록과 요청을 이어 받아요.
    model = new ViewModelProvider(this).get(CollectionDetailViewModel.class);
    model.start(collectionApi, collection.getId(), reportCount);
    binding.detailRetry.setOnClickListener(v -> model.load());
    binding.detailMore.setOnClickListener(v -> model.loadMore());
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
              collection = CollectionNameSheet.collectionFrom(result);
              model.setReportCount(collection.getReportCount());
              changed = true;
              showHeader();
              // 목록 화면도 바뀐 이름을 다시 불러오게 알려요.
              setResult(RESULT_OK);
            });
    getSupportFragmentManager()
        .setFragmentResultListener(
            CollectionDeleteDialog.REQUEST_KEY, this, (key, result) -> deleteCollection());
    binding.detailDeleteButton.setOnClickListener(v -> confirmDelete());
    getSupportFragmentManager()
        .setFragmentResultListener(
            REMOVE_REQUEST_KEY,
            this,
            (key, result) -> {
              if (sessionChanged()) return;
              model.remove(result.getString(ConfirmDialog.RESULT_ID));
            });

    adapter =
        new CollectionReportAdapter(
            model.reports(),
            new CollectionReportAdapter.Listener() {
              @Override
              public void onRemove(CollectionReport report) {
                confirmRemove(report);
              }

              @Override
              public boolean isRemoving(CollectionReport report) {
                return model.isRemoving(report.getId());
              }
            });
    binding.detailReportsList.setLayoutManager(new LinearLayoutManager(this));
    binding.detailReportsList.setAdapter(adapter);
    // 새 어댑터는 지금 목록을 통째로 그리니 지금까지의 변경은 이미 반영한 셈이에요.
    appliedSeq = model.seq();

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

    model.changes().observe(this, this::applyChange);
    model.status().observe(this, this::renderStatus);
    model.error().observe(this, this::renderError);
    model
        .reportCount()
        .observe(
            this,
            count -> {
              collection = new ReportCollection(collection.getName(), count, collection.getId());
              showHeader();
              // 하나라도 뺐으면 모음 목록이 개수를 다시 받게 알려요.
              if (model.changed()) markChanged();
            });
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
    // 개인 데이터를 먼저 숨기고 닫아요. 진행 중인 요청은 ViewModel이 정리될 때 취소돼요.
    binding.detailName.setText("");
    binding.detailCount.setText("");
    binding.detailReportsList.setVisibility(View.GONE);
    finish();
  }

  private void markChanged() {
    changed = true;
    setResult(RESULT_OK);
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

  private void confirmRemove(CollectionReport report) {
    ConfirmDialog.show(
        getSupportFragmentManager(),
        REMOVE_DIALOG_TAG,
        REMOVE_REQUEST_KEY,
        getString(R.string.collection_remove_title),
        getString(R.string.collection_remove_message, report.getTitle()),
        getString(R.string.collection_remove),
        report.getId());
  }

  /** ViewModel이 바꾼 만큼만 목록을 다시 그려요. 놓친 변경이 있으면 전체를 다시 그려요. */
  @SuppressLint("NotifyDataSetChanged")
  private void applyChange(CollectionDetailViewModel.Change change) {
    if (change == null || change.seq <= appliedSeq) return;
    if (change.seq != appliedSeq + 1 || change.kind == CollectionDetailViewModel.RELOADED) {
      adapter.notifyDataSetChanged();
    } else if (change.kind == CollectionDetailViewModel.APPENDED) {
      adapter.notifyItemRangeInserted(change.position, change.count);
    } else if (change.kind == CollectionDetailViewModel.REMOVED) {
      adapter.notifyItemRemoved(change.position);
    } else {
      adapter.notifyItemChanged(change.position);
    }
    appliedSeq = change.seq;
    renderStatus(model.status().getValue());
  }

  private void renderStatus(CollectionDetailViewModel.Status status) {
    if (status == null) return;
    binding.detailLoading.setVisibility(status.loading ? View.VISIBLE : View.GONE);
    if (status.loadError != null) {
      showState(status.loadError, true);
    } else if (!status.loading && model.reports().isEmpty() && !model.hasMore()) {
      showState(getString(R.string.collection_detail_empty), false);
    } else {
      binding.detailState.setVisibility(View.GONE);
    }
    boolean more = !status.loading && status.loadError == null && model.hasMore();
    binding.detailMore.setVisibility(more ? View.VISIBLE : View.GONE);
    binding.detailMore.setEnabled(!status.moreLoading);
    binding.detailMore.setText(
        status.moreLoading ? R.string.collection_more_loading : R.string.collection_more);
    binding.detailMoreError.setText(status.moreError);
    binding.detailMoreError.setVisibility(
        more && status.moreError != null ? View.VISIBLE : View.GONE);
  }

  /** 빼기 실패는 한 번만 알려요. 회전 뒤에 다시 뜨지 않게 보여 준 뒤 비워요. */
  private void renderError(String message) {
    if (message == null) return;
    Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    model.consumeError();
  }

  private void showState(String message, boolean retry) {
    binding.detailMessage.setText(message);
    binding.detailRetry.setVisibility(retry ? View.VISIBLE : View.GONE);
    binding.detailState.setVisibility(View.VISIBLE);
  }
}
