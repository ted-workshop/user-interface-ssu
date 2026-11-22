package kr.ac.ssu.qletter.auth;

import androidx.annotation.Nullable;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;
import androidx.lifecycle.ViewModel;
import kr.ac.ssu.qletter.common.ApiError;
import kr.ac.ssu.qletter.common.JsonCall;
import okhttp3.Call;

/** 화면 회전 뒤에도 인증 요청과 결과를 잃지 않도록 화면 범위 ViewModel에 보관해요. */
public final class AuthRequestViewModel extends ViewModel {
  public AuthRequestViewModel() {}

  static final class State<T> {
    final boolean loading;
    @Nullable final T value;
    @Nullable final ApiError error;

    private State(boolean loading, @Nullable T value, @Nullable ApiError error) {
      this.loading = loading;
      this.value = value;
      this.error = error;
    }

    static <T> State<T> loading() {
      return new State<>(true, null, null);
    }

    static <T> State<T> success(T value) {
      return new State<>(false, value, null);
    }

    static <T> State<T> failure(ApiError error) {
      return new State<>(false, null, error);
    }
  }

  private interface Starter<T> {
    Call start(JsonCall.Result<T> result);
  }

  private static final class Request<T> {
    final MutableLiveData<State<T>> state = new MutableLiveData<>();
    @Nullable private Call call;
    private int generation;

    void start(Starter<T> starter) {
      if (call != null) call.cancel();
      int current = ++generation;
      state.setValue(State.loading());
      call =
          starter.start(
              new JsonCall.Result<T>() {
                @Override
                public void onSuccess(T value) {
                  if (current == generation) state.postValue(State.success(value));
                }

                @Override
                public void onError(ApiError error) {
                  if (current == generation) state.postValue(State.failure(error));
                }
              });
    }

    void clear() {
      state.setValue(null);
    }

    void cancel() {
      generation++;
      if (call != null) call.cancel();
      call = null;
    }
  }

  private final Request<AuthApi.Login> login = new Request<>();
  private final Request<Void> signup = new Request<>();
  private final Request<Void> verify = new Request<>();
  private final Request<Void> resend = new Request<>();
  private final Request<Void> resetRequest = new Request<>();
  private final Request<Void> resetConfirm = new Request<>();

  LiveData<State<AuthApi.Login>> login() {
    return login.state;
  }

  LiveData<State<Void>> signup() {
    return signup.state;
  }

  LiveData<State<Void>> verify() {
    return verify.state;
  }

  LiveData<State<Void>> resend() {
    return resend.state;
  }

  LiveData<State<Void>> resetRequest() {
    return resetRequest.state;
  }

  LiveData<State<Void>> resetConfirm() {
    return resetConfirm.state;
  }

  void startLogin(AuthApi api, String email, String password) {
    login.start(result -> api.login(email, password, result));
  }

  void startSignup(AuthApi api, String email, String password, String nickname) {
    signup.start(result -> api.register(email, password, nickname, result));
  }

  void startVerify(AuthApi api, String token, String password) {
    verify.start(result -> api.confirmEmail(token, password, result));
  }

  void startResend(AuthApi api, String email) {
    resend.start(result -> api.resendVerification(email, result));
  }

  void startResetRequest(AuthApi api, String email) {
    resetRequest.start(result -> api.requestPasswordReset(email, result));
  }

  void startResetConfirm(AuthApi api, String token, String password) {
    resetConfirm.start(result -> api.confirmPasswordReset(token, password, result));
  }

  void clearLogin() {
    login.clear();
  }

  void clearSignup() {
    signup.clear();
  }

  void clearVerify() {
    verify.clear();
  }

  void clearResend() {
    resend.clear();
  }

  void clearResetRequest() {
    resetRequest.clear();
  }

  void clearResetConfirm() {
    resetConfirm.clear();
  }

  @Override
  protected void onCleared() {
    login.cancel();
    signup.cancel();
    verify.cancel();
    resend.cancel();
    resetRequest.cancel();
    resetConfirm.cancel();
  }
}
