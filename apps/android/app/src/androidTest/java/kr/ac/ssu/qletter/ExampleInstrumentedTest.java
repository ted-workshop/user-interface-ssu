package kr.ac.ssu.qletter;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Android 기기에서 실행하는 테스트예요.
 *
 * @see <a href="http://d.android.com/tools/testing">테스트 문서</a>
 */
@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {
  @Test
  public void 앱의_패키지_이름을_확인해요() {
    // 테스트 대상 앱의 Context예요.
    Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
    assertEquals("kr.ac.ssu.qletter.debug", appContext.getPackageName());
  }
}
