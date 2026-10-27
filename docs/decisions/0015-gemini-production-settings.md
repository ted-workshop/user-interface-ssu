# ADR-0015: Gemini 키는 GitHub Secret, 모델은 Environment Variable로 관리해요

- 상태: 확정
- 작성·확정일: 2026-10-27
- 확정 근거: API 키와 모델을 GitHub 환경에서 관리하라는 사용자 요청과 승인 범위 안의 배포 연결 판단이에요.
- 관련 기록: [ADR-0014](0014-gemini-video-verification.md), [ADR-0012](0012-gmail-smtp-email-foundation.md), [ADR-0009](0009-manual-deployment-ownership.md)
- 구현·검증 상태: 수동 배포 전달·누락 차단·생성 환경 타입과 회귀 검사를 구현하고 전체 로컬 검사를 통과했어요.
  2026-10-27 GitHub `production`에 Secret·Variable을 등록하고 Secret 이름·갱신 시각과 모델 값을 다시 조회했어요.
  실제 Worker 배포·원격 Secret 전달·Gemini 호출은 실행하지 않았어요.

## 문제와 현재 상태

Gemini 수동 검증은 Git에서 제외한 로컬 파일을 사용해요. 이 파일을 운영 설정 원본으로 쓰면 팀의 수동 배포에
키와 모델을 일관되게 전달할 수 없어요. 기존 운영 메일 설정은 GitHub `production` 환경에서 관리하고
수동 배포가 Worker에 전달해요. 같은 경로를 확장해요.

이 기록은 운영 설정에 관한 추가 결정이에요. ADR-0014의 사용량 초과 뒤 호출 보류·로컬 검증 계약은 유지해요.

## 결정

- 기존 GitHub `production` Environment에 `GEMINI_API_KEY` Secret과 `GEMINI_MODEL` Variable을 둬요.
  모델은 현재 `gemini-3.6-flash`로 시작해요.
- 수동 `Deploy API`가 Secret은 파일 준비 step에, 모델은 배포 설정 준비 step에만 전달해요.
  키는 SMTP 설정과 함께 `0600`·독점 생성한 임시 JSON으로 만들고 `wrangler deploy --secrets-file`로 코드와 함께 업로드해요.
  성공·실패 뒤 `always()` 정리 step으로 파일을 지워요. 키를 명령 인자·로그·artifact에 넣지 않아요.
- `scripts/release.ts`에서 필수 Secret과 모델의 누락·공백을 원격 D1 migration 전에 거부해요.
  운영 모델은 GitHub Variable에서 가져와 배포 설정의 `vars.GEMINI_MODEL`에 넣고 로컬 기본값으로 대체하지 않아요.
- `wrangler.jsonc`에 Secret 이름과 개발용 모델을 선언하고 Wrangler로 환경 타입을 생성해요.
  Worker binding의 키·모델을 기존 공통 함수에 전달하는 계약을 workerd에서 검사해요. 제품 요약 HTTP 호출부는 후속 범위예요.
- 로컬 수동 검증 파일은 개인 입력으로 유지해요. GitHub Secret 값을 내려받거나 운영 키를 일반 CI 검사에 전달하지 않아요.
  Secret·Variable 변경은 다음 수동 배포에 반영돼요. 값 등록만으로 실행 중인 Worker를 바꾸지 않아요.

## 근거와 대안

2026-10-27 공식 자료와 설치된 Wrangler 4.152.0의 설정·CLI를 확인했어요.

- [GitHub Environment Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets#creating-secrets-for-an-environment)와
  [Variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables)는 비밀값과 공개 설정을 나눠 관리할 수 있어요.
  키를 Secret, 모델을 Variable로 두면 민감한 값을 감추면서 팀이 모델을 확인·변경할 수 있어요.
- [Cloudflare의 코드와 Secret 동시 업로드](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code)와
  [Worker 변수 binding](https://developers.cloudflare.com/workers/configuration/environment-variables/)을 사용해요.
  기존 SMTP 배포 경로를 확장하므로 별도 배포 서비스·키 전달 도구를 추가하지 않아도 돼요.
- 모델도 Secret으로 보관하면 값이 숨겨져 운영 모델 확인이 어려워요. 모델 이름은 비밀값이 아니므로 채택하지 않아요.
  Cloudflare에서만 설정을 관리하는 방식도 가능하지만 사용자가 선택한 GitHub 원본과 기존 수동 배포 계약에 맞추기로 했어요.

## 가정·한계와 영향

GitHub에 값을 등록하는 작업과 Worker 런타임 전달은 별개예요. 원격 전달은 변경이 main에 반영된 뒤 승인된 수동 배포에서 확인해야 해요.
현재의 공급자 사용량 초과·실제 요약 성공·리포트 원본 대조는 이 설정 관리로 해결되지 않아요.
공개 요약 HTTP API·영속 작업·Android 화면과 자동 배포는 추가하지 않아요.
새 키를 발급하거나 결제·모델을 자동 전환하지 않아요.

## 검증과 재검토 조건

- 필수 Secret 세 값의 비공개 JSON 저장·누락 거부·기존 파일 보존과 GitHub 모델이 배포 설정을 덮어쓰는 동작을 검사해요.
- 실제 workflow Bash에 fixture 설정과 Wrangler 대역을 연결해 성공·필수 설정별 누락·배포 실패에서 전달·정리를 확인해요.
- workerd에서 가짜 Secret·Variable을 실제 SDK 요청에 전달하고 외부 요청은 가짜 HTTP 응답으로 검사해요.
- 생성 타입 검사·전체 로컬 검사·workflow 문법과 diff·상대 링크·비밀값 제외를 확인해요. 실제 배포 증거와 구분해요.
- GitHub 등록은 Secret 이름·갱신 시각과 모델 Variable 값을 다시 조회해 확인해요. Secret 값을 읽었다고 주장하지 않아요.

2026-10-27 `ANDROID_HOME=/Users/ted/Library/Android/sdk mise run check`를 통과했어요.
workerd 71개·Bun 명령 16개·공통 도구 49개와 Android·Terraform 검사를 포함해요.
배포 workflow의 actionlint와 fixture Secret을 사용한 실제 Wrangler `deploy --secrets-file --dry-run`도 통과했어요.
dry-run 출력에서 키 값은 숨겨지고 선택한 모델 Variable이 binding으로 표시됐어요. 원격 리소스를 변경한 결과는 아니에요.

운영 환경이 늘어나거나 GitHub Actions가 배포를 담당하지 않게 되면 관리 원본을 다시 비교해요.
모델·키를 바꿀 때에도 실제 공급자 지원·사용량·비용은 별도로 확인해요.

## 반론과 변경 이력

- 2026-10-27: 운영 키를 GitHub Secret으로, 모델을 Environment Variable로 관리하라는 요청을 반영했어요.
  기존 SMTP 전달을 확장하고 로컬 수동 검증과 운영 배포의 경계를 유지해요.
- 2026-10-27: 배포 검사 도구의 성공 단계·실패 뒤 정리를 하나의 루프로 합치고 workflow에 적힌 순서를 따라요.
  fixture의 GitHub context 값도 하나의 표에서 해석해 중첩 분기를 줄여요. 실제 Bash·배포 CLI와 Wrangler 대역을
  연결한 성공·설정 누락·배포 실패 검사는 유지해요. 일반 GitHub Actions 실행기를 구현하지 않아요.
  임시 사본에서 D1 단계를 설정 검사 앞으로 옮겼을 때 누락 차단 검사가 실패함을 확인했어요. 원격 변경은 없어요.
