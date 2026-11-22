package kr.ac.ssu.qletter.channel;

/** 등록한 YouTube 채널 구독이에요. 중지해도 리포트는 남고 자동 확인만 멈춰요. */
public final class Channel {
  private final String id;
  private final String youtubeChannelId;
  private final String title;
  private final String url;
  private final boolean active;
  private final Long lastCheckedAt;

  Channel(
      String id,
      String youtubeChannelId,
      String title,
      String url,
      boolean active,
      Long lastCheckedAt) {
    this.id = id;
    this.youtubeChannelId = youtubeChannelId;
    this.title = title;
    this.url = url;
    this.active = active;
    this.lastCheckedAt = lastCheckedAt;
  }

  public String id() {
    return id;
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

  public boolean active() {
    return active;
  }

  public Long lastCheckedAt() {
    return lastCheckedAt;
  }

  /** 목록에서 긴 주소 대신 youtube.com 뒤의 경로만 보여요. */
  public String shortUrl() {
    if (url == null || url.isEmpty()) return "";
    return url.replaceFirst("^https?://(www\\.)?youtube\\.com", "");
  }
}
