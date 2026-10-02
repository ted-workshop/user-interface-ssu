# Qletter 모노레포 개발 환경 설계

작성일: 2026-10-02

## 목적과 범위

팀원이 Claude Code 또는 Codex를 자유롭게 사용하면서 같은 개발 환경과 검증 기준으로 작업할 수 있게 해요. Android Studio에서 앱을 실행하고 로컬 TypeScript API에 연결하는 것까지 첫 개발 환경의 완료 기준으로 잡아요.

사용자가 선택한 내용은 모노레포, TypeScript API 서버, Gemini API 사용 방향, Android Studio 클라이언트, mise를 통한 JDK 관리, GitHub CLI 기반 stacked PR과 이미지 첨부, Git hooks, squash-only merge예요. 이번 구현 범위는 **협업 환경 + 서버·앱 기본 연결**이에요.

제품 로그인은 이메일·비밀번호 회원가입과 일반 로그인으로 정했어요. 실제 인증 구현은 다음 기능 단계에서 진행하고, 이번 초기 구성에는 인증 공급자나 세션 저장소를 미리 추가하지 않아요.

이 문서는 승인한 초기 구성 설계예요. 구현·테스트·원격 저장소 설정 적용이 완료됐다는 뜻은 아니에요. 기존 제품 요구사항은 [PRD](01-prd.md)와 [기능 명세](02-functional-spec.md)를 따라요.

## 구성 선택

| 선택 | 내용 | 판단 |
| --- | --- | --- |
| 단순 모노레포 | Bun workspace로 TypeScript 관리, Android는 Gradle Wrapper 사용, mise로 공통 명령 제공 | 두 앱의 기본 도구를 유지하며 시작할 수 있어 추천해요. |
| 통합 빌드 도구 추가 | 별도 모노레포 빌드 도구로 의존 관계와 작업 캐시 관리 | 현재 두 앱 규모에서는 설정과 유지 비용이 커서 필요해질 때 검토해요. |

API는 Bun과 Hono, 클라이언트는 Java·XML Views를 사용해요. TypeScript와 Java 사이에는 HTTP JSON 계약을 사용하고, 공통 TypeScript 타입을 Android에서도 직접 공유할 수 있다고 가정하지 않아요. 초기 health API의 계약은 문서와 양쪽 동작 테스트로 확인해요. 사용하지 않는 shared 패키지나 코드 생성 체계는 만들지 않아요.

```text
apps/
  api/                  TypeScript·Hono HTTP 서버
  android/              Android Studio에서 여는 Gradle 프로젝트
docs/
  qletter/              제품 기획과 이번 설계
  development.md        설치·실행·검사·연결 문제 해결
AGENTS.md               팀 공통 작업 규칙과 명령
CLAUDE.md               @AGENTS.md import
CONTRIBUTING.md         PR·리뷰·stack·squash 작업 방법
mise.toml               JDK·Bun 버전과 공통 작업
package.json            Bun workspace 경계
.editorconfig           공통 텍스트·코드 스타일
.githooks/              커밋·푸시 전 검사
.github/                PR 템플릿과 CI
```

## 서버와 앱의 첫 연결

1. API는 기본적으로 개발 PC의 loopback 주소에서 실행해요.
2. `GET /health`는 `200`과 `{ "status": "ok", "service": "qletter-api" }`를 반환해요. 키·설정값·외부 공급자 정보는 반환하지 않아요.
3. Android debug 앱의 개발용 연결 화면에서 서버 상태를 조회해요. 이 화면은 Qletter의 완성된 사용자 흐름으로 소개하지 않아요.
4. 최초 상태, 연결 중, 연결 성공, 연결 실패를 구분하고 실패 시 다시 시도할 수 있게 해요. timeout을 두고 메인 스레드에서 네트워크를 실행하지 않아요.
5. 기본 Android 에뮬레이터는 개발 PC를 가리키는 `10.0.2.2` 주소로 연결해요. 실제 기기 연결은 `adb reverse` 사용 방법을 문서화해요.
6. 로컬 HTTP 예외는 debug 설정에만 두고 release에서 전역 cleartext를 허용하지 않아요. 연결 주소는 로컬 빌드 설정으로 바꿀 수 있게 해요.

Gemini 연동은 API 서버가 소유해요. 공식 JavaScript SDK `@google/genai`를 실제 요약 기능 구현 때 도입하고, API 키와 모델 설정은 서버 환경변수로 관리해요. 이번 단계에서 사용하지 않는 공급자 추상화·가짜 요약 응답·미완성 요약 endpoint는 만들지 않아요. 앱과 저장소에는 실제 API 키를 넣지 않아요.

로그인, 영구 저장, 보관함, YouTube 분석, 채널 수집, 이메일, 배포는 이번 완료 범위에 포함하지 않아요. 이 기본 연결을 기존 PRD의 로그인·요약 기능 완료로 표시하지 않아요.

## 재현 가능한 도구 설정

- Bun 1.4.2, OpenJDK 25 계열에서 호환성을 검증하고 실제 선택한 정확한 버전을 `mise.toml`에 고정해요. `latest`, `lts`, major만 지정하는 가변 별칭은 팀 설정에 사용하지 않아요.
- JavaScript 의존성은 bun.lock을 커밋하고 CI에서 frozen install로 설치해요.
- 가져온 Android Studio 프로젝트를 기준으로 AGP 9.4.1·Gradle 9.6.0·SDK 37을 사용해요. 공식 호환표와 실제 빌드로 확인하고 Gradle Wrapper와 의존성 버전을 고정해요. 앱과 테스트는 Java로 작성하고 의존성은 버전 카탈로그로 관리해요. Gradle 설정의 Kotlin DSL(`.kts`)은 유지해요.
- 앱의 최소 지원 버전은 가져온 프로젝트 기준으로 API 24을 사용해요. 수업용 기기 조건에 따라 제품 기준을 확정할 때 조정할 수 있어요.
- Gradle 실행 JDK와 컴파일 대상은 구분해요. 빌드 JDK는 25, Java 컴파일 대상은 11로 맞춰요.
- Android Studio 자체는 포함된 JBR로 실행해요. Gradle JVM 기준과 Java 설치 탐지 설정을 팀에서 공유하고, 각자 다른 JDK 절대 경로를 저장소에 넣지 않아요. Daemon JVM criteria가 mise의 JDK 선택과 충돌하지 않는지 확인해요.
- Android Studio의 테스트한 버전, SDK 설치 목록, 에뮬레이터 API·화면 크기를 개발 문서에 기록해요. CPU 이미지는 Apple Silicon·Intel·Windows 환경에 맞게 선택해요.
- `local.properties`, `.env`, 서명 키, 개인 IDE 상태, 빌드 결과는 Git에서 제외해요. 설정 예제에는 비밀값을 넣지 않아요.

루트의 공통 작업 이름은 `mise run setup`, `mise run api:dev`, `mise run api:check`, `mise run android:check`, `mise run check`로 통일해요. Android는 `apps/android/gradlew` 또는 Windows의 `gradlew.bat`를 사용해요. Android까지 Bun package처럼 취급하지 않아요.

설정 작업은 필요한 도구가 없을 때 설치 방법과 실패 원인을 알려줘요. 기존 전역 설정, Git hook 경로, Android Studio 설치를 조용히 덮어쓰지 않아요.

## 공통 AI 지침과 코드 품질

`AGENTS.md`에는 제품 문서 위치, 앱별 책임, 실행·검사 명령, 변경 범위 보존, 회귀 검증, 결과 보고, PR·머지 규칙을 담아요. `CLAUDE.md`는 공통 파일을 import해요. 모델·개인 플러그인·개인 권한 허용 목록은 팀 필수 설정으로 복사하지 않아요.

TypeScript는 formatter/linter·타입 검사·행동 테스트·빌드를 실행해요. Android는 formatter·Android Lint·로컬 단위 테스트·debug APK 빌드를 실행해요. 도구는 구현 시 각 언어에 맞는 작은 조합으로 고정하고 동일한 명령을 로컬과 CI가 호출해요.

| 위치 | 역할 |
| --- | --- |
| pre-commit | staged 변경의 whitespace·빠른 포맷 검사. 자동 재스테이징으로 사용자의 partial staging을 훼손하지 않아요. |
| pre-push | 변경 앱의 필수 로컬 검사. 루트 공통 설정 변경은 양쪽을 검사해요. |
| PR CI | API·Android 검사를 분리해서 실행하고 필수 최종 상태를 제공해요. |
| 실제 앱 확인 | 에뮬레이터/기기에서 연결·실패·재시도와 화면을 확인해요. |

Git hooks는 `.githooks`를 버전 관리하고 저장소 로컬 `core.hooksPath`로 연결해요. IDE에서 커밋·푸시할 때도 mise를 찾는지 확인해요. hook은 빠른 피드백이며, 우회 여부와 관계없이 CI가 머지 기준이에요.

CI는 외부 Gemini 키 없이 실행하고 네트워크 공급자 호출을 테스트로 가장하지 않아요. 실제 공급자 호출 검증은 다음 기능 단계에서 별도로 수행해요.

## PR과 머지

- 공식 `github/gh-stack`을 사용하고 의존하는 변경만 stack으로 묶어요. stack 관리 담당자가 부모 변경 후 상위 변경을 정렬해요.
- CI는 `main` 대상 PR뿐 아니라 stack 브랜치를 base로 하는 PR에서도 실행해요. 처음에는 복잡한 path filter 없이 검사를 항상 실행해 필수 check가 사라지는 문제를 피하도록 해요.
- UI 변경 PR 본문은 변경 이유, 검증, 확인한 기기, 실제 화면 캡처를 담아요. 캡처 후 `gh attach`로 업로드하고 `gh pr edit --body-file`로 본문에 넣는 방법을 문서화해요. 브라우저 로그인과 첨부 세션은 개인 환경에 둬요.
- PR별로 검증·승인 여부를 확인하고 squash로 머지해요. GitHub에서 merge commit과 rebase merge를 비활성화하는 설정을 안내해요.
- `main` 직접 푸시·강제 푸시 차단, 필수 CI, 팀원 1명 승인, 리뷰 대화 해결을 목표로 해요. 실제 원격 설정 적용은 저장소 권한·플랜·stack 동작을 확인한 후 별도 적용 결과로 보고해요.
- 설정 파일 작성은 커밋·푸시·PR 생성·머지·배포 실행과 구분해요. 이번 초기 구성만으로 이러한 작업을 자동 실행하지 않아요.

## 완료 기준

| ID | 관찰 가능한 결과 |
| --- | --- |
| ENV-01 | 문서에 따라 도구와 의존성을 설치하고 같은 고정 버전으로 명령을 실행해요. |
| API-01 | API를 시작해 health 계약을 확인하고, 잘못된 경로와 예외 응답도 테스트해요. |
| AND-01 | Android Studio에서 `apps/android`를 열고 Gradle sync와 debug 빌드에 성공해요. |
| LINK-01 | 실제 실행한 debug 앱에서 서버 연결 성공, 서버 중지 시 실패, 서버 재시작 후 재시도를 확인해요. |
| QA-01 | API 검사와 Android 검사 명령이 로컬에서 통과해요. 의도적인 오류가 해당 검사에서 실패하는지도 확인해요. |
| TEAM-01 | Claude/Codex가 공통 지침을 읽는 방법과 설치 절차가 있고 개인 경로·인증값을 요구하지 않아요. |
| PR-01 | PR 템플릿과 CI 정의가 있고 stack·스크린샷·squash 운영 방법이 문서화돼 있어요. |

SDK나 IDE 접근 제한으로 실행하지 못한 항목은 미검증으로 남겨요. APK 빌드 성공만으로 Android Studio sync나 실제 UI 연결까지 성공했다고 보고하지 않아요. 원격 CI·보호 설정·첨부 업로드는 실제 수행한 경우에만 완료로 보고해요.

## 확인한 공식 자료

- [Hono Bun 서버](https://hono.dev/docs/getting-started/bun)
- [Google Gen AI JavaScript SDK](https://github.com/googleapis/js-genai)
- [XML 레이아웃](https://developer.android.com/develop/ui/views/layout/declaring-layout)
- [AGP 9.1 호환표](https://developer.android.com/build/releases/agp-9-1-0-release-notes)
- [Android JDK 선택](https://developer.android.com/build/jdks)
- [mise Java](https://mise.jdx.dev/lang/java.html)
- [Gradle Daemon JVM](https://docs.gradle.org/current/userguide/gradle_daemon.html)
- [GitHub stacked PR 도구](https://github.com/github/gh-stack)
- [GitHub 첨부 도구 후보](https://github.com/sudosubin/gh-attach)

## 로컬 검증 환경

현재 macOS arm64에서 mise 2026.6.0, Bun 1.4.2, OpenJDK 25.0.2, SDK 37·Build Tools 36.0.0으로 검증해요. 앱과 테스트는 Java·XML Views 기준이에요. IDE sync와 실제 기기 UI는 이번 작업에서 실행하지 않았어요. 검증 결과는 [실행 계획](07-initial-setup-plan.md)에 기록해요.
