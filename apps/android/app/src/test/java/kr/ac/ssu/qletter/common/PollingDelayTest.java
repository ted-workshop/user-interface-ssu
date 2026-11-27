package kr.ac.ssu.qletter.common;

import static org.junit.Assert.*;

import org.junit.Test;

public class PollingDelayTest {
  @Test
  public void 정상_조회는_5초이고_연속_실패만_30초까지_늦춰요() {
    assertEquals(5000, PollingDelay.millis(0, 0, 400));
    assertEquals(5100, PollingDelay.millis(1, 0, 100));
    assertEquals(10100, PollingDelay.millis(2, 0, 100));
    assertEquals(20100, PollingDelay.millis(3, 0, 100));
    assertEquals(30100, PollingDelay.millis(40, 0, 100));
  }

  @Test
  public void 서버가_정한_대기_시간보다_먼저_조회하지_않아요() {
    assertEquals(90000, PollingDelay.millis(1, 90, 300));
    assertEquals(30500, PollingDelay.millis(4, 1, 500));
    assertEquals(86400000, PollingDelay.millis(0, 86400, 0));
  }

  @Test
  public void 잘못된_간격이나_큰_헤더가_즉시_반복을_만들지_않아요() {
    assertEquals(5000, PollingDelay.millis(1, -1, -200));
    assertEquals(5500, PollingDelay.millis(1, 0, 5000));
    assertTrue(PollingDelay.millis(1, Long.MAX_VALUE, 0) > 0);
    assertEquals(Long.MAX_VALUE, PollingDelay.deadline(100000, Long.MAX_VALUE));
    assertEquals(105000, PollingDelay.deadline(100000, 5000));
  }
}
