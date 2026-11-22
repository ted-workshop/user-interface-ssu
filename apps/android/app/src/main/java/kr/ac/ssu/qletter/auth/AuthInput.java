package kr.ac.ssu.qletter.auth;

import java.text.Normalizer;
import java.util.regex.Pattern;

/** 서버와 같은 규칙으로 입력을 먼저 확인해 불필요한 요청을 줄여요. */
public final class AuthInput {
  private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
  private static final int MIN_PASSWORD = 8;
  private static final int MAX_PASSWORD = 128;
  private static final int MIN_NICKNAME = 2;
  private static final int MAX_NICKNAME = 20;

  private AuthInput() {}

  /** 서버처럼 앞뒤 공백을 지우고 ASCII 대문자만 소문자로 바꿔요. */
  public static String email(String raw) {
    String trimmed = raw == null ? "" : raw.trim();
    StringBuilder lower = new StringBuilder(trimmed.length());
    for (int i = 0; i < trimmed.length(); i++) {
      char letter = trimmed.charAt(i);
      lower.append(letter >= 'A' && letter <= 'Z' ? (char) (letter + ('a' - 'A')) : letter);
    }
    return lower.toString();
  }

  public static boolean validEmail(String email) {
    return email != null && email.length() <= 254 && EMAIL.matcher(email).matches();
  }

  /** 서버처럼 NFC로 맞추고 앞뒤 공백을 지워요. */
  public static String nickname(String raw) {
    return Normalizer.normalize(raw == null ? "" : raw, Normalizer.Form.NFC).trim();
  }

  public static boolean validNickname(String nickname) {
    if (nickname == null) return false;
    int length = nickname.codePointCount(0, nickname.length());
    if (length < MIN_NICKNAME || length > MAX_NICKNAME) return false;
    for (int i = 0; i < nickname.length(); ) {
      int codePoint = nickname.codePointAt(i);
      if (Character.getType(codePoint) == Character.CONTROL) return false;
      i += Character.charCount(codePoint);
    }
    return true;
  }

  /** 서버는 8~128 code point를 받고 한 글자만 반복한 비밀번호를 거부해요. */
  public static boolean validPassword(String password) {
    if (password == null) return false;
    int length = password.codePointCount(0, password.length());
    if (length < MIN_PASSWORD || length > MAX_PASSWORD) return false;
    int first = password.codePointAt(0);
    for (int i = 0; i < password.length(); ) {
      int codePoint = password.codePointAt(i);
      if (codePoint != first) return true;
      i += Character.charCount(codePoint);
    }
    return false;
  }
}
