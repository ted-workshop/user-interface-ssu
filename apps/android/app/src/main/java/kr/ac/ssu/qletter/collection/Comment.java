package kr.ac.ssu.qletter.collection;

/** 리포트 댓글 하나예요. 작성자는 이메일 없이 닉네임만 와요(ADR-0034). */
public class Comment {
  private final String id;
  private final String authorNickname;
  private final String body;
  private final long createdAtMillis;
  private final boolean canDelete;

  public Comment(
      String id, String authorNickname, String body, long createdAtMillis, boolean canDelete) {
    this.id = id;
    this.authorNickname = authorNickname;
    this.body = body;
    this.createdAtMillis = createdAtMillis;
    this.canDelete = canDelete;
  }

  public String getId() {
    return id;
  }

  public String getAuthorNickname() {
    return authorNickname;
  }

  public String getBody() {
    return body;
  }

  public long getCreatedAtMillis() {
    return createdAtMillis;
  }

  /** 서버가 세션 사용자와 작성자를 비교해 정한 값이에요. 내 댓글이면 true예요. */
  public boolean canDelete() {
    return canDelete;
  }
}
