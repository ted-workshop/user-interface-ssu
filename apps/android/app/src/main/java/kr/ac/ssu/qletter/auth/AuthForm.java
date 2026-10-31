package kr.ac.ssu.qletter.auth;

import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;

public final class AuthForm {
  // 공백 없는 ASCII 주소의 기본 형태를 검사하고 최종 주소 검증은 서버에 맡겨요.
  private static final Pattern EMAIL =
      Pattern.compile(
          "[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\\.[A-Za-z]{2,}");

  private AuthForm() {}

  public static String email(String value) {
    return value.trim().toLowerCase(Locale.ROOT);
  }

  public static String nickname(String value) {
    return Normalizer.normalize(value.trim(), Normalizer.Form.NFC);
  }

  public static boolean validEmail(String value) {
    String normalized = email(value);
    return value.trim().chars().allMatch(code -> code < 128)
        && normalized.length() <= 254
        && EMAIL.matcher(normalized).matches();
  }

  public static boolean validNickname(String value) {
    String normalized = nickname(value);
    int length = normalized.codePointCount(0, normalized.length());
    return length >= 2
        && length <= 20
        && normalized
            .codePoints()
            .noneMatch(code -> Character.isISOControl(code) || code == 0x2028 || code == 0x2029);
  }

  public static boolean validPassword(String value) {
    int length = value.codePointCount(0, value.length());
    return length >= 15 && length <= 128;
  }
}
