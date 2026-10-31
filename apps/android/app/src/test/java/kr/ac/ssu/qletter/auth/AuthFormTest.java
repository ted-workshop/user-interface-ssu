package kr.ac.ssu.qletter.auth;

import static org.junit.Assert.*;

import org.junit.Test;

public class AuthFormTest {
  @Test
  public void 이메일의_공백과_대문자만_정규화해요() {
    assertEquals("first.last+tag@gmail.com", AuthForm.email("  First.Last+Tag@GMAIL.COM  "));
    assertTrue(AuthForm.validEmail("  First.Last+Tag@GMAIL.COM  "));
    for (String value :
        new String[] {
          "",
          "bad",
          "한글@example.com",
          "K@example.com",
          "a b@example.com",
          "reader@localhost",
          "a@b..com"
        }) {
      assertFalse(value, AuthForm.validEmail(value));
    }
  }

  @Test
  public void 닉네임은_NFC와_문자_수로_검사해요() {
    assertEquals("가나다", AuthForm.nickname("  가나다  "));
    assertTrue(AuthForm.validNickname("가나"));
    assertTrue(AuthForm.validNickname("😀😀"));
    assertTrue(AuthForm.validNickname("가".repeat(20)));
    assertFalse(AuthForm.validNickname("가".repeat(21)));
    assertFalse(AuthForm.validNickname("😀"));
    assertFalse(AuthForm.validNickname("가\n나"));
    assertFalse(AuthForm.validNickname("가\u2028나"));
  }

  @Test
  public void 비밀번호의_공백과_유니코드를_그대로_세어요() {
    assertTrue(AuthForm.validPassword(" 비밀번호를 그대로 지켜 주세요 "));
    assertTrue(AuthForm.validPassword("😀".repeat(15)));
    assertTrue(AuthForm.validPassword("가".repeat(128)));
    assertFalse(AuthForm.validPassword("😀".repeat(14)));
    assertFalse(AuthForm.validPassword("가".repeat(129)));
  }
}
