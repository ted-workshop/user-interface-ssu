package kr.ac.ssu.qletter.auth;

import androidx.lifecycle.ViewModel;

/** 이메일 확인처럼 다음 화면에도 필요한 값을 Activity 안에서만 잠시 보관해요. */
public final class AuthViewModel extends ViewModel {
  private String pendingEmail;
  private String pendingPassword;

  void holdCredentials(String email, String password) {
    pendingEmail = email;
    pendingPassword = password;
  }

  String pendingEmail() {
    return pendingEmail;
  }

  String pendingPassword() {
    return pendingPassword;
  }

  void clearCredentials() {
    pendingEmail = null;
    pendingPassword = null;
  }
}
