package kr.ac.ssu.qletter.common;

final class Session {
  final String token;
  final long expiresAt;

  Session(String token, long expiresAt) {
    this.token = token;
    this.expiresAt = expiresAt;
  }

  static long expiryMillis(String utc) {
    try {
      return UtcTime.parseMillis(utc);
    } catch (IllegalArgumentException error) {
      throw new IllegalArgumentException("세션 만료 시각을 확인할 수 없어요.", error);
    }
  }
}
