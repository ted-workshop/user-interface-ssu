# ADR-0032 Android 탭과 로그인 세션의 공통 기반

- 상태 · 확정. 2026-11-07 [#28](https://github.com/ted-workshop/user-interface-ssu/issues/28)의 공통 기반 범위에서 결정했어요.
- 관련 기록 · [API 계약](../api-contract.md), [인증 서버의 ADR-0028](0028-auth-http.md), [화면 연결 방법](../development.md#android-화면에서-공통-기반-사용).
- 구현·검증 · 구현 커밋 `97c42d2`에서 WSL Android 검사와 앱·테스트 APK 빌드를 확인했어요. 실제 기기 검증은 남아 있어요.

## 문제와 현재 상태

main의 Android 제품 진입점에는 빈 화면이 있었고 debug 앱은 개발 서버 점검 화면으로 시작했어요.
#27·#29 담당자가 색상과 탭, 개인 API 요청에 같은 규칙을 적용할 수 있어야 해요.
[#38](https://github.com/ted-workshop/user-interface-ssu/pull/38)은 병합 없이 닫혀 있어서 해당 브랜치에 의존하지 않아요.

## 결정과 근거

- 제공받은 Figma PNG 6장과 원본 Color 변수 이름·값 17개를 기준으로 탭 순서, 선택 텍스트와 선 아이콘을 구현했어요. 가림막은 검정 78%를 8비트 알파 199로 표현해요. 제공된 한 벌의 색상을 두 시스템 모드에서 유지해요.
- Java·XML 프로젝트에 이미 있는 Material의 BottomNavigationView가 접근성 선택 상태와 화면 재생성 시 메뉴 상태를 맡아요. Fragment 컨테이너 하나에서 탭에 해당하는 화면을 보여줘요. 탭별로 Activity를 만드는 방식은 세션 전환 때 폐기할 진입점이 늘어나요.
- 인증 화면은 로그인 결과만 넘겨요. 앱 범위의 세션 저장소가 Android Keystore 키로 토큰과 만료 시각을 함께 암호화해 백업 제외 디렉터리에 원자적으로 저장해요. 서버 주소도 인증된 암호문에 묶어요. 메모리만 사용하면 앱 재시작 때 다시 로그인해야 해요.
- OkHttp 클라이언트가 개인 요청을 만들 때의 세션과 API 주소를 고정해요. 요청 전과 응답 직후의 세션을 대조해요. 현재 세션의 401은 로그인을 해제하고, 연결 실패 때는 저장 상태를 유지해요. 계정 변경 후 늦은 UI 콜백은 각 화면에서도 생명주기에 맞춰 폐기해요.

## 가정과 영향

로그인·계정 설정 화면은 #27, 모음·공개 리포트는 #29에서 연결해요. 공통 탭에는 예시 리포트나 임시 로그인 계정을 넣지 않았어요.
release 주소는 ADR-0028에 기록된 HTTPS Worker예요. debug는 기존 에뮬레이터·USB 주소 설정을 사용해요. 화면 색상이나 API origin이 바뀌면 리소스 또는 빌드 설정을 검토해요.

## 검증과 재검토 조건

2026-11-07 JDK 25에서 저장소 버전의 OkHttp·MockWebServer·JUnit과 실제 변경 소스로 JVM 테스트 10개를 별도 실행했어요. 현재·이전 세션의 401, 이전 계정 요청, 리디렉션, 서버 오류, 토큰 전달, 만료 시각 처리가 통과했어요. Gradle Spotless와 XML 리소스의 정적 대조도 확인했어요.

2026-11-07 작성자의 Ubuntu(WSL)에서 `97c42d2`로 `mise run android:check`(Spotless·lintDebug·testDebugUnitTest·assembleDebug)를 통과했어요. 이어서 `:app:assembleRelease :app:assembleDebugAndroidTest`도 성공했어요. 마지막 빌드 출력은 32초, Gradle 작업 94개 중 73개 실행·21개 최신 상태였어요.

기기에서의 테스트 실행, 화면 캡처와 실제 계정 로그인은 남아 있어요. 탭 선택·화면 재생성 및 Keystore 저장·복원은 개발 가이드의 `connectedDebugAndroidTest`로 확인해요. 계정 전환 뒤 이전 화면이 복원되거나 기존 세션이 새 요청에 쓰인다면 세션·탐색 경계를 다시 검토해요.

## 반론과 변경 이력

- 2026-11-07 · #38의 인증 화면을 가져오는 대안도 검토했어요. #27 담당자의 범위이고 해당 PR이 닫혀 있어 로그인 결과 전달 메서드만 제공해요.
