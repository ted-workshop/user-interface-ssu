package kr.ac.ssu.qletter.common;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import kr.ac.ssu.qletter.BuildConfig;

/** debug 앱이 개발 PC의 로컬 API에 접속할 수 있게 Android 17의 런타임 권한을 요청해요. */
public final class LocalNetworkPermission {
  private LocalNetworkPermission() {}

  public static void request(Activity activity) {
    if (!BuildConfig.DEBUG || Build.VERSION.SDK_INT < 37) return;
    if (activity.checkSelfPermission(Manifest.permission.ACCESS_LOCAL_NETWORK)
        == PackageManager.PERMISSION_GRANTED) return;
    activity.requestPermissions(new String[] {Manifest.permission.ACCESS_LOCAL_NETWORK}, 1);
  }
}
