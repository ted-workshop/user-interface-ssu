package kr.ac.ssu.qletter.auth;

import org.json.JSONException;
import org.json.JSONObject;

/** 로그인한 계정의 공개 정보예요. 이메일은 화면에만 쓰고 요청 본문에 넣지 않아요. */
public final class Account {
  private final String id;
  private final String email;
  private final String nickname;
  private final boolean emailVerified;

  Account(String id, String email, String nickname, boolean emailVerified) {
    this.id = id;
    this.email = email;
    this.nickname = nickname;
    this.emailVerified = emailVerified;
  }

  public static Account parse(JSONObject json) throws JSONException {
    return new Account(
        json.getString("id"),
        json.getString("email"),
        json.getString("nickname"),
        json.optBoolean("emailVerified", true));
  }

  public String id() {
    return id;
  }

  public String email() {
    return email;
  }

  public String nickname() {
    return nickname;
  }

  /** 닉네임 변경 응답을 기존 계정 정보에 반영해요. */
  public Account withNickname(String changed) {
    return new Account(id, email, changed, emailVerified);
  }

  public boolean emailVerified() {
    return emailVerified;
  }
}
