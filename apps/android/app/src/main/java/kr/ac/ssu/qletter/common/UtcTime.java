package kr.ac.ssu.qletter.common;

import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** 서버가 보내는 UTC RFC 3339 시각을 밀리초로 바꿔요. */
public final class UtcTime {
  private UtcTime() {}

  /** 소수점 초가 없거나 세 자리인 UTC 시각만 받아요. minSdk 24라 java.time 대신 SimpleDateFormat을 써요. */
  public static long parseMillis(String utc) {
    if (utc == null || (utc.length() != 20 && utc.length() != 24))
      throw new IllegalArgumentException("UTC 시각을 확인할 수 없어요.");
    String pattern =
        utc.length() == 20 ? "yyyy-MM-dd'T'HH:mm:ss'Z'" : "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'";
    SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.ROOT);
    format.setTimeZone(TimeZone.getTimeZone("UTC"));
    format.setLenient(false);
    ParsePosition pos = new ParsePosition(0);
    Date parsed = format.parse(utc, pos);
    if (parsed == null || pos.getIndex() != utc.length() || !utc.equals(format.format(parsed)))
      throw new IllegalArgumentException("UTC 시각을 확인할 수 없어요.");
    return parsed.getTime();
  }
}
