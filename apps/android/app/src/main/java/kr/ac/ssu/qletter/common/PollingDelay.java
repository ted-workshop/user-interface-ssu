package kr.ac.ssu.qletter.common;

/** 조회 실패만 늦춰요. 이 계산은 새 요약이나 채널 확인을 접수하지 않아요. */
public final class PollingDelay {
  private PollingDelay() {}

  public static long millis(int failures, long retryAfterSeconds, long jitterMillis) {
    long backoff = failures <= 1 ? 5000 : failures == 2 ? 10000 : failures == 3 ? 20000 : 30000;
    long jitter = failures == 0 ? 0 : Math.max(0, Math.min(500, jitterMillis));
    long retry = Math.max(0, Math.min(Long.MAX_VALUE / 1000, retryAfterSeconds)) * 1000;
    return Math.max(backoff + jitter, retry);
  }

  public static long deadline(long now, long delayMillis) {
    return now + Math.min(Long.MAX_VALUE - now, Math.max(0, delayMillis));
  }
}
