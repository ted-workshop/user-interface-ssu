# 팀 작업과 PR

Claude Code와 Codex는 같은 AGENTS.md와 검사 명령을 사용해요. 모델과 개인 편집기 설정은 각자 선택해요.

## 작업 단위
- 기능 브랜치에서 요청 범위를 작게 구현해요. 한 PR에서 목적·변경·검증을 이해할 수 있게 해요.
- 커밋할 경로를 직접 선택하고 staged diff를 확인해요. partial staging을 자동으로 덮어쓰지 않아요.
- 작성자가 변경된 앱의 검사와 실제 화면 확인을 수행하고 다른 팀원이 리뷰해요.
- 로그인은 이메일·비밀번호이고 Gemini API 키는 서버에만 둬요.

## 판단과 의사결정 기록

- 작업 전에 [의사결정 목차](docs/decisions/README.md)에서 관련 결정을 확인해요.
  새 판단과 제안은 [템플릿](docs/decisions/template.md)으로 기록하고 목차에 추가해요.
  같은 문제의 세부 판단은 함께 적고, 기존 결정을 적용하는 변경은 해당 기록을 연결해요.
- 추천에는 코드·공식 문서·측정 근거와 대안, 가정·한계, 검증 방법, 재검토 조건을 붙여요.
  사용자나 리뷰어의 반론과 답변도 기록하고, 결론이 바뀌면 그 근거를 남겨요.
- PR의 `Changes & Structure`에서 관련 기록과 상태를 연결해요. 문서 검토·구현·로컬 검사·배포·
  실제 사용 검증을 구분하고, 기존 8개 섹션 안에서 변경 이유와 남은 검증을 설명해요.

## 이슈와 PR 작성
Palate의 이슈 폼과 8개 섹션 PR 템플릿을 Qletter에 맞춰 사용해요.

- 이슈는 버그·기능·작업 중 하나를 선택해요. 제목은 `ANDROID`, `API`, `OPS`, `DOCS`, `DESIGN` 영역과 한국어 요약으로 작성해요. 예: `ANDROID: 로그인 입력 오류 안내`.
- 현재 상태·포함 범위·제외 범위·완료 기준·검증을 구체적으로 적어요. 버그에는 재현 방법도 적어요.
- [API 작업 추적 이슈](https://github.com/ted-workshop/user-interface-ssu/issues/2)에서 선행 작업과 참여 방법을 확인해요.
  맡을 작업에 착수 의사와 범위를 남기고, 빠진 작업은 기존 양식으로 추가해 상위·관련 이슈를 연결해요.
  연결 권한이 없으면 추적 이슈에 새 이슈 링크를 남겨요. 관리 근거는 [ADR-0004](docs/decisions/0004-github-issue-backlog.md)에 있어요.
- 새 이슈는 확인할 결과에 맞는 [마일스톤](https://github.com/ted-workshop/user-interface-ssu/milestones)에 연결해요.
  목표가 미정인 후속 제안은 배정 없이 추가해요. 묶음 기준과 완료 조건은 [ADR-0005](docs/decisions/0005-outcome-milestones.md)를 따라요.
- 우선순위는 P0(진행 차단), P1(현재 작업에서 중요), P2(후속 작업) 중 선택해요. 이 선택이 라벨을 자동 생성하지는 않아요.
- PR 템플릿의 8개 섹션을 유지하고, 해당 사항이 없는 항목은 이유와 함께 짧게 적어요. 실제로 실행한 검증만 체크해요.
- 관련 이슈가 있으면 연결하고, 전체 범위를 해결한 경우에만 `Closes #N`을 사용해요. stack의 의존 PR도 표시해요.
- UI 변경은 실제 기기·에뮬레이터 스크린샷과 확인 환경을 적어요. 아직 확인하지 못했다면 그 이유를 남겨요.

## Git hooks
`mise run setup`은 frozen lockfile로 의존성을 설치하고 저장소 로컬 `core.hooksPath=.githooks`를 설정해요.
기존 경로가 다르면 중단해요. 기존 hook 내용을 확인하고 팀 hook 호출을 통합하거나, 더 이상 필요 없는 설정인지 확인한 뒤 직접 변경해요. 전역 hooksPath를 무조건 초기화하지 않아요.

- pre-commit: staged whitespace와 TypeScript/JSON 포맷을 검사해요. 파일·index를 수정하지 않아요. Java·Gradle 포맷은 pre-push와 CI에서 검사해요.
- pre-push: 전송할 커밋 범위를 보고 API·Android·Terraform 검사를 선택해요. 공통 파일은 전체 검사, 문서만 바뀌면 앱 검사를 생략해요. Wrangler 설정은 API와 이를 읽는 Terraform을 함께 검사해요. 새 브랜치의 비교 기준을 찾지 못하면 전송 트리 전체를 검사 대상으로 삼아요.
- 검사 프로세스를 시작하기 전에 Git 저장소 환경변수를 정리해요. 테스트의 임시 저장소가 실제 작업 브랜치와 설정을 바꾸지 않도록 하는 근거는 [ADR-0006](docs/decisions/0006-pre-push-repository-isolation.md)에 있어요.
- pre-push는 작업 트리가 깨끗해야 실행해요. 검사 대상과 push할 커밋이 달라지는 일을 방지해요. 여러 브랜치를 한 번에 push하는 경우 현재 checkout 이외의 커밋 검증은 각 PR CI가 담당해요.
- hook이 막으면 원인을 해결해요. hooks를 건너뛰었어도 PR의 필수 CI는 통과해야 해요.

## Stacked PR
공식 GitHub CLI 확장을 사용해요.

```sh
gh extension install github/gh-stack
gh stack init
# 첫 변경을 커밋한 뒤 다음 의존 브랜치를 추가해요.
gh stack add next-change
gh stack submit
gh stack view
```

독립적인 변경은 별도 PR로 만들어요. 하나의 stack은 정렬 담당자를 정하고, 부모 수정 후 `gh stack rebase`로 위쪽 변경을 정렬해요. 명령 실행 전 `gh stack view`에서 범위를 확인해요. merge 후 `gh stack sync`로 상태를 갱신해요. rebase 후 검사와 리뷰를 다시 확인해요. 강제 갱신이 필요한 경우 도구의 보호 동작을 따르고 다른 사람의 브랜치를 덮어쓰지 않아요.

## 화면 캡처
Android Studio의 Running Devices 또는 Device Manager에서 실제 화면을 캡처해요. CLI를 사용한다면 다음처럼 저장할 수 있어요.

```sh
adb shell screencap -p /sdcard/qletter-screen.png
adb pull /sdcard/qletter-screen.png /tmp/qletter-screen.png
gh extension install sudosubin/gh-attach
gh attach /tmp/qletter-screen.png -R OWNER/REPO
```

업로드가 반환한 URL을 PR 본문의 `![변경 후](URL)`에 넣어요. 이미지 업로드에 필요한 개인 브라우저 인증은 각자 설정해요. 파일 업로드와 PR 본문 편집은 승인된 PR 작업 범위에서 수행해요.

기존 본문을 보존해 편집한 파일로 반영해요.

```sh
gh pr view PR_NUMBER --json body --jq .body > /tmp/qletter-pr-body.md
# 본문을 편집하고 변경 이유·검증·이미지를 확인해요.
gh pr edit PR_NUMBER --body-file /tmp/qletter-pr-body.md
```

확인한 기기·API 버전·상태를 함께 적고 mock 화면을 실제 앱 증거로 표시하지 않아요.

## Squash-only merge
merge할 때 항상 squash를 선택해요.

```sh
gh stack merge --squash
# 독립 PR
gh pr merge PR_NUMBER --squash
```

stack merge가 아래 PR들을 함께 포함하는지 실행 전 확인해요. CLI 실행은 별도 merge 승인이 있는 경우에만 해요.

저장소 관리자 설정:
1. Pull Requests에서 Allow squash merging만 켜고 merge commits·rebase merging을 꺼요.
2. main ruleset에서 PR 필수, 승인 1명, 대화 해결, 필수 check `quality`를 설정해요.
3. main의 직접 push·삭제·force push를 제한해요.
4. stack 중간 PR도 검사·리뷰한 뒤 머지해요. main ruleset만으로 중간 브랜치의 승인까지 강제된다고 가정하지 않아요.

이 설정은 문서/CI 파일 생성만으로 적용되지 않아요. 권한과 플랜에 맞춰 GitHub에서 별도로 적용하고 확인해요. PR 제목과 본문이 squash 커밋 기록이 되도록 읽기 쉽게 작성해요.
