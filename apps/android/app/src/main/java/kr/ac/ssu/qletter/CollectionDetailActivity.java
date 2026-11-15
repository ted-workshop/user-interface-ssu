package kr.ac.ssu.qletter;

import android.os.Bundle;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import java.util.ArrayList;
import java.util.List;
import kr.ac.ssu.qletter.databinding.ActivityCollectionDetailBinding;

public class CollectionDetailActivity extends AppCompatActivity {
  public static final String EXTRA_NAME = "name";
  public static final String EXTRA_REPORT_COUNT = "reportCount";

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    WindowCompat.enableEdgeToEdge(getWindow());

    ActivityCollectionDetailBinding binding =
        ActivityCollectionDetailBinding.inflate(getLayoutInflater());
    setContentView(binding.getRoot());

    int reportCount = getIntent().getIntExtra(EXTRA_REPORT_COUNT, 0);
    binding.detailName.setText(getIntent().getStringExtra(EXTRA_NAME));
    binding.detailCount.setText("리포트 " + reportCount + "개");

    // 서버 연결 전까지 쓰는 더미 데이터예요.
    List<CollectionReport> reports = new ArrayList<>();
    for (int i = 0; i < reportCount; i++) {
      reports.add(new CollectionReport("제목" + (i + 1), "채널" + (i + 1)));
    }
    binding.detailReportsList.setLayoutManager(new LinearLayoutManager(this));
    binding.detailReportsList.setAdapter(new CollectionReportAdapter(reports));

    ViewCompat.setOnApplyWindowInsetsListener(
        binding.getRoot(),
        (v, insets) -> {
          Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
          v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom);
          return insets;
        });
  }
}
