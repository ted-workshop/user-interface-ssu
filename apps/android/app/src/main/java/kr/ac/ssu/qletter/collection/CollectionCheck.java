package kr.ac.ssu.qletter.collection;

/** 모음에 담기 시트의 한 줄이에요. 서버에서 받은 담김 여부와 사용자가 바꾼 체크 상태를 같이 들고 있어요. */
public class CollectionCheck {
  private final ReportCollection collection;
  private final boolean originallyChecked;
  private boolean checked;

  public CollectionCheck(ReportCollection collection, boolean containsReport) {
    this.collection = collection;
    this.originallyChecked = containsReport;
    this.checked = containsReport;
  }

  public ReportCollection getCollection() {
    return collection;
  }

  public boolean isChecked() {
    return checked;
  }

  public void setChecked(boolean checked) {
    this.checked = checked;
  }

  /** 완료를 눌렀을 때 서버에 담기·빼기를 보내야 하는 줄인지 알려 줘요. */
  public boolean isChanged() {
    return checked != originallyChecked;
  }
}
