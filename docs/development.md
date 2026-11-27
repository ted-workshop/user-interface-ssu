# 개발 환경

새로 만든 Java Android 프로젝트를 `apps/android`에 배치했어요. Java·XML Views와 버전 카탈로그 구조를 유지하고, 개발용 API 연결은 debug 전용 `ConnectionActivity`에서 확인해요. 이후 작업은 모노레포 안의 프로젝트에서 해요.

## 고정 도구
- Bun 1.4.4: 패키지 설치·공통 스크립트와 도구 테스트
- Node.js 24.22.1: Wrangler·Vitest 실행
- Wrangler 4.152.0: 로컬 Worker·D1 실행, 환경 타입·번들 생성과 API 배포
- Vitest 5.0.5·Cloudflare Vitest plugin 1.4.7: 실제 workerd 안에서 API·D1 테스트
- Terraform 1.17.0·Cloudflare provider 5.28.1: D1·Worker 생성·R2 state 정의와 설정 검사
- Eclipse Temurin 25.0.5+8 LTS: Gradle 실행과 Java toolchain
- Gradle 9.6.0: apps/android의 Wrapper로 실행
- AGP 9.4.1, SDK 37·Build Tools 36.0.0: Android 빌드
- Java 컴파일 대상 11, 최소 Android API 24

버전은 mise.toml·bun.lock·Terraform provider lockfile·Android 빌드 설정에 고정해요. 도구 갱신은 설정과 lockfile을 함께 변경하고 전체 검사를 실행해요.

## 최초 설치
Git과 mise를 설치한 뒤 저장소 루트에서 아래 명령을 실행해요. mise trust는 저장소 설정을 읽어본 뒤 실행해요.

```sh
mise trust
mise install
mise run setup
```

Windows에서는 Git for Windows도 필요해요. Git hooks는 Git의 sh로 실행하며 mise와 Bun이 PATH에 있어야 해요. Android 실행 스크립트는 gradlew.bat를 사용해요.

## Android Studio와 SDK
Android Studio의 Stable 버전 중 AGP 9.4.1을 지원하는 버전을 사용해요. IDE 자체는 포함된 JBR로 실행해요. 프로젝트는 저장소 루트가 아닌 **apps/android**를 열어요. 이전에 `apps`를 열어 둔 창은 닫고 이 경로로 다시 열어요.

새 프로젝트를 만들 때 Language는 **Java**, Save location은 **저장소/apps/android**로 지정해요. `apps`를 Save location으로 선택하면 `apps/app`이 생겨 API와 Android 프로젝트가 섞여요. `build.gradle.kts`는 빌드 설정 파일이며 앱 코드의 언어와는 별개예요.

SDK Manager에서 다음을 설치해요.
- Android SDK Platform 37
- Android SDK Build-Tools 36.0.0
- Android SDK Platform-Tools
- Android Emulator와 API 37 시스템 이미지

CLI 설치 시 SDK 패키지 이름은 `platforms;android-37.0`이에요. CI는 SDK의 최소 도구 버전에 맞춰 Android Command-line Tools 22.0을 사용해요.

에뮬레이터는 Pixel 6급 세로 화면·API 37을 공통 기준으로 삼아요. Apple Silicon은 arm64-v8a, Intel/AMD는 x86_64 이미지를 선택해요. 실제 장치별 차이는 PR에 적어요.

Android Studio가 생성하는 apps/android/local.properties에 로컬 SDK 경로를 두거나 ANDROID_HOME을 설정해요. local.properties는 Git에서 제외돼요.

```properties
# 예시이며 각자의 경로로 설정해요.
sdk.dir=/YOUR/ANDROID/SDK
```

### 빌드 JDK 연결
`mise where java`로 설치 위치를 확인해요. Android Studio의 Settings → Build, Execution, Deployment → Build Tools → Gradle에서 해당 JDK를 등록해요.
프로젝트의 gradle/gradle-daemon-jvm.properties는 Java 25를 요구해요. 이 기준은 JAVA_HOME보다 우선해요. Gradle이 설치를 찾지 못하면 IDE에 mise JDK를 등록하고, 터미널에서는 mise exec를 통해 실행해요. gradle.properties는 JAVA_HOME에 있는 설치도 탐지하도록 설정돼 있어요.

```sh
mise exec -- java -version
mise exec -- apps/android/gradlew -p apps/android --version
```

JDK 경로를 공유 gradle.properties의 org.gradle.java.home에 넣지 않아요. 전역 JDK를 바꾸거나 시스템 링크를 만들 필요도 없어요.

### IDE에서 Git hooks가 실패할 때
Android Studio에서 실행한 Git도 `mise`를 찾을 수 있어야 해요. IDE 터미널에서 `mise --version`을 확인해요. macOS Dock 실행과 셸의 PATH가 다르면 mise 설치 경로를 사용자 PATH에 추가하고 IDE를 다시 실행해요. 개인 절대 경로를 팀 hook에 하드코딩하지 않아요. IDE에서 실제 커밋할 때 hook이 실행되는지도 각 환경에서 확인해요.

## 실행과 기본 연결
저장소 루트에서 서버를 실행해요.

```sh
mise run api:dev
curl http://127.0.0.1:3000/health
```

응답은 `{"status":"ok","service":"qletter-api"}`예요. 서버는 개발 PC의 127.0.0.1:3000에만 바인딩해요.
Wrangler가 로컬 workerd에서 실행하며 Cloudflare 로그인은 필요하지 않아요. 인증 경로는 아래 `AUTH_TOKEN_KEY`가 있어야 동작해요.
`X-Qletter-Revision` 헤더는 로컬에서 `local`, 배포 후에는 해당 커밋 SHA를 반환해요. health JSON은 그대로 유지해요.

Android Studio에서 debug variant로 Run하면 홈 탭이 열려요. Android 7.1 이상에서 debug 앱 아이콘을 길게 눌러 **개발 서버 연결**을 선택하거나, 아래 명령으로 점검 화면을 열고 **연결 확인**을 눌러요.

```sh
adb shell am start -n kr.ac.ssu.qletter.debug/kr.ac.ssu.qletter.ConnectionActivity
```
 에뮬레이터 기본 주소는 http://10.0.2.2:3000/예요. 이 화면은 제품 로그인·요약 기능과 별개인 개발 확인 도구예요.
Android 17(API 37)부터 debug 앱은 `10.0.2.2` 로컬 API에 접속하려고 `ACCESS_LOCAL_NETWORK` 런타임 권한을 요청해요.
첫 실행에서 허용하지 않으면 로그인·가입 요청이 연결 오류로 끝나요. release에는 이 권한을 선언하지 않아요([ADR-0042](decisions/0042-android-local-network-permission.md)).

실제 기기에서는 USB debugging을 켜고 장치를 승인한 뒤 포트를 연결해요.

```sh
adb reverse tcp:3000 tcp:3000
mise exec -- apps/android/gradlew -p apps/android installDebug -Pqletter.apiBaseUrl=http://127.0.0.1:3000/
```

Android Studio 빌드에도 같은 URL을 쓰려면 개인 ~/.gradle/gradle.properties에 `qletter.apiBaseUrl=http://127.0.0.1:3000/`를 설정해요. 이 값은 다른 프로젝트에도 보일 수 있으므로 사용을 마치면 정리해요. 공통 저장소에는 개인 URL을 커밋하지 않아요.

검증 순서:
1. 서버 실행 → 연결 확인 → 성공
2. 서버 종료 → 다시 확인 → 실패
3. 서버 재시작 → 다시 시도 → 성공

네트워크 권한과 다섯 탭은 두 빌드에 공통이에요. 개발 연결 화면과 로컬 HTTP 예외는 debug에만 있어요. release는 [ADR-0028](decisions/0028-auth-http.md)에 기록한 HTTPS Worker 주소를 사용해요.

### Android 화면에서 공통 기반 사용

- **화면 연결.** `MainActivity.showTab`에서 선택한 메뉴 ID를 화면 Fragment로 연결해요. 홈은 `HomeFragment`, 영상 요약은 `SummaryFragment`가 담당해요. #27은 채널·계정, #28은 홈·요약·리포트, #29는 모음·리포트 댓글을 연결해요. 공통 화면은 View Binding으로 XML의 뷰를 참조하고, Fragment의 관찰자는 `getViewLifecycleOwner()`에 연결해요.
- **색상.** Figma `bg/default`는 `@color/q_bg_default`, `ink/on-ink`는 `@color/q_ink_on_ink`예요. 전체 값은 [색상 리소스](../apps/android/app/src/main/res/values/qletter_colors.xml)에 있어요. 앱을 다시 빌드하면 리소스 변경이 반영돼요.
- **로그인 성공.** #27의 인증 화면에서 서버 응답을 받은 뒤 `app.sessions().signInAsync(session.token, session.expiresAt, error -> { ... })`을 호출해요. `app`은 `(QletterApplication) requireActivity().getApplication()`이에요. 디스크·Keystore 저장은 내부 작업 스레드에서 실행해요. 콜백은 메인 스레드에서 호출돼요. 화면이 살아 있고 오류가 없을 때 다음 화면으로 이동하고, 저장 오류가 나면 재시도를 제공해요. 토큰을 화면 인자나 로그에 넣지 않아요.
- **개인 API.** `app.api().endpoint("reports").addQueryParameter("limit", "20").build()`로 URL을 만들고 `app.api().newCall(new Request.Builder().url(url).build())`을 실행해요. `execute()`는 작업 스레드에서 사용하고 `Response`는 닫아요. 앱 시작 시 세션 파일 읽기와 Keystore 복호화는 작업 스레드에서 실행해요. 복원이 끝나면 세션 변경을 알리고, 유효한 세션이 있으면 `GET /v1/me`로 확인해요.
- **세션 변경.** `app.sessions().changes().observe(getViewLifecycleOwner(), ...)`에서 `isSignedIn()`을 읽어요. 앱이 다시 보일 때 절전 중 지난 만료 시각도 확인해요. 새 로그인·만료·현재 세션의 401·로컬 로그아웃 시 이전 계정의 화면 데이터를 비워요. 명시적 로그아웃은 #27에서 `DELETE /v1/auth/session`을 처리한 뒤 `clear()`를 호출해요. 요청 실패 시 사용자에게 서버 폐기 결과를 알려야 해요.
- **계정·채널 화면.** 로그인 전에는 `AuthActivity`가 로그인·가입·비밀번호 찾기를 보여 주고, 세션이 준비되면 `MainActivity`로 이동해요. 계정 탭은 `AccountFragment`, 채널 탭은 `ChannelsFragment`가 맡아요. 로그아웃·세션 만료·401이면 `MainActivity`가 스스로 끝나고 `AuthActivity`로 돌아가요.
- **검증.** 기본 검사는 `mise run android:check`예요. 기기를 연결하고 `mise exec -- apps/android/gradlew -p apps/android connectedDebugAndroidTest`로 탭 복원과 Android Keystore 저장·복원을 확인해요. 로그인 화면 통합 뒤에는 로그인 → 앱 재시작 → 로그아웃을 실제 계정으로 확인해요.
  2026-11-22 Pixel 7 AVD(Android 17, API 37)에서 가입 → 이메일 확인 코드 → 로그인 → 앱 재시작 → 계정·채널 화면 → 로그아웃과 비밀번호 재설정을 로컬 API로 확인했어요.
  로컬 `.dev.vars`에 SMTP·YouTube 키가 없어 실제 메일 수신과 실제 채널 조회·등록은 확인하지 않았어요.

### 홈·영상 요약 검증

홈의 최근 리포트와 요약 완료 카드에서 상세를 열면 뒤로 가기로 원래 화면에 돌아와요.
요약 탭은 입력·진행 상태와 요청 목록을 보여 주고, `상태 다시 확인`은 GET, `요약 다시 시도`만 POST예요.
앱이 백그라운드이거나 다른 탭을 보고 있으면 자동 조회를 멈춰요. 서버의 요약 작업은 계속돼요.
범위·한계는 [ADR-0051](decisions/0051-android-home-summary.md)에 있어요.

기기가 연결된 환경에서 아래 검사를 실행해요. `TestApi`가 기기 내부 MockWebServer를 사용하므로 외부 API·메일 비밀값은 필요 없어요.

```sh
mise run android:check
mise exec -- apps/android/gradlew -p apps/android connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=kr.ac.ssu.qletter.common.HomeSummaryFlowTest -Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true
adb pull /sdcard/Android/data/kr.ac.ssu.qletter.debug/files/home-summary-check ./home-summary-check
```

검사 뒤 APK를 유지하는 옵션은 앱 삭제로 캡처까지 사라지는 것을 막아요. 캡처를 가져온 뒤 테스트 앱을 삭제해도 돼요.
캡처는 실제 앱에 검증용 데이터를 표시한 결과예요. 실제 Gemini 요약·Gmail 수신 검증과 구분해 PR에 첨부해요.

개인 기기가 없어도 Android 변경 PR의 `Android device` workflow에서 공통 기기 검사를 실행해요.
API 35와 API 37.0의 Pixel 7 에뮬레이터에서 홈·요약·리포트·세션·확인창을 각각 검사하며, 리포트 검사가 생략되지 않도록
검사용 API 주소를 `http://127.0.0.1:3000/`으로 빌드해요. 실패·생략이나 필수 캡처 누락은 성공으로 표시하지 않아요.
Actions 실행의 `Artifacts`에서 `android-device-api35-실행번호`, `android-device-api37-실행번호`를 내려받으면 결과 XML·HTML과
`home-summary-check`, `report-check`의 화면을 볼 수 있어요. 보관 기간은 14일이므로 확인한 화면은 PR에도 첨부해요.
API 37에서는 테스트가 로컬 네트워크 권한을 사전 허용하고, 실행 후 권한 상태도 검사해요.
실행 근거·한계는 [ADR-0052](decisions/0052-android-device-ci.md)에 있어요. 시스템 권한창에서 직접 거부·허용하는 흐름과
`10.0.2.2` 개발 서버 접속, 개인 기기·실제 공급자 검증은 이 검사와 구분해요.

## 로컬 D1과 환경 타입

`apps/api/wrangler.jsonc`의 `DB` binding은 로컬 D1을 사용해요. 설정의 0으로 된 ID는 로컬 식별자이며 원격 DB가 아니에요.
로컬 DB는 해당 worktree의 `apps/api/.wrangler/state`에 남고 Git에서 제외해요.

```sh
mise run api:db:migrate
mise exec -- bun run --cwd apps/api wrangler d1 execute DB --local --command "SELECT name FROM d1_migrations ORDER BY id"
mise run api:types
```

첫 명령은 새 로컬 DB에 모든 마이그레이션을 순서대로 적용해요. 다시 실행하면 이미 적용한 파일은 건너뛰어요.
0003은 기존 개인 제품 행이 있으면 전체 전환을 중단해 보존해요. 계정·세션·수신 주소는 유지하고, 빈 제품 스키마에 공통 보고서·개인 권한·댓글·발송 제약을 적용해요.
실행과 중단 복구는 [영속 작업 가이드](jobs.md), 저장 모델·계측은 [D1 가이드](database.md), 구현할 HTTP 형식은 [API 계약](api-contract.md)을 따라요.
`DB` 접근과 SQL 실패 처리는 workerd 테스트에서 검증하고, 제품 API에 진단용 DB 경로를 추가하지 않아요.

binding을 바꾸면 `api:types`로 추적 중인 `worker-configuration.d.ts`를 다시 생성해요.
`api:check`의 `wrangler types --check`는 설정과 생성 타입이 다르면 실패해요.
런타임 타입은 workerd와 맞춘 `@cloudflare/workers-types`를 사용하고, Bun 도구의 타입 검사와 분리해요.

로컬 서버의 비밀값은 Git에서 제외한 `apps/api/.dev.vars`를 사용해요. `mise run api:check`에는 필요하지 않고,
`.dev.vars`·`.env`·개인 SDK 경로를 커밋하지 않아요. 로그인을 로컬에서 쓰려면 임의의 값을 만들어 넣어요.

```sh
echo "AUTH_TOKEN_KEY=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')" >> apps/api/.dev.vars
mise run api:db:migrate
```

Cron이 돌아야 메일을 보내고, 보내려면 SMTP 설정이 필요해요. 메일 없이 가입 흐름을 이어가려면 로컬 DB에서만 이메일을 확인 처리해요.

```sh
cd apps/api
bunx wrangler d1 execute DB --local --command "UPDATE users SET email_verified_at = unixepoch() WHERE email = 'reader@example.com'"
```

직접 요약 HTTP는 [계약](api-contract.md)의 Bearer 세션을 검사해요. 세션은 `POST /v1/auth/sessions`로 발급해요.
새 분석·재시도는 계정별 UTC 하루 합계 3회예요. 키·모델이 준비되지 않으면 새 분석은 503이며 기존 요청 조회와 결과 재사용은 가능해요.
workerd 검사는 격리된 D1 세션과 공급자 fixture로 동작해요. 실제 로그인·공급자 검증을 대신하지 않아요.

## 채널·수신 설정 확인

[ADR-0030](decisions/0030-channel-settings-http.md)의 설정 API는 기존 세션을 사용해요.
실제 채널을 확인할 때는 YouTube Data API v3를 활성화한 키를 Git 제외 파일 `apps/api/.dev.vars`의
`YOUTUBE_API_KEY`에 비공개로 설정해요. 테스트는 fixture를 쓰므로 실제 키 없이 실행돼요.
운영에서는 [배포 가이드](deployment.md)의 `production` Environment Secret을 사용하고 키를 코드·Android·PR에 넣지 않아요.

```sh
mise exec -- bun run --cwd apps/api vitest run test/channel-settings.test.ts test/youtube-channels.test.ts
mise run api:check
```

실제 연결 검증은 로그인한 API 클라이언트에서 아래 순서로 확인해요. 토큰·키·개인 주소는 기록에서 제거해요.

1. `POST /v1/channel-previews`에 본인이 확인할 공개 채널의 `@handle`과 `/channel/…` 주소를 각각 보내 같은 ID인지 대조해요.
2. 반환 ID로 `POST /v1/channels`를 호출해 201, 다시 등록해 409, 목록에서 같은 제목·공식 URL을 확인해요.
3. 구독 ID의 PATCH로 paused·active를 바꾼 뒤 DELETE해 목록에서 빠지는지 확인해요. 다른 계정에서는 해당 ID가 404여야 해요.
4. 본인이 수신할 주소를 추가하고 본문 없는 `/recipients/{id}/verifications` POST로 코드를 요청해요.
   로컬 Wrangler는 `--test-scheduled`로 실행하고 `/__scheduled`를 호출해야 Cron 실행기를 수동 시험할 수 있어요.
   이 실행기는 기존 분석·발송 대기열도 처리하므로 실제 검증용으로 분리한 로컬 DB를 사용해요.
5. 실제 수신함에 도착한 코드로 `/recipient-verifications/confirm`을 호출하고 verifiedAt·재사용 거부를 확인해요.
6. 주기를 60·360·1440으로 저장·재조회해요. 실제 공급자 응답과 로컬 fixture 결과를 구분해 날짜·환경·코드 SHA를 남겨요.

이 변경에서는 실제 키·SMTP 자격증명을 제공받지 않아 위 실제 연결 검증을 실행하지 않았어요.
새 영상 수집·예약 확인은 #14, 리포트 발송 연결은 #15에서 이어져요.

## Terraform

D1·Worker 생성은 [infra/cloudflare](../infra/cloudflare/README.md), 공유 state 버킷은 `infra/state`에서 정의해요.
Terraform이 Worker 코드·binding을 관리하지 않으며 API 수동 배포는 Wrangler가 담당해요.
`infra:check`는 Worker 빌드 없이 두 root를 `init -backend=false`와 `validate`로 검사해요.
Cloudflare 토큰·계정 ID·원격 state는 필요하지 않아요. 실제 state는 R2 backend와 lockfile을 사용해요.
최초 state 설정과 수동 workflow 사용법은 [배포 가이드](deployment.md), 판단 근거는 [ADR-0009](decisions/0009-manual-deployment-ownership.md)를 확인해요.

## 검사
```sh
mise run api:check
mise run android:check
mise run infra:check
mise run check
```

API 검사는 Biome·생성 환경 타입 검사·TypeScript·workerd의 Vitest·Worker dry-run 빌드를 실행해요.
공통 도구 스크립트는 별도로 Bun 타입과 테스트를 검사해요. `infra:check`는 Terraform 포맷·두 root의 provider 스키마를 검사해요.
Android 검사는 Spotless·Android Lint·JVM 단위 테스트·debug APK 빌드를 실행해요.

포맷을 수정할 때:
```sh
bun run format
mise exec -- bun scripts/android.ts format
```

전체 검사에는 Android SDK가 필요해요. API만 작업할 때는 api:check로 빠르게 확인하고, 최종 PR에서는 모든 CI를 통과해요.
CI는 공급자 키 없이 새 로컬 D1 마이그레이션과 API·Android·Terraform을 검사해요.
stack의 중간 브랜치를 대상으로 하는 PR에도 실행하며, 최종 `quality` check는 세 job이 모두 성공해야 통과해요.

## Gemini와 인증
공식 @google/genai SDK의 공통 요약 함수와 수동 검증 도구를 제공해요. 실행 방법과 실제 공급자 검증의 미완료 항목은 [Gemini 가이드](gemini.md)에 있어요. 모델과 키는 서버에서만 관리하고 Android BuildConfig·리소스·PR 본문에 넣지 않아요. health와 CI는 외부 AI를 호출하지 않고 키 없이 실행해요.

제품 인증은 이메일·비밀번호이고 HTTP 경로는 [ADR-0028](decisions/0028-auth-http.md)에 있어요. 로컬 D1과 메일 fixture로 검증했고, 실제 Gmail 발송과 배포의 인증 CPU는 #17에서 확인해요.
메일 설정과 검증 범위는 [메일 가이드](email.md), 기능 구현 기준은 [기능 명세](qletter/02-functional-spec.md)를 따라요.

## 검증 범위
CLI 빌드·테스트 성공과 Android Studio sync·기기 UI 실행은 별개예요. 현재 환경에서 수행한 검증은 작업 결과 보고를 확인해요. 팀원은 자신의 OS에서 IDE sync와 연결 흐름을 확인해요. 기기·IDE 검증 없이 APK 빌드만으로 전체 온보딩 성공을 주장하지 않아요.
