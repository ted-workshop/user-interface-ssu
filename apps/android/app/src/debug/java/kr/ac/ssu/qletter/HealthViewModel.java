package kr.ac.ssu.qletter;

import android.os.Handler;
import android.os.Looper;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.ViewModel;
import java.io.IOException;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class HealthViewModel extends ViewModel {
  public enum State {
    IDLE,
    CHECKING,
    CONNECTED,
    FAILED
  }

  public interface HealthCheck {
    void check() throws IOException;
  }

  private final MutableLiveData<State> state = new MutableLiveData<>(State.IDLE);
  private final HealthCheck healthCheck;
  private final ExecutorService worker;
  private final Executor main;
  private boolean cleared;

  public HealthViewModel(HealthCheck check) {
    this(check, Executors.newSingleThreadExecutor(), new Handler(Looper.getMainLooper())::post);
  }

  HealthViewModel(HealthCheck check, ExecutorService worker, Executor main) {
    this.healthCheck = check;
    this.worker = worker;
    this.main = main;
  }

  public LiveData<State> getState() {
    return state;
  }

  public void check() {
    if (cleared || state.getValue() == State.CHECKING) return;
    state.setValue(State.CHECKING);
    worker.execute(
        () -> {
          State result;
          try {
            healthCheck.check();
            result = State.CONNECTED;
          } catch (IOException error) {
            result = State.FAILED;
          }
          final State next = result;
          main.execute(
              () -> {
                if (!cleared) state.setValue(next);
              });
        });
  }

  @Override
  protected void onCleared() {
    cleared = true;
    worker.shutdownNow();
  }
}
