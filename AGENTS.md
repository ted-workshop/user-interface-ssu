# Repository Guidelines

Reclap의 작업 원칙을 Qletter의 스택과 squash-only 협업 방식에 맞춰 적용해요.
Codex와 Claude Code는 이 파일을 공통 기준으로 사용해요. CLAUDE.md는 이 파일을 가져와요.

## Project And Toolchain

- Qletter는 숭실대학교 사용자인터페이스 과목의 Android 팀프로젝트예요.
  제품 기준은 [PRD](docs/qletter/01-prd.md)와 [기능 명세](docs/qletter/02-functional-spec.md)예요.
- `apps/api`는 Bun·TypeScript·Hono 서버, `apps/android`는 Java·XML Views 앱이에요.
- 로그인은 이메일·비밀번호 방식이에요. Gemini 키와 공급자 호출은 서버에서만 관리해요.
- 현재 구현은 개발 환경과 debug 앱의 서버 연결 확인까지예요.
  인증·영상 요약·영구 저장을 구현한 것으로 보고하지 않아요.
- Bun workspace와 `bun.lock`을 사용해요. 의존성 변경 시 lockfile도 갱신해요.
  Bun·JDK 버전은 `mise.toml`, Android 빌드는 Gradle Wrapper를 따라요.
- `apps` 아래에는 `android`와 `api`를 나란히 둬요. Android 프로젝트를 `apps` 자체에 생성하지 않아요.
- Android Studio에서는 `apps/android`를 열어요. 개인 JDK·SDK 경로와 비밀값은 커밋하지 않아요.

## Engineering Principles

- 현재 요구를 완전히 해결하는 가장 단순한 구현을 선택해요.
  추측에 기반한 기능·추상화·설정·우회 계층을 추가하지 않아요.
- 끝까지 동작하는 최소 버전 위에 기능을 쌓아요. 책임을 명확히 나누고,
  동작하는 제품을 미완성 구조나 나중에 버릴 임시 구현으로 대체하지 않아요.
- 기존 의존성의 문서와 타입을 먼저 확인해요. 검증된 라이브러리가 전체 복잡도를
  줄인다면 활용하고, 이미 제공되는 기능을 별도 구현하지 않아요.
- 불필요한 호환 계층은 만들지 않아요. 기존 호출부·저장 데이터·소비자를 확인한 뒤
  낡은 경로를 제거하고, 필요한 호환 계약과 데이터 마이그레이션은 보존해요.
- 편집 전에 관련 API·타입·호출부·문서를 읽어요. 변경은 요청 범위에 한정하고
  다른 사람의 작업과 partial staging을 보존해요.
- 버그는 증상만 숨기지 않고 원인을 재현해 책임이 있는 계층에서 해결해요.
  원래 실패 경로를 다시 검증하고, 필요에 맞는 회귀 테스트를 추가해요.
- 일반적인 구현 선택은 자율적으로 결정해요. 범위·보안·되돌리기 어려운 작업에
  필요한 정보가 없으면 가정과 확인이 필요한 이유를 설명해요.

## Verification

최초 설정과 JDK·SDK 연결은 [개발 가이드](docs/development.md)를 따라요.

```sh
mise trust
mise install
mise run setup
mise run api:dev
```

- API·공통 도구 변경: `mise run api:check`
- Android 변경: `mise run android:check`
- 공통 설정 변경 및 최종 전체 검사: `mise run check`
- 포맷 수정: `bun run format`, `mise exec -- bun scripts/android.ts format`
- 모든 변경: `git diff --check`와 최종 diff·Git 상태 확인

기능과 버그는 관찰 가능한 행동으로 검증하고, 실용적인 범위에서 TDD를 사용해요.
구현 문자열이나 알고리즘을 복제한 테스트는 피하고 문서 수정은 diff·링크를 확인해요.
앱의 초기·진행·성공·실패·재시도 상태를 확인해요. 빌드 성공, fixture와 mock을
실제 기기·공급자 동작의 증거로 보고하지 않아요. 실패하거나 생략한 검사는 이유를 적어요.

## Issues, Branches And Worktrees

- 관련 issue가 있으면 범위·완료 기준을 확인하고 연결해요.
  issue가 없다는 이유만으로 승인된 작업을 멈추거나 원격 issue를 자동 생성하지 않아요.
- 짧고 범위가 드러나는 기능 브랜치를 사용해요. 예: `feature/123/login`.
- 다른 사용자나 agent의 변경과 충돌한다면 독립 worktree를 사용해요.
  기존 dirty file을 되돌리거나 정리하지 않아요.
- `main` 직접 push와 merge commit은 사용하지 않아요. 최종 PR HEAD의 CI와
  리뷰를 확인한 뒤 **squash merge만** 사용해요.

## Commit And Pull Request

- 커밋 권한이 있으면 작은 논리 단위로 만들고 의도한 경로만 명시적으로 stage해요.
  mixed worktree에서 `git add -A`를 사용하지 않아요.
- 커밋·푸시 전에 `git status --short`, `git diff --cached --name-only`,
  `git diff --cached --check`와 staged diff를 확인해요.
- 커밋 제목은 `TYPE: 한국어 요약` 형식을 사용해요.
  type은 `FEAT`, `FIX`, `CHORE`, `DOCS`, `TEST`, `REFACTOR`, `STYLE`, `PERF`,
  `BUILD`, `CI`, `REVERT` 중 선택하고 본문에는 필요에 맞게 이유와 검증을 적어요.
- PR은 한국어로 작성하고 저장소 PR 템플릿을 따라요. 실제 범위·위험·검증과
  남은 일을 적고, issue 전체를 해결할 때만 `Closes #N`을 사용해요.
- 의존하는 변경은 `gh stack`으로 관리해요. UI 변경은 실제 기기/에뮬레이터
  스크린샷을 `gh attach`로 첨부하고 확인한 환경을 적어요.
- 절차와 명령은 [CONTRIBUTING.md](CONTRIBUTING.md)를 따라요.

## Authorization And Completion

- 작업 요청이나 역할명만으로 커밋·푸시·PR 생성·머지·배포 권한을 확대하지 않아요.
  현재 대화에서 이미 승인한 범위는 다시 묻지 않아요.
- 사용자 승인 없는 위임이나 별도 리뷰 LLM 호출을 하지 않고 직접 검토해요.
- 구현·로컬 검사·IDE/기기 실행·커밋·푸시·PR/CI·머지·배포를 구분해 보고해요.
  바뀔 수 있는 CI·배포 상태는 해당 커밋과 환경을 확인해요.
- 검증이 실패하거나 미완료이면 완료로 표현하지 않아요. 근거와 남은 작업을 적어요.
