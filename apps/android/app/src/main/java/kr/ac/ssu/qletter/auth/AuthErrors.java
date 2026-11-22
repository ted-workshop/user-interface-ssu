package kr.ac.ssu.qletter.auth;

import android.content.res.Resources;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.ApiError;

/** 인증 요청의 오류 코드를 화면 문장으로 바꿔요. 서버 본문은 그대로 보여 주지 않아요. */
final class AuthErrors {
  private AuthErrors() {}

  static String message(Resources resources, ApiError error, String fallback) {
    if (error.isNetwork()) return resources.getString(R.string.auth_error_network);
    // 로그인 401은 입력 오류, 그 밖의 401은 세션 만료예요.
    if (error.is("INVALID_CREDENTIALS"))
      return resources.getString(R.string.auth_error_credentials);
    if (error.isUnauthorized()) return resources.getString(R.string.auth_error_sign_in);
    switch (error.code()) {
      case ApiError.INVALID_RESPONSE:
        return resources.getString(R.string.auth_error_response);
      case "INVALID_TOKEN":
        return resources.getString(R.string.auth_error_token);
      case "EMAIL_VERIFICATION_REQUIRED":
        return resources.getString(R.string.auth_error_verify_needed);
      case "RATE_LIMITED":
        return error.retryAfterSeconds() > 0
            ? resources.getString(R.string.auth_error_rate_limited_after, error.retryAfterSeconds())
            : resources.getString(R.string.auth_error_rate_limited);
      case "SERVICE_UNAVAILABLE":
        return resources.getString(R.string.auth_error_unavailable);
      default:
        return error.status() >= 500 ? resources.getString(R.string.auth_error_server) : fallback;
    }
  }
}
