package kr.ac.ssu.qletter.collection;

import android.os.Bundle;
import android.view.View;
import android.widget.Toast;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import java.util.ArrayList;
import java.util.List;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.QletterApplication;
import kr.ac.ssu.qletter.databinding.ActivityCollectionDetailBinding;
import okhttp3.Call;

public class CollectionDetailActivity extends AppCompatActivity {
  public static final String EXTRA_ID = "id";
  public static final String EXTRA_NAME = "name";
  public static final String EXTRA_REPORT_COUNT = "reportCount";

  private ActivityCollectionDetailBinding binding;
  private final List<CollectionReport> reports = new ArrayList<>();
  private CollectionReportAdapter adapter;
  private Call loadCall;
  private CollectionApi collectionApi;
  private ReportCollection collection;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    WindowCompat.enableEdgeToEdge(getWindow());

    binding = ActivityCollectionDetailBinding.inflate(getLayoutInflater());
    setContentView(binding.getRoot());

    collection =
        new ReportCollection(
            getIntent().getStringExtra(EXTRA_NAME),
            getIntent().getIntExtra(EXTRA_REPORT_COUNT, 0),
            getIntent().getStringExtra(EXTRA_ID));
    collectionApi = new CollectionApi(((QletterApplication) getApplication()).api());
    showHeader();

    binding.detailBack.setOnClickListener(v -> finish());
    binding.detailRenameButton.setOnClickListener(
        v ->
            CollectionNameSheet.show(
                this,
                collectionApi,
                collection,
                saved -> {
                  if (isDestroyed()) return;
                  collection = saved;
                  showHeader();
                  // 목록 화면도 바뀐 이름을 다시 불러오게 알려요.
                  setResult(RESULT_OK);
                }));
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

  private void showHeader() {
    binding.detailName.setText(collection.getName());
    binding.detailCount.setText(
        getString(R.string.collection_detail_summary, collection.getReportCount()));
  }

  private void confirmDelete() {
    new AlertDialog.Builder(this)
        .setTitle(R.string.collection_delete_title)
        .setMessage(getString(R.string.collection_delete_message, collection.getName()))
        .setPositiveButton(R.string.collection_delete, (dialog, which) -> deleteCollection())
        .setNegativeButton(R.string.collection_cancel, null)
        .show();
  }

  private void deleteCollection() {
    collectionApi.delete(
        collection.getId(),
        new CollectionApi.Result<Void>() {
          @Override
          public void onSuccess(Void value) {
            runOnUiThread(
                () -> {
                  if (isDestroyed()) return;
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
    binding.detailMessage.setVisibility(View.GONE);

    loadCall =
        collectionApi.reports(
            id,
            new CollectionApi.Result<List<CollectionReport>>() {
              @Override
              public void onSuccess(List<CollectionReport> value) {
                runOnUiThread(
                    () -> {
                      if (isDestroyed()) return;
                      binding.detailLoading.setVisibility(View.GONE);
                      reports.clear();
                      reports.addAll(value);
                      adapter.notifyDataSetChanged();
                      if (reports.isEmpty())
                        showMessage(getString(R.string.collection_detail_empty));
                    });
              }

              @Override
              public void onError(String message) {
                runOnUiThread(
                    () -> {
                      if (isDestroyed()) return;
                      binding.detailLoading.setVisibility(View.GONE);
                      showMessage(message);
                    });
              }
            });
  }

  private void showMessage(String message) {
    binding.detailMessage.setText(message);
    binding.detailMessage.setVisibility(View.VISIBLE);
  }
}
