# 개발 환경

새로 만든 Java Android 프로젝트를 `apps/android`에 배치했어요. Java·XML Views와 버전 카탈로그 구조를 유지하고, 개발용 API 연결은 debug 전용 `ConnectionActivity`에서 확인해요. 이후 작업은 모노레포 안의 프로젝트에서 해요.

## 고정 도구
- Bun 1.4.2: 패키지 설치·공통 스크립트와 도구 테스트
- Node.js 24.15.0: Wrangler·Vitest 실행
- Wrangler 4.152.0: 로컬 Worker·D1 실행, 환경 타입·번들 생성과 API 배포
- Vitest 5.0.5·Cloudflare Vitest plugin 1.4.7: 실제 workerd 안에서 API·D1 테스트
- Terraform 1.17.0·Cloudflare provider 5.28.1: D1·Worker 생성·R2 state 정의와 설정 검사
- OpenJDK 25.0.2: Gradle 실행과 Java toolchain
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
Wrangler가 로컬 workerd에서 실행하며 Cloudflare 로그인이나 공급자 키는 필요하지 않아요.
`X-Qletter-Revision` 헤더는 로컬에서 `local`, 배포 후에는 해당 커밋 SHA를 반환해요. health JSON은 그대로 유지해요.

Android Studio에서 debug variant로 Run해요. 개발 연결 화면의 `연결 확인`을 눌러요. 에뮬레이터 기본 주소는 http://10.0.2.2:3000/예요. 이 화면은 제품 로그인·요약 기능과 별개인 개발 확인 도구예요.

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

연결 화면·네트워크 권한·로컬 HTTP 예외는 debug에만 있어요. release는 가져온 XML 템플릿의 기본 화면을 표시하며, 아직 배포할 제품이 아니에요.

## 로컬 D1과 환경 타입

`apps/api/wrangler.jsonc`의 `DB` binding은 로컬 D1을 사용해요. 설정의 0으로 된 ID는 로컬 식별자이며 원격 DB가 아니에요.
로컬 DB는 해당 worktree의 `apps/api/.wrangler/state`에 남고 Git에서 제외해요.

```sh
mise run api:db:migrate
mise exec -- bun run --cwd apps/api wrangler d1 execute DB --local --command "SELECT name FROM d1_migrations ORDER BY id"
mise run api:types
```

첫 명령은 새 로컬 DB에 `0001_initialize.sql`을 적용해요. 다시 실행하면 이미 적용한 파일은 건너뛰어요.
이 초기 파일은 마이그레이션 이력만 만들고 제품 테이블·데이터는 추가하지 않아요. 실제 스키마는 #8에서 이어가요.
`DB` 접근과 SQL 실패 처리는 workerd 테스트에서 검증하고, 제품 API에 진단용 DB 경로를 추가하지 않아요.

binding을 바꾸면 `api:types`로 추적 중인 `worker-configuration.d.ts`를 다시 생성해요.
`api:check`의 `wrangler types --check`는 설정과 생성 타입이 다르면 실패해요.
런타임 타입은 workerd와 맞춘 `@cloudflare/workers-types`를 사용하고, Bun 도구의 타입 검사와 분리해요.

비밀값이 필요해지는 단계에서는 Git에서 제외한 `apps/api/.dev.vars`를 사용해요.
현재 로컬 검사에는 비밀값이 필요하지 않고, `.dev.vars`·`.env`·개인 SDK 경로를 커밋하지 않아요.

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
Gemini 연동은 다음 기능 단계에서 공식 @google/genai SDK로 구현해요. 모델과 키는 서버 환경변수로 관리하고 Android BuildConfig·리소스·PR 본문에 넣지 않아요. 현재 health 검사는 외부 AI를 호출하지 않고 키 없이 실행해요.

제품 인증은 이메일·비밀번호예요. 현재는 로컬 D1 실행·마이그레이션 기반과 Gmail SMTP 공통 함수·수동 검증 도구까지예요.
인증·제품 데이터 저장·제품 메일·Gemini 요약 API는 아직 없어요.
메일 설정과 검증 범위는 [메일 가이드](email.md), 기능 구현 기준은 [기능 명세](qletter/02-functional-spec.md)를 따라요.

## 검증 범위
CLI 빌드·테스트 성공과 Android Studio sync·기기 UI 실행은 별개예요. 현재 환경에서 수행한 검증은 작업 결과 보고를 확인해요. 팀원은 자신의 OS에서 IDE sync와 연결 흐름을 확인해요. 기기·IDE 검증 없이 APK 빌드만으로 전체 온보딩 성공을 주장하지 않아요.
