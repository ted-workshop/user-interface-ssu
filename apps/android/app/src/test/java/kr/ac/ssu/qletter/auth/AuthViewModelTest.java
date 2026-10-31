package kr.ac.ssu.qletter.auth;

import static org.junit.Assert.*;

import androidx.arch.core.executor.testing.InstantTaskExecutorRule;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.AbstractExecutorService;
import java.util.concurrent.TimeUnit;
import org.junit.Rule;
import org.junit.Test;

public class AuthViewModelTest {
  @Rule public InstantTaskExecutorRule rule = new InstantTaskExecutorRule();
  private final ManualExecutor worker = new ManualExecutor();
  private final Queue<Runnable> main = new ArrayDeque<>();
  private final FakeApi api = new FakeApi();
  private final AuthViewModel model = new AuthViewModel(api, worker, main::add);
  private static final String PASSWORD = "  비밀번호는 그대로 입력해요  ";

  @Test
  public void 잘못된_입력과_비밀번호_확인은_요청하지_않아요() {
    model.submit("invalid", PASSWORD, "", "");
    assertEquals(AuthViewModel.Field.EMAIL, state().invalidField);
    model.show(AuthViewModel.Page.REGISTER);
    model.submit("reader@example.com", PASSWORD, "가", PASSWORD);
    assertEquals(AuthViewModel.Field.NICKNAME, state().invalidField);
    model.submit("reader@example.com", "short", "읽는사람", "short");
    assertEquals(AuthViewModel.Field.PASSWORD, state().invalidField);
    model.submit("reader@example.com", PASSWORD, "읽는사람", PASSWORD.trim());
    assertEquals(AuthViewModel.Field.CONFIRMATION, state().invalidField);
    assertTrue(worker.tasks.isEmpty());
  }

  @Test
  public void 가입_접수는_로그인과_구분하고_정규화한_이름만_보내요() {
    model.show(AuthViewModel.Page.REGISTER);
    model.submit("  Reader+Tag@Example.COM ", PASSWORD, "  가나다  ", PASSWORD);
    assertEquals(AuthViewModel.Status.SUBMITTING, state().status);
    complete();
    assertEquals(AuthViewModel.Status.EMAIL_CONFIRMATION, state().status);
    assertEquals("reader+tag@example.com", api.email);
    assertEquals(PASSWORD, api.password);
    assertEquals("가나다", api.nickname);
    assertNull(model.takeSession());
  }

  @Test
  public void 중복_제출과_진행_중_화면_변경은_새_요청을_만들지_않아요() {
    model.submit("reader@example.com", PASSWORD, "", "");
    model.submit("reader@example.com", PASSWORD, "", "");
    model.show(AuthViewModel.Page.REGISTER);
    assertEquals(AuthViewModel.Page.LOGIN, state().page);
    complete();
    assertEquals(1, api.calls);
    assertTrue(worker.tasks.isEmpty());
    assertNotNull(model.takeSession());
    assertNull(model.takeSession());
  }

  @Test
  public void 실패_이유를_유지하고_사용자의_재시도로_성공해요() {
    api.failure = AuthApi.Error.INVALID_CREDENTIALS;
    model.submit("reader@example.com", PASSWORD, "", "");
    complete();
    assertEquals(AuthApi.Error.INVALID_CREDENTIALS, state().error);
    assertEquals(AuthViewModel.Status.FAILED, state().status);
    assertTrue(worker.tasks.isEmpty());
    api.failure = null;
    model.submit("reader@example.com", PASSWORD, "", "");
    complete();
    assertEquals(AuthViewModel.Status.AUTHENTICATED, state().status);
    assertNotNull(model.takeSession());
  }

  @Test
  public void 이메일_확인_재발송은_명시적으로_누를_때만_접수해요() {
    api.failure = AuthApi.Error.EMAIL_VERIFICATION_REQUIRED;
    model.submit("Reader@Example.com", PASSWORD, "", "");
    complete();
    assertEquals(1, api.calls);
    api.failure = null;
    model.resendVerification();
    complete();
    assertEquals("verify", api.operation);
    assertEquals("reader@example.com", api.email);
    assertEquals(AuthViewModel.Status.EMAIL_CONFIRMATION, state().status);
    assertNull(model.takeSession());
  }

  @Test
  public void 확인_메일_재요청이_실패해도_가입을_반복하지_않고_다시_요청해요() {
    model.show(AuthViewModel.Page.REGISTER);
    model.submit("reader@example.com", PASSWORD, "읽는사람", PASSWORD);
    complete();
    api.failure = AuthApi.Error.NETWORK;
    model.resendVerification();
    assertTrue(state().isAccepted());
    assertTrue(state().isBusy());
    model.resendVerification();
    assertEquals(1, worker.tasks.size());
    complete();
    assertTrue(state().isAccepted());
    assertEquals(AuthApi.Error.NETWORK, state().error);
    api.failure = null;
    model.resendVerification();
    complete();
    assertEquals("verify", api.operation);
    assertEquals(3, api.calls);
    assertEquals(AuthViewModel.Status.EMAIL_CONFIRMATION, state().status);
    assertNull(model.takeSession());
  }

  @Test
  public void 비밀번호_복구는_비밀번호_입력_없이_접수만_표시해요() {
    model.show(AuthViewModel.Page.RESET);
    model.submit("Reader@Example.com", "", "", "");
    complete();
    assertEquals("reset", api.operation);
    assertEquals(AuthViewModel.Status.RESET_ACCEPTED, state().status);
    assertNull(model.takeSession());
  }

  @Test
  public void 해제된_화면에_늦은_세션을_전달하지_않아요() {
    model.submit("reader@example.com", PASSWORD, "", "");
    worker.tasks.remove().run();
    model.onCleared();
    main.remove().run();
    assertTrue(api.cancelled);
    assertTrue(worker.isShutdown());
    assertNull(model.takeSession());
    assertEquals(AuthViewModel.Status.SUBMITTING, state().status);
  }

  @Test
  public void 화면을_먼저_닫으면_대기_중인_요청을_실행하지_않아요() {
    model.submit("reader@example.com", PASSWORD, "", "");
    model.onCleared();
    assertTrue(worker.tasks.isEmpty());
    assertEquals(0, api.calls);
  }

  private AuthViewModel.State state() {
    return model.getState().getValue();
  }

  private void complete() {
    worker.tasks.remove().run();
    main.remove().run();
  }

  private static final class FakeApi implements AuthApi {
    int calls;
    String operation;
    String email;
    String password;
    String nickname;
    Error failure;
    boolean cancelled;

    private void call(String operation, String email) throws Failure {
      this.operation = operation;
      this.email = email;
      calls++;
      if (failure != null) throw new Failure(failure);
    }

    public Session signIn(String email, String password) throws Failure {
      call("login", email);
      this.password = password;
      return new Session("a".repeat(43), "2026-11-30T00:00:00Z", "fixture-user", email, "읽는사람");
    }

    public void register(String email, String password, String nickname) throws Failure {
      call("register", email);
      this.password = password;
      this.nickname = nickname;
    }

    public void requestPasswordReset(String email) throws Failure {
      call("reset", email);
    }

    public void requestEmailVerification(String email) throws Failure {
      call("verify", email);
    }

    public void cancel() {
      cancelled = true;
    }
  }

  private static final class ManualExecutor extends AbstractExecutorService {
    final Queue<Runnable> tasks = new ArrayDeque<>();
    boolean shutdown;

    public void execute(Runnable task) {
      tasks.add(task);
    }

    public void shutdown() {
      shutdown = true;
    }

    public List<Runnable> shutdownNow() {
      shutdown();
      List<Runnable> result = new ArrayList<>(tasks);
      tasks.clear();
      return result;
    }

    public boolean isShutdown() {
      return shutdown;
    }

    public boolean isTerminated() {
      return shutdown && tasks.isEmpty();
    }

    public boolean awaitTermination(long timeout, TimeUnit unit) {
      return isTerminated();
    }
  }
}
