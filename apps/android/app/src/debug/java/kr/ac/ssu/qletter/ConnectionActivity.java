package kr.ac.ssu.qletter;

import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;
import androidx.activity.EdgeToEdge;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.lifecycle.ViewModel;
import androidx.lifecycle.ViewModelProvider;

public final class ConnectionActivity extends AppCompatActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    EdgeToEdge.enable(this);
    setContentView(R.layout.activity_connection);
    ViewCompat.setOnApplyWindowInsetsListener(
        findViewById(R.id.connection_root),
        (view, insets) -> {
          Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
          view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
          return insets;
        });
    HealthViewModel model =
        new ViewModelProvider(
                this,
                new ViewModelProvider.Factory() {
                  @NonNull
                  @Override
                  public <T extends ViewModel> T create(@NonNull Class<T> modelClass) {
                    if (modelClass != HealthViewModel.class)
                      throw new IllegalArgumentException("Unknown view model");
                    HealthClient client = new HealthClient(BuildConfig.API_BASE_URL);
                    return modelClass.cast(new HealthViewModel(client::check));
                  }
                })
            .get(HealthViewModel.class);
    TextView status = findViewById(R.id.connection_status);
    Button button = findViewById(R.id.connection_button);
    View progress = findViewById(R.id.connection_progress);
    button.setOnClickListener(view -> model.check());
    model
        .getState()
        .observe(
            this,
            state -> {
              int message;
              switch (state) {
                case CHECKING:
                  message = R.string.connection_checking;
                  break;
                case CONNECTED:
                  message = R.string.connection_success;
                  break;
                case FAILED:
                  message = R.string.connection_failure;
                  break;
                default:
                  message = R.string.connection_idle;
              }
              status.setText(message);
              button.setEnabled(state != HealthViewModel.State.CHECKING);
              button.setText(
                  state == HealthViewModel.State.FAILED
                      ? R.string.connection_retry
                      : R.string.connection_check);
              progress.setVisibility(
                  state == HealthViewModel.State.CHECKING ? View.VISIBLE : View.GONE);
            });
  }
}
