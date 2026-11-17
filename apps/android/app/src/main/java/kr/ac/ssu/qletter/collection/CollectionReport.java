package kr.ac.ssu.qletter.collection;

public class CollectionReport {
  private String title;
  private String channelName;

  public CollectionReport(String title, String channelName) {
    this.title = title;
    this.channelName = channelName;
  }

  public String getTitle() {
    return title;
  }

  public String getChannelName() {
    return channelName;
  }
}
