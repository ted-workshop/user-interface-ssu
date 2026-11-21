package kr.ac.ssu.qletter.report;

import static org.junit.Assert.*;

import okhttp3.HttpUrl;
import org.junit.Test;

public class ReportQueryTest {
  @Test
  public void 다음_페이지에도_검색과_모든_필터를_유지해요() {
    ReportQuery query =
        new ReportQuery("  제목 %_&한글  ", "channel", "failed", "https://www.youtube.com/@채널?x=1&y=2");
    HttpUrl url = query.url(HttpUrl.get("https://example.com/v1/reports").newBuilder(), "a+/=");
    assertEquals("제목 %_&한글", url.queryParameter("q"));
    assertEquals("channel", url.queryParameter("origin"));
    assertEquals("failed", url.queryParameter("deliveryStatus"));
    assertEquals(query.channel, url.queryParameter("channelUrl"));
    assertEquals("a+/=", url.queryParameter("cursor"));
    assertEquals("20", url.queryParameter("limit"));
    assertEquals(6, url.querySize());
  }

  @Test
  public void 빈_검색어와_전체_조건은_서버에_보내지_않아요() {
    ReportQuery query = new ReportQuery("  ", "", "", "");
    HttpUrl url = query.url(HttpUrl.get("https://example.com/v1/reports").newBuilder(), null);
    assertFalse(query.filtered());
    assertEquals(1, url.querySize());
    assertNull(url.queryParameter("q"));
    assertNull(url.queryParameter("cursor"));
    assertTrue(new ReportQuery("", "", "", "channel").filtered());
  }

  @Test
  public void 본문의_스크립트와_파일_앱명령_자격증명_링크를_열지_않아요() {
    for (String link :
        new String[] {
          "javascript:alert(1)",
          "data:text/html,x",
          "file:///tmp/x",
          "intent://x",
          "http://example.com/",
          "https://user:pass@example.com/",
          "//example.com",
          ""
        }) assertNull(link, ReportLinks.web(link));
    assertNull(ReportLinks.web(null));
    assertEquals(
        "https://www.youtube.com/watch?v=jNQXAC9IVRw&t=30",
        ReportLinks.web("https://www.youtube.com/watch?v=jNQXAC9IVRw&t=30"));
  }

  @Test
  public void 원본은_검증한_영상_ID로만_열어요() {
    assertEquals("https://www.youtube.com/watch?v=jNQXAC9IVRw", ReportLinks.video("jNQXAC9IVRw"));
    assertNull(ReportLinks.video("other/path?"));
    assertNull(ReportLinks.video(null));
  }
}
