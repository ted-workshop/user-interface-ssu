package kr.ac.ssu.qletter.summary;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import okhttp3.HttpUrl;

/** 서버와 같은 영상 URL 형식만 받아 시간 링크도 영상 전체 주소로 정리해요. */
final class SummaryInput {
  private SummaryInput() {}

  static String normalize(String input) {
    if (input == null) return null;
    String value = input.trim();
    if (value.isEmpty() || value.length() > 2048 || value.matches("(?s).*\\s.*")) return null;
    try {
      URI raw = new URI(value);
      HttpUrl url = HttpUrl.parse(value);
      if (url == null || raw.getRawUserInfo() != null || raw.getHost() == null) return null;
      if (url.port() != (url.isHttps() ? 443 : 80)) return null;
      String host = raw.getHost().toLowerCase(Locale.ROOT);
      String path = raw.getRawPath();
      String id;
      if (host.equals("youtu.be")) id = path.substring(1);
      else if (host.equals("youtube.com")
          || host.equals("www.youtube.com")
          || host.equals("m.youtube.com")) {
        if (path.equals("/watch")) id = url.queryParameter("v");
        else if (path.matches("/(shorts|live)/[A-Za-z0-9_-]{11}/?")) id = path.split("/")[2];
        else return null;
      } else return null;
      return id != null && id.matches("[A-Za-z0-9_-]{11}")
          ? "https://www.youtube.com/watch?v=" + id
          : null;
    } catch (URISyntaxException | IndexOutOfBoundsException error) {
      return null;
    }
  }
}
