package kr.ac.ssu.qletter.summary;

import static org.junit.Assert.*;

import org.junit.Test;

public class SummaryInputTest {
  private static final String CANONICAL = "https://www.youtube.com/watch?v=jNQXAC9IVRw";

  @Test
  public void 영상_주소의_시간과_추적값을_제거해요() {
    assertEquals(CANONICAL, SummaryInput.normalize(" https://youtu.be/jNQXAC9IVRw?t=20 "));
    assertEquals(
        CANONICAL, SummaryInput.normalize("https://www.youtube.com/watch?v=jNQXAC9IVRw&list=123"));
    assertEquals(CANONICAL, SummaryInput.normalize("http://m.youtube.com/watch?v=jNQXAC9IVRw"));
  }

  @Test
  public void 쇼츠와_라이브도_같은_영상으로_정리해요() {
    assertEquals(CANONICAL, SummaryInput.normalize("https://youtube.com/shorts/jNQXAC9IVRw/"));
    assertEquals(CANONICAL, SummaryInput.normalize("https://www.youtube.com/live/jNQXAC9IVRw"));
  }

  @Test
  public void 채널과_재생목록과_여러_주소는_접수하지_않아요() {
    assertNull(SummaryInput.normalize("https://youtube.com/@GoogleDevelopers"));
    assertNull(SummaryInput.normalize("https://youtube.com/playlist?list=123"));
    assertNull(SummaryInput.normalize(CANONICAL + "\n" + CANONICAL));
    assertNull(SummaryInput.normalize("https://you\ntube.com/watch?v=jNQXAC9IVRw"));
    assertNull(SummaryInput.normalize("https://youtu.be/jNQXAC9IVRw/extra"));
  }

  @Test
  public void 다른_호스트와_자격증명과_비표준_포트를_거절해요() {
    assertNull(SummaryInput.normalize("https://youtube.com.example.org/watch?v=jNQXAC9IVRw"));
    assertNull(SummaryInput.normalize("https://someone@youtube.com/watch?v=jNQXAC9IVRw"));
    assertNull(SummaryInput.normalize("https://youtube.com:9443/watch?v=jNQXAC9IVRw"));
    assertNull(SummaryInput.normalize("file://youtube.com/watch?v=jNQXAC9IVRw"));
    assertNull(SummaryInput.normalize("javascript:alert(1)"));
  }

  @Test
  public void 빈_입력과_잘못된_영상_ID를_거절해요() {
    assertNull(SummaryInput.normalize(null));
    assertNull(SummaryInput.normalize(""));
    assertNull(SummaryInput.normalize("https://youtu.be"));
    assertNull(SummaryInput.normalize("https://youtu.be/short"));
    assertNull(SummaryInput.normalize("https://youtube.com/watch?v=abcdefghijkl"));
  }
}
