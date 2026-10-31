package kr.ac.ssu.qletter.auth;

public interface AuthApi {
  Session signIn(String email, String password) throws Failure;

  void register(String email, String password, String nickname) throws Failure;

  void requestPasswordReset(String email) throws Failure;

  void requestEmailVerification(String email) throws Failure;

  void cancel();

  final class Session {
    public final String token;
    public final String expiresAt;
    public final String userId;
    public final String email;
    public final String nickname;

    public Session(String token, String expiresAt, String userId, String email, String nickname) {
      this.token = token;
      this.expiresAt = expiresAt;
      this.userId = userId;
      this.email = email;
      this.nickname = nickname;
    }
  }

  enum Error {
    INVALID_INPUT,
    INVALID_CREDENTIALS,
    EMAIL_VERIFICATION_REQUIRED,
    RATE_LIMITED,
    NETWORK,
    UNAVAILABLE,
    INVALID_RESPONSE
  }

  final class Failure extends Exception {
    public final Error error;
    public final long retryAfterSeconds;

    public Failure(Error error) {
      this(error, 0);
    }

    public Failure(Error error, long retryAfterSeconds) {
      super("인증 요청을 완료하지 못했어요.");
      this.error = error;
      this.retryAfterSeconds = Math.max(0, retryAfterSeconds);
    }
  }
}
