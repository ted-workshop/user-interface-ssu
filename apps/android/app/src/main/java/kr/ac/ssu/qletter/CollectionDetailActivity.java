package kr.ac.ssu.qletter;

import android.os.Bundle;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
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
    binding.detailName.setText(getIntent().getStringExtra(EXTRA_NAME));
    binding.detailCount.setText("리포트 " + getIntent().getIntExtra(EXTRA_REPORT_COUNT, 0) + "개");
    ViewCompat.setOnApplyWindowInsetsListener(
        binding.getRoot(),
        (v, insets) -> {
          Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
          v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom);
          return insets;
        });
  }
}
