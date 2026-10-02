package kr.ac.ssu.qletter;

import static org.junit.Assert.*;

import androidx.arch.core.executor.testing.InstantTaskExecutorRule;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.AbstractExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Rule;
import org.junit.Test;

public class HealthViewModelTest {
  @Rule public InstantTaskExecutorRule rule = new InstantTaskExecutorRule();
  private final ManualExecutor worker = new ManualExecutor();
  private final Queue<Runnable> main = new ArrayDeque<>();

  @Test
  public void failedConnectionCanBeRetriedSuccessfully() {
    AtomicBoolean fail = new AtomicBoolean(true);
    HealthViewModel model =
        new HealthViewModel(
            () -> {
              if (fail.get()) throw new IOException("offline");
            },
            worker,
            main::add);
    assertEquals(HealthViewModel.State.IDLE, model.getState().getValue());
    model.check();
    assertEquals(HealthViewModel.State.CHECKING, model.getState().getValue());
    worker.runNext();
    main.remove().run();
    assertEquals(HealthViewModel.State.FAILED, model.getState().getValue());
    fail.set(false);
    model.check();
    worker.runNext();
    main.remove().run();
    assertEquals(HealthViewModel.State.CONNECTED, model.getState().getValue());
  }

  @Test
  public void repeatedTapDoesNotStartConcurrentRequests() {
    AtomicInteger calls = new AtomicInteger();
    HealthViewModel model = new HealthViewModel(calls::incrementAndGet, worker, main::add);
    model.check();
    model.check();
    assertEquals(HealthViewModel.State.CHECKING, model.getState().getValue());
    worker.runNext();
    assertEquals(1, calls.get());
    assertTrue(worker.tasks.isEmpty());
    main.remove().run();
    assertEquals(HealthViewModel.State.CONNECTED, model.getState().getValue());
  }

  @Test
  public void clearedModelDoesNotPublishLateResults() {
    HealthViewModel model = new HealthViewModel(() -> {}, worker, main::add);
    model.check();
    assertEquals(HealthViewModel.State.CHECKING, model.getState().getValue());
    worker.runNext();
    model.onCleared();
    main.remove().run();
    assertEquals(HealthViewModel.State.CHECKING, model.getState().getValue());
    assertTrue(worker.isShutdown());
  }

  private static final class ManualExecutor extends AbstractExecutorService {
    final Queue<Runnable> tasks = new ArrayDeque<>();
    private boolean shutdown;

    void runNext() {
      tasks.remove().run();
    }

    @Override
    public void execute(Runnable task) {
      tasks.add(task);
    }

    @Override
    public void shutdown() {
      shutdown = true;
    }

    @Override
    public List<Runnable> shutdownNow() {
      shutdown();
      List<Runnable> pending = new ArrayList<>(tasks);
      tasks.clear();
      return pending;
    }

    @Override
    public boolean isShutdown() {
      return shutdown;
    }

    @Override
    public boolean isTerminated() {
      return shutdown && tasks.isEmpty();
    }

    @Override
    public boolean awaitTermination(long timeout, TimeUnit unit) {
      return isTerminated();
    }
  }
}
