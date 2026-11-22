# ADR-0042: debug 앱의 로컬 API 접속에 Android 17 네트워크 권한을 써요

- 상태: 확정
- 작성·확정일: 2026-11-22
- 확정 근거: #27 화면을 에뮬레이터에서 검증하는 과정에서 필요한 자율 판단이에요. 사용자가 승인한 개발·검증 범위 안에서 정했어요.
- 관련 기록: [ADR-0038](0038-android-foundation.md)의 debug API 주소와 [개발 가이드](../development.md#실행과-기본-연결)를 이어요. 서버 API 동작은 바꾸지 않아요.
- 구현·검증 상태: debug manifest·권한 요청과 테스트 사전 허용을 구현했어요. Pixel 7 AVD(API 37)에서 실제 로그인·가입·로그아웃 흐름으로 확인했어요.

## 문제와 현재 상태

`apps/android`는 `targetSdk 37`이고 debug 기본 API 주소는 `http://10.0.2.2:3000/`이에요.
Android 17(API 37)부터 같은 앱이 로컬 네트워크 주소로 TCP 연결을 만들려면
`android.permission.ACCESS_LOCAL_NETWORK` 런타임 권한이 필요해요([Android Developers, 2026-11-22 확인](https://developer.android.com/privacy-and-security/local-network-permission)).

권한을 선언하지 않은 현재 debug 앱은 가입 요청에서 다음처럼 연결 단계에서 실패했어요.
로컬 Worker에는 요청이 도착하지 않았어요.

```text
java.net.SocketTimeoutException: failed to connect to /10.0.2.2 (port 3000) from /10.0.2.16 (port 50786) after 10000ms
```

같은 주소가 emulator shell의 `toybox nc`에서는 열렸으므로 서버·포트 문제가 아니라 앱 프로세스의 권한 문제로 구분했어요.

## 결정

- `app/src/debug/AndroidManifest.xml`에만 `ACCESS_LOCAL_NETWORK`를 선언해요. release에는 선언하지 않아요.
- `BuildConfig.DEBUG`이고 API 37 이상일 때만 `LocalNetworkPermission.request(Activity)`가 런타임 권한을 요청해요.
  로그인 화면, 로그인 후 메인 화면, debug 연결 확인 화면에서 요청해요.
- 사용자가 거부하면 별도 우회 없이 기존 네트워크 오류 문구를 보여 줘요. 개발자는 시스템 설정에서 다시 허용할 수 있어요.
- 연결 테스트는 시작 전에 `UiAutomation.grantRuntimePermission`으로 권한을 허용해 대화상자가 테스트를 가리지 않게 해요.

## 근거와 대안

- 공식 문서는 API 37 이상을 대상으로 하는 앱의 로컬 네트워크 접속이 기본 차단되고,
  `ACCESS_LOCAL_NETWORK`가 `dangerous` 보호 수준의 런타임 권한이라고 설명해요.
  OkHttp 같은 소켓 기반 라이브러리에도 네트워크 스택에서 적용돼요.
- targetSdk를 36으로 낮추는 대안은 Google Play 대상 API 요구와 저장소의 API 37 기준을 거스르고,
  다음 상향 때 같은 문제를 다시 만나므로 채택하지 않았어요.
- main manifest에 권한을 선언하고 release에서도 요청하는 대안은 HTTPS Worker만 쓰는 release에
  불필요한 권한과 사용자 프롬프트를 만들므로 채택하지 않았어요.
- `adb reverse`와 `127.0.0.1`만 쓰는 대안은 기기별 추가 설정이 필요하고 기존 emulator 문서·기본 주소를 바꾸므로,
  로컬 네트워크 권한을 debug에만 두는 쪽을 골랐어요.
- debug 연결 확인 화면도 같은 주소를 쓰므로 같은 요청을 적용했어요.

## 가정·한계와 영향

- release는 공개 HTTPS Worker만 호출하므로 로컬 네트워크 권한이 필요 없다고 가정해요.
  release에서 사설 주소를 호출하는 요구가 생기면 manifest와 권한 요청을 다시 설계해야 해요.
- debug 앱을 새로 설치하면 시스템 권한 대화상자가 한 번 보여요. 거부해도 앱은 실행되지만 로컬 API 요청은 실패해요.
- API 36 이하 기기에서는 권한을 요청하지 않아요. 기존 동작과 같아요.
- 테스트는 기기 API 37 이상에서만 권한을 미리 허용하고, 그 이전에서는 기존 네트워크 실패를 허용해요.

## 검증과 재검토 조건

- Pixel 7 AVD(Android 17, API 37, arm64-v8a)에서 권한 허용 전 요청이 10초 뒤 timeout되고 Worker 로그에 요청이 없음을 확인했어요.
- 권한 허용 뒤 `POST /v1/auth/registrations` 202, `POST /v1/auth/email-verifications/confirm` 204,
  `POST /v1/auth/sessions` 201, 앱 재실행 후 세션 유지, `DELETE /v1/auth/session` 204를 확인했어요.
- `mise run android:check`, `:app:assembleDebugAndroidTest`, `:app:connectedDebugAndroidTest`를 통과해야 해요.
- API 37 동작이나 debug 주소 방식이 바뀌면 이 결정을 다시 검토해요.

## 반론과 변경 이력

- 2026-11-22: debug 전용 권한 선언과 요청을 채택했어요. release 권한·targetSdk 변경은 하지 않았어요.
