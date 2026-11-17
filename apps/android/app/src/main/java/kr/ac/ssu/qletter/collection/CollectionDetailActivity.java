package kr.ac.ssu.qletter.collection;

import android.os.Bundle;
import android.view.View;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import java.util.ArrayList;
import java.util.List;
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

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    WindowCompat.enableEdgeToEdge(getWindow());

    binding = ActivityCollectionDetailBinding.inflate(getLayoutInflater());
    setContentView(binding.getRoot());

    int reportCount = getIntent().getIntExtra(EXTRA_REPORT_COUNT, 0);
    binding.detailName.setText(getIntent().getStringExtra(EXTRA_NAME));
    binding.detailCount.setText("리포트 " + reportCount + "개");

    adapter = new CollectionReportAdapter(reports);
    binding.detailReportsList.setLayoutManager(new LinearLayoutManager(this));
    binding.detailReportsList.setAdapter(adapter);

    ViewCompat.setOnApplyWindowInsetsListener(
        binding.getRoot(),
        (v, insets) -> {
          Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
          v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom);
          return insets;
        });

    loadReports(getIntent().getStringExtra(EXTRA_ID));
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

    QletterApplication app = (QletterApplication) getApplication();
    loadCall =
        new CollectionApi(app.api())
            .reports(
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
                          if (reports.isEmpty()) showMessage("아직 담긴 리포트가 없어요");
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
