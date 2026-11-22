package kr.ac.ssu.qletter.account;

import android.content.res.Resources;
import kr.ac.ssu.qletter.R;
import kr.ac.ssu.qletter.common.ApiError;

/** 계정 API의 오류 코드를 화면 문장으로 바꿔요. */
final class AccountErrors {
  private AccountErrors() {}

  static String message(Resources resources, ApiError error, String fallback) {
    if (error.isNetwork()) return resources.getString(R.string.account_error_network);
    if (error.isUnauthorized()) return resources.getString(R.string.account_error_sign_in);
    switch (error.code()) {
      case ApiError.INVALID_RESPONSE:
        return resources.getString(R.string.account_error_response);
      case "RECIPIENT_EXISTS":
        return resources.getString(R.string.account_error_exists);
      case "NOT_FOUND":
        return resources.getString(R.string.account_error_not_found);
      case "RATE_LIMITED":
        return error.retryAfterSeconds() > 0
            ? resources.getString(
                R.string.account_error_rate_limited_after, error.retryAfterSeconds())
            : resources.getString(R.string.account_error_rate_limited);
      case "SERVICE_UNAVAILABLE":
        return resources.getString(R.string.account_error_mail);
      default:
        return error.status() >= 500
            ? resources.getString(R.string.account_error_server)
            : fallback;
    }
  }
}
