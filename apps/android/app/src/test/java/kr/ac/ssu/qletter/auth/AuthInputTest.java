package kr.ac.ssu.qletter.auth;

import static org.junit.Assert.*;

import org.junit.Test;

public class AuthInputTest {
  @Test
  public void 이메일은_앞뒤_공백을_지우고_ASCII_대문자만_소문자로_바꿔요() {
    assertEquals("reader@example.com", AuthInput.email("  READER@Example.com "));
    assertTrue(AuthInput.validEmail("reader@example.com"));
    assertFalse(AuthInput.validEmail("reader@example"));
    assertFalse(AuthInput.validEmail("reader example@example.com"));
    assertFalse(AuthInput.validEmail("reader@example.com "));
  }

  @Test
  public void 닉네임은_NFC로_맞추고_2에서_20_code_point를_받아요() {
    assertEquals("창틴", AuthInput.nickname(" 창틴 "));
    assertTrue(AuthInput.validNickname("창틴"));
    assertFalse(AuthInput.validNickname("창"));
    assertFalse(AuthInput.validNickname("가".repeat(21)));
    assertFalse(AuthInput.validNickname("창\n틴"));
    assertEquals("é", AuthInput.nickname("e\u0301"));
    assertTrue(AuthInput.validNickname("가😀"));
  }

  @Test
  public void 비밀번호는_8에서_128_code_point이고_한_글자만_반복할_수_없어요() {
    assertTrue(AuthInput.validPassword("12345678"));
    assertFalse(AuthInput.validPassword("1234567"));
    assertFalse(AuthInput.validPassword("aaaaaaaa"));
    assertTrue(AuthInput.validPassword("a" + "b".repeat(127)));
    assertFalse(AuthInput.validPassword("a" + "b".repeat(128)));
  }
}
