package kr.ac.ssu.qletter.report;

import okhttp3.HttpUrl;

/** 문서의 링크가 앱 명령·파일·스크립트로 실행되지 않게 웹 주소만 열어요. */
final class ReportLinks {
  static String web(String value) {
    HttpUrl url = value == null ? null : HttpUrl.parse(value);
    if (url == null || !url.isHttps() || !url.username().isEmpty() || !url.password().isEmpty())
      return null;
    return url.toString();
  }

  static String video(String id) {
    return id != null && id.matches("[A-Za-z0-9_-]{11}")
        ? "https://www.youtube.com/watch?v=" + id
        : null;
  }

  private ReportLinks() {}
}
