# Qletter 초기 세팅 실행 계획

**목표:** Bun API와 Android 앱의 기본 연결, 팀 공통 도구·지침·검사를 제공해요.
**설계:** [개발 환경 설계](06-development-setup-design.md)
**실행:** Bun workspace와 Android Gradle 프로젝트를 함께 구성해요. 기존 문서 변경을 보존해요. 초기 구성 검증 후 승인된 범위에서 커밋·푸시·PR을 만들고, 머지와 저장소 보호 설정 변경은 별도로 다뤄요.

## 1. API와 공통 도구
- [x] Bun workspace, mise의 Bun 1.4.2와 OpenJDK 25.0.2를 고정해요.
- [x] health 응답·404·예외 응답 테스트를 먼저 실행해 실패를 확인해요.
- [x] Hono API와 loopback 기본 실행 설정을 구현해요.
- [x] 타입·포맷·테스트·빌드와 실제 HTTP 응답을 확인해요.

파일: 루트 package.json·bun.lock·mise.toml·biome.json, apps/api/package.json·tsconfig.json·src/app.ts·src/server.ts·src/app.test.ts.
계약: GET /health → 200, {"status":"ok","service":"qletter-api"}. 알 수 없는 경로는 JSON 404, 내부 오류는 상세를 숨긴 JSON 500이에요.

## 2. Android 앱
- [x] AGP 9.4.1, Gradle 9.6.0, SDK 37, minSdk 24, JDK 25/컴파일 대상 11로 구성해요.
- [x] 실제 HTTP 클라이언트 테스트로 정상·HTTP 오류·잘못된 본문·timeout을 확인해요.
- [x] XML Views debug 연결 화면과 재시도 상태를 구현해요.
- [x] formatter·lint·단위 테스트·debug APK 빌드를 실행해요.
- [ ] 사용 가능한 기기/에뮬레이터에서 연결 성공→실패→재시도를 확인해요. 장치가 없으면 미검증으로 기록해요.

파일: apps/android의 Gradle Wrapper·빌드 파일·manifest·app/src/main 및 debug 소스, app/src/test.
계약: API 계약에 맞는 응답만 연결 성공으로 처리하고 실패 후 재시도할 수 있어요. 개발 연결 화면과 HTTP 허용은 debug에만 있어요.

## 3. 팀 협업 환경
- [x] AGENTS.md, CLAUDE.md import, README, 개발 가이드, CONTRIBUTING, PR 템플릿을 작성해요.
- [x] setup은 기존 hooksPath를 보존하고 .githooks를 저장소 단위로 설치해요.
- [x] pre-commit은 staged 내용만 읽어 검사하고 index/작업 파일을 수정하지 않아요.
- [x] pre-push는 push할 변경에 맞춰 검사를 실행해요.
- [x] 기존 hook 설정 충돌·부분 staging·push 범위 선택을 임시 저장소에서 동작 검증해요.
- [x] API/Android CI와 필수 집계 check를 작성해요. stack의 모든 PR base에 실행해요.

파일: scripts/*.ts, .githooks/*, .github/workflows/quality.yml, .github/pull_request_template.md, 공통 문서.
검사 명령: mise run api:check, mise run android:check, mise run check.

## 4. 최종 검증
- [x] 의존성을 frozen lockfile로 설치하고 전체 검사를 실행해요.
- [x] 문서 링크·명령·Gemini 비밀값 경계·squash-only 지침을 검토해요.
- [x] 최종 diff와 Git 상태를 확인해요.
- [x] 코드·로컬 검사·IDE/UI·원격 CI·GitHub 보호 설정의 수행 여부를 구분해서 보고해요.

## 검토할 실패 조건
- API가 다른 서비스/잘못된 JSON을 반환하면 앱은 성공으로 표시하지 않아요.
- 네트워크 중단은 재시도 가능한 오류가 되고 UI 스레드를 막지 않아요.
- partial staging에서 unstaged 내용을 검사해 잘못 통과시키거나 자동 staging하지 않아요.
- 기존 hooksPath가 있으면 조용히 교체하지 않아요.
- stack PR과 공통 설정 변경에서 필수 검사가 빠지지 않아요.

## 최초 구성 실행 결과 (2026-10-02)

- API 계약 테스트 3개, Git hooks 동작 테스트 6개, Android HTTP·상태 테스트 6개를 통과했어요. 각 기능의 미구현 상태에서 실패를 확인한 뒤 구현했어요.
- `mise run setup`으로 frozen 의존성과 저장소 로컬 hooks를 설치했고 `mise run check`를 통과했어요.
- 빌드한 API 프로세스의 실제 HTTP health(200)와 JSON 404 응답을 확인했어요.
- Android debug·unsigned release APK를 빌드했어요. Lint 오류는 없고 SDK/의존성 최신 버전 알림은 남아 있어요. 버전 업그레이드를 검증한 것으로 처리하지 않아요.
- Reclap의 AGENTS.md를 기반으로 공통 규칙을 적용하고 Bun·Android 검사, squash-only, 이메일·비밀번호 로그인에 맞게 수정했어요. Claude Code는 같은 파일을 가져와요.
- Android Studio를 기본 경로·Spotlight에서 찾지 못했고 ADB에 연결된 기기가 없어 IDE sync·실제 UI는 미검증이에요.
- CI 정의를 작성했지만 원격 CI는 실행하지 않았어요. GitHub squash-only·보호 규칙 적용, PR·스크린샷 업로드, 커밋·푸시는 수행하지 않았어요.

## Android 프로젝트 위치와 언어 정리 (2026-10-02)

- 새 Java 프로젝트가 `apps`를 Gradle 루트로 사용해 기존 `apps/android`와 중복됐어요. Java 프로젝트를 `apps/android`로 옮겨 `apps/{android,api}` 구조로 정리하고 이전 프로젝트·IDE 상태를 별도 백업했어요. API 파일은 해시 비교로 보존을 확인했어요.
- 앱·연결 코드·테스트는 Java, 화면은 XML을 사용해요. Gradle의 Kotlin DSL과 버전 카탈로그, AGP 9.4.1·Gradle 9.6.0·SDK 37·OpenJDK 25.0.2를 유지해요.
- Java 연결 테스트 7개를 구현 전 실패 상태에서 확인한 뒤 통과시켰어요. 가져온 템플릿의 단위 테스트 1개를 포함해 Android 테스트는 8개예요.
- debug·unsigned release·기기 테스트 APK 빌드를 통과했어요. IDE sync·실제 기기 테스트·UI·원격 CI 실행은 별도 검증으로 남아 있어요.
