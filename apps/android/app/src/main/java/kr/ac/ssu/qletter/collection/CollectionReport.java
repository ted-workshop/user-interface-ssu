package kr.ac.ssu.qletter.collection;

/** 모음 상세 목록 한 줄에 보여 줄 리포트 정보예요. */
public class CollectionReport {
  private final String title;
  private final String channelName;
  private final long createdAtMillis;
  private final boolean channelOrigin;
  private final boolean deliveryFailed;

  public CollectionReport(
      String title,
      String channelName,
      long createdAtMillis,
      boolean channelOrigin,
      boolean deliveryFailed) {
    this.title = title;
    this.channelName = channelName;
    this.createdAtMillis = createdAtMillis;
    this.channelOrigin = channelOrigin;
    this.deliveryFailed = deliveryFailed;
  }

  public String getTitle() {
    return title;
  }

  public String getChannelName() {
    return channelName;
  }

  public long getCreatedAtMillis() {
    return createdAtMillis;
  }

  public boolean isChannelOrigin() {
    return channelOrigin;
  }

  public boolean isDeliveryFailed() {
    return deliveryFailed;
  }
}
