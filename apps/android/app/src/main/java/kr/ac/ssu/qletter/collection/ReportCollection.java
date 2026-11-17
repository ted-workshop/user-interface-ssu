package kr.ac.ssu.qletter.collection;

public class ReportCollection {

  private String name;
  private int reportCount;

  public ReportCollection(String name, int reportCount) {
    this.name = name;
    this.reportCount = reportCount;
  }

  public String getName() {
    return name;
  }

  public int getReportCount() {
    return reportCount;
  }
}
