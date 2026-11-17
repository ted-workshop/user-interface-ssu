package kr.ac.ssu.qletter.collection;

public class ReportCollection {

  private final String name;
  private final int reportCount;
  private final String id;

  public ReportCollection(String name, int reportCount, String id) {
    this.name = name;
    this.reportCount = reportCount;
    this.id = id;
  }

  public String getName() {
    return name;
  }

  public int getReportCount() {
    return reportCount;
  }

  public String getId() {
    return id;
  }
}
