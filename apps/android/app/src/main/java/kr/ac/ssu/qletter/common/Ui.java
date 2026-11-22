package kr.ac.ssu.qletter.common;

import android.app.Activity;
import androidx.fragment.app.Fragment;

/** 네트워크 콜백을 화면이 살아 있을 때 메인 스레드로 넘겨요. */
public final class Ui {
  private Ui() {}

  public static void on(Fragment fragment, Runnable action) {
    Activity activity = fragment.getActivity();
    if (activity != null) activity.runOnUiThread(action);
  }
}
