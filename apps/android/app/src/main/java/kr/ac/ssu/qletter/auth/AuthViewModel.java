package kr.ac.ssu.qletter.auth;

import android.os.Handler;
import android.os.Looper;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.ViewModel;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class AuthViewModel extends ViewModel {
  public enum Page {
    LOGIN,
    REGISTER,
    RESET,
    VERIFY_EMAIL
  }

  public enum Status {
    IDLE,
    SUBMITTING,
    FAILED,
    EMAIL_CONFIRMATION,
    RESET_ACCEPTED,
    AUTHENTICATED
  }

  public enum Field {
    EMAIL,
    NICKNAME,
    PASSWORD,
    CONFIRMATION
  }

  public static final class State {
    public final Page page;
    public final Status status;
    public final String email;
    public final Field invalidField;
    public final AuthApi.Error error;
    public final long retryAfterSeconds;

    private State(
        Page page,
        Status status,
        String email,
        Field invalidField,
        AuthApi.Error error,
        long retryAfterSeconds) {
      this.page = page;
      this.status = status;
      this.email = email;
      this.invalidField = invalidField;
      this.error = error;
      this.retryAfterSeconds = retryAfterSeconds;
    }

    public boolean isBusy() {
      return status == Status.SUBMITTING;
    }

    public boolean isAccepted() {
      return page == Page.VERIFY_EMAIL || status == Status.RESET_ACCEPTED;
    }
  }

  private enum Operation {
    LOGIN,
    REGISTER,
    RESET,
    VERIFY_EMAIL
  }

  private final AuthApi api;
  private final ExecutorService worker;
  private final Executor main;
  private final MutableLiveData<State> state =
      new MutableLiveData<>(new State(Page.LOGIN, Status.IDLE, "", null, null, 0));
  private AuthApi.Session session;
  private volatile boolean cleared;

  public AuthViewModel(AuthApi api) {
    this(api, Executors.newSingleThreadExecutor(), new Handler(Looper.getMainLooper())::post);
  }

  AuthViewModel(AuthApi api, ExecutorService worker, Executor main) {
    this.api = api;
    this.worker = worker;
    this.main = main;
  }

  public LiveData<State> getState() {
    return state;
  }

  public void show(Page page) {
    State current = state.getValue();
    if (cleared || current.isBusy()) return;
    session = null;
    state.setValue(new State(page, Status.IDLE, current.email, null, null, 0));
  }

  public void submit(String email, String password, String nickname, String confirmation) {
    State current = state.getValue();
    if (cleared || current.isBusy() || current.isAccepted()) return;
    Field invalid = null;
    if (!AuthForm.validEmail(email)) invalid = Field.EMAIL;
    else if (current.page == Page.REGISTER && !AuthForm.validNickname(nickname))
      invalid = Field.NICKNAME;
    else if (current.page != Page.RESET && !AuthForm.validPassword(password))
      invalid = Field.PASSWORD;
    else if (current.page == Page.REGISTER && !password.equals(confirmation))
      invalid = Field.CONFIRMATION;
    String normalizedEmail = AuthForm.email(email);
    if (invalid != null) {
      state.setValue(new State(current.page, Status.FAILED, normalizedEmail, invalid, null, 0));
      return;
    }
    Operation operation =
        current.page == Page.LOGIN
            ? Operation.LOGIN
            : current.page == Page.REGISTER ? Operation.REGISTER : Operation.RESET;
    request(operation, normalizedEmail, password, AuthForm.nickname(nickname));
  }

  public void resendVerification() {
    State current = state.getValue();
    if (cleared
        || current.isBusy()
        || !(current.page == Page.VERIFY_EMAIL
            || current.error == AuthApi.Error.EMAIL_VERIFICATION_REQUIRED)) return;
    request(Operation.VERIFY_EMAIL, current.email, "", "");
  }

  public AuthApi.Session takeSession() {
    AuthApi.Session result = session;
    session = null;
    if (result != null) {
      State current = state.getValue();
      state.setValue(new State(Page.LOGIN, Status.IDLE, current.email, null, null, 0));
    }
    return result;
  }

  private void request(Operation operation, String email, String password, String nickname) {
    Page page = operation == Operation.VERIFY_EMAIL ? Page.VERIFY_EMAIL : state.getValue().page;
    state.setValue(new State(page, Status.SUBMITTING, email, null, null, 0));
    worker.execute(
        () -> {
          if (cleared) return;
          AuthApi.Session authenticated = null;
          Status status;
          AuthApi.Error error = null;
          long retryAfterSeconds = 0;
          try {
            switch (operation) {
              case LOGIN:
                authenticated = api.signIn(email, password);
                if (authenticated == null)
                  throw new AuthApi.Failure(AuthApi.Error.INVALID_RESPONSE);
                status = Status.AUTHENTICATED;
                break;
              case REGISTER:
                api.register(email, password, nickname);
                status = Status.EMAIL_CONFIRMATION;
                break;
              case VERIFY_EMAIL:
                api.requestEmailVerification(email);
                status = Status.EMAIL_CONFIRMATION;
                break;
              default:
                api.requestPasswordReset(email);
                status = Status.RESET_ACCEPTED;
            }
          } catch (AuthApi.Failure failure) {
            status = Status.FAILED;
            error = failure.error;
            retryAfterSeconds = failure.retryAfterSeconds;
          } catch (RuntimeException failure) {
            status = Status.FAILED;
            error = AuthApi.Error.UNAVAILABLE;
          }
          Page nextPage = status == Status.EMAIL_CONFIRMATION ? Page.VERIFY_EMAIL : page;
          State next = new State(nextPage, status, email, null, error, retryAfterSeconds);
          AuthApi.Session completed = authenticated;
          main.execute(
              () -> {
                if (cleared) return;
                session = completed;
                state.setValue(next);
              });
        });
  }

  @Override
  protected void onCleared() {
    cleared = true;
    session = null;
    api.cancel();
    worker.shutdownNow();
  }
}
