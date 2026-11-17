package kr.ac.ssu.qletter;

import static org.junit.Assert.*;

import org.junit.Test;

public class SessionTest {
  @Test
  public void 문서와_서버의_UTC_만료_시각을_모두_읽어요() {
    assertEquals(0L, Session.expiryMillis("1970-01-01T00:00:00Z"));
    assertEquals(123L, Session.expiryMillis("1970-01-01T00:00:00.123Z"));
  }

  @Test
  public void 잘못된_날짜나_시간대는_거절해요() {
    assertThrows(
        IllegalArgumentException.class, () -> Session.expiryMillis("2026-02-31T12:00:00Z"));
    assertThrows(IllegalArgumentException.class, () -> Session.expiryMillis("2026-11-07T12:00:00"));
    assertThrows(
        IllegalArgumentException.class, () -> Session.expiryMillis("2026-11-07T12:00:00X"));
  }
}
