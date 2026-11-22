package kr.ac.ssu.qletter.channel;

/** 채널 확인 API가 돌려준 공식 채널 정보예요. 등록에는 ID만 다시 보내요. */
public final class ChannelPreview {
  private final String youtubeChannelId;
  private final String title;
  private final String url;

  ChannelPreview(String youtubeChannelId, String title, String url) {
    this.youtubeChannelId = youtubeChannelId;
    this.title = title;
    this.url = url;
  }

  public String youtubeChannelId() {
    return youtubeChannelId;
  }

  public String title() {
    return title;
  }

  public String url() {
    return url;
  }

  public String shortUrl() {
    return url == null ? "" : url.replaceFirst("^https?://(www\\.)?youtube\\.com", "");
  }
}
