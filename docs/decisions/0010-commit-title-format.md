# ADR-0010: 변경 영역과 PR 번호를 커밋 제목에 표시해요

- 상태: 확정
- 작성일: 2026-10-24
- 확정일과 근거: 2026-10-24 사용자가 `TYPE(Category): 한국어 요약` 형식과 PR 번호 suffix를 선택했어요. PR 생성 전 적용 방법은 squash-only 방식에 맞춘 구현 판단이에요.
- 관련 기록: 선행·대체 기록은 없어요. [AGENTS.md](../../AGENTS.md)의 기존 `TYPE: 한국어 요약` 규칙을 갱신해요.
- 구현·검증 상태: AGENTS.md·CONTRIBUTING.md의 규칙과 예시를 갱신하고 문서 diff·상대 링크를 확인했어요. 제목 자동 검사나 과거 커밋 변경은 포함하지 않아요.

## 문제와 현재 상태

기존 제목은 변경 종류만 표시해서 API·Android·인프라 중 어느 영역의 변경인지 본문을 열어야 알 수 있어요.
저장소는 [squash-only 협업](../../CONTRIBUTING.md#squash-only-merge)을 사용해요.

## 결정

- 커밋 제목은 `TYPE(Category): 한국어 요약 (#PR번호)`예요. type의 대문자 목록은 유지해요.
- category는 `API`, `Android`, `Infra`, `Docs`, `Repo`처럼 변경 영역을 적고, 여러 영역은 쉼표와 공백으로 구분해요.
- `(#N)`은 PR 번호예요. PR 생성 전에는 생략하고, 번호가 정해진 뒤의 새 커밋과 최종 squash 커밋에는 붙여요.
- PR 제목은 같은 형식에서 번호를 생략해요. squash 시 최종 제목에 번호를 한 번만 포함해요.
- 기존 커밋은 보존하고 이후 작성하는 커밋·PR 제목에 적용해요. 이슈는 PR 본문에서 연결해요.

## 근거와 대안

- 변경 종류와 영역을 함께 적으면 목록에서 변경 범위를 확인할 수 있어요. 여러 영역을 표시할 수 있어 API와 Android 연결 작업도 표현할 수 있어요.
- 기존 `TYPE: 요약`은 짧지만 영역을 표현하지 못해 채택하지 않았어요.
- suffix를 이슈 번호로 쓰면 제품 작업 추적에 유리하지만 여러 이슈를 다루거나 이슈가 없는 PR의 표기가 모호해져 PR 번호를 선택했어요.
- [GitHub squash 설정 문서](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/configuring-commit-squashing-for-pull-requests)를 2026-10-24에 확인했어요. 기본 squash 제목은 설정과 커밋 수에 따라 달라질 수 있어 최종 제목도 확인해요.
- 별도 commitlint나 hook은 추가하지 않아요. 현재는 문서 규칙과 PR 검토로 적용할 수 있어 새 도구의 설치·유지 비용을 피할 수 있어요.

## 가정·한계와 영향

기존 커밋·브랜치·배포 동작에는 영향이 없어요. 규칙 위반을 CI가 자동으로 차단하지는 않아요.

## 검증과 재검토 조건

두 작업 가이드의 형식·예시·PR 번호 처리와 상대 링크, `git diff --check`를 확인해요.
PR #19의 제목을 같은 형식으로 맞추고, 다음 커밋부터 새 제목을 사용해요. 실제 squash merge는 승인된 작업 범위에 포함하지 않아요.
범주가 혼동되거나 제목 규칙 위반이 반복되면 범주 정의나 자동 검사의 필요성을 재검토해요.

## 반론과 변경 이력

- 2026-10-24: 변경 영역을 category로 표시하고 여러 영역을 함께 적을 수 있게 했어요. PR 번호를 모르는 초기 커밋도 작성할 수 있도록 suffix 생략을 허용했어요.
