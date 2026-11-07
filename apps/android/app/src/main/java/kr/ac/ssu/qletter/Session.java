package kr.ac.ssu.qletter;

import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

final class Session {
  final String token;
  final long expiresAt;

  Session(String token, long expiresAt) {
    this.token = token;
    this.expiresAt = expiresAt;
  }

  static long expiryMillis(String utc) {
    if (utc == null || (utc.length() != 20 && utc.length() != 24))
      throw new IllegalArgumentException("세션 만료 시각을 확인할 수 없어요.");
    String pattern =
        utc.length() == 20 ? "yyyy-MM-dd'T'HH:mm:ss'Z'" : "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'";
    SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.ROOT);
    format.setTimeZone(TimeZone.getTimeZone("UTC"));
    format.setLenient(false);
    ParsePosition pos = new ParsePosition(0);
    Date parsed = format.parse(utc, pos);
    if (parsed == null || pos.getIndex() != utc.length() || !utc.equals(format.format(parsed)))
      throw new IllegalArgumentException("세션 만료 시각을 확인할 수 없어요.");
    return parsed.getTime();
  }
}
