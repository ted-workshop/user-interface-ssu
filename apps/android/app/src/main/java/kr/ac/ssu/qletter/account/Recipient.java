package kr.ac.ssu.qletter.account;

/** 채널 리포트를 받을 수신 주소예요. 확인 전에는 verifiedAt이 null이에요. */
public final class Recipient {
  private final String id;
  private final String email;
  private final Long verifiedAt;

  Recipient(String id, String email, Long verifiedAt) {
    this.id = id;
    this.email = email;
    this.verifiedAt = verifiedAt;
  }

  public String id() {
    return id;
  }

  public String email() {
    return email;
  }

  public boolean verified() {
    return verifiedAt != null;
  }
}
