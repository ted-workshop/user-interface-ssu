# ADR-0011: 변경 파일에 따라 CI와 로컬 검사 범위를 선택해요

- 상태: 확정
- 작성일: 2026-10-24
- 확정일과 근거: 2026-10-24 사용자가 CI를 범위별로 나누는 변경을 승인했어요.
- 관련 기록: [ADR-0006](0006-pre-push-repository-isolation.md)의 Git 환경 격리와 [ADR-0009](0009-manual-deployment-ownership.md)의 main CI 성공 확인을 유지해요.
- 구현·검증 상태: 조건부 job·공유 판정을 구현하고 실제 workflow 명령의 로컬 회귀 검사·전체 로컬 검사·actionlint를 통과했어요. GitHub 실행 결과는 PR HEAD의 check로 확인하고 배포와 구분해요.

## 문제와 현재 상태

기존 Quality workflow는 모든 PR·main push에서 API·Android·Infra를 무조건 실행했어요.
반면 pre-push에는 파일별 선택이 있어 실행 범위가 달랐고, 최종 `quality`는 생략된 job도 실패로 취급했어요.
PR #19는 Android 코드·Gradle·JDK를 바꾸지 않았지만 Android CI를 실행했어요.

## 결정

- [scripts/checks.ts](../../scripts/checks.ts)의 파일 판정을 CI와 pre-push가 공유해요. 상세 매핑은 [팀 가이드](../../CONTRIBUTING.md#ci-검사-범위)에 있어요.
- 문서는 앱 검사를 생략하고 API·Android·Infra는 해당 경로를 검사해요. Wrangler 설정은 이를 읽는 API·Terraform을 함께 검사해요.
- API 의존성과 도구 설정은 API, Android 실행 스크립트는 도구 타입 검사와 Android를 검사해요. 공통 실행 설정·Quality workflow·공유 검사 도구·알 수 없는 경로는 전체 검사해요.
- PR은 merge base부터 PR HEAD까지 비교해요. main push는 `before`부터 새 SHA까지 전체 변경을 비교해요.
- 삭제·이동의 양쪽 경로와 공백·줄바꿈이 있는 파일명을 놓치지 않도록 rename 감지를 끄고 NUL로 파일명을 전달해요.
- 최초 push는 전체 tracked 파일로 분류해요. 잘못된 SHA·비교 실패를 검사 대상 없음으로 바꾸지 않아요.
- workflow는 항상 시작하고 `changes`가 job별 실행 조건을 출력해요. `quality`는 판정 성공과 선택된 job의 성공을 요구하고, 선택하지 않은 job의 생략만 허용해요.
- Android job은 Bun·Java만 설치해 API용 Node.js·Terraform 설치와 분리해요.

## 근거와 대안

- [GitHub job 조건](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions)과 [workflow 경로 필터·needs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)를 2026-10-24에 확인했어요.
  workflow 전체에 경로 필터를 걸면 필수 check가 시작되지 않을 수 있어 job에 조건을 둬요. `always()`로 마지막 판정을 실행해 실패·취소를 숨기지 않아요.
- PR 제목이나 label을 기준으로 나누면 설정은 짧지만 실제 변경과 어긋날 수 있어 사용하지 않아요.
- workflow별 glob을 따로 관리하면 로컬과 CI의 판정이 달라질 수 있어 기존 함수를 공유해요. 파일 분류를 위한 외부 action이나 패키지는 추가하지 않아요.
- `mise.toml`·루트 `package.json`을 의미 단위로 비교하면 더 줄일 수 있지만 파싱·판정 규칙이 늘어나 공통 설정은 전체 검사로 유지해요.

## 가정·한계와 영향

이 PR 자체는 Quality workflow와 공통 실행 설정을 바꾸므로 전체 검사 대상이에요. PR에 공통 변경이 남아 있으면 이후 문서 커밋도 PR 전체 범위로 검사해요.
main의 비교 SHA가 저장소에 없으면 실패해요. main force push를 전제한 복구 동작은 추가하지 않아요.
수동 배포 workflow의 CI 자격 확인은 최종 Quality 성공을 계속 사용하고, API 배포 직전 API 검사도 유지해요.

## 검증과 재검토 조건

`scripts/checks.test.ts`에서 영역·문서·공통 변경, 실제 workflow의 Bash 판정과 Git 비교를 검사해요.
PR base의 독립 변경, 여러 커밋 push, 영역 간 이동, 파일명 줄바꿈, 최초 push, 잘못된 SHA와 필요한 job의 생략·실패·취소를 확인해요.
실제 GitHub에서의 job 조건과 최종 결과는 새 PR HEAD의 CI로 확인해요. 로컬 Git·GitHub 환경값 fixture는 원격 실행의 증거가 아니에요.
`mise run check`·actionlint·문서 상대 링크·`git diff --check`를 확인하고 실제 결과는 PR에 남겨요.
새 공통 의존성이 생기거나 누락된 범위·불필요한 전체 검사가 반복되면 매핑을 갱신해요.

## 반론과 변경 이력

- 2026-10-24: API·Infra PR에서 Android CI가 실행되는 원인을 확인하고, 조건 없는 전체 실행을 파일별 job 조건으로 바꿔요. 공통 파일은 보수적으로 전체 검사해요.
