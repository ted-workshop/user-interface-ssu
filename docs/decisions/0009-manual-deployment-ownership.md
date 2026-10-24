# ADR-0009: API 수동 배포와 Terraform 인프라 적용을 분리해요

- 상태: 확정
- 작성·확정일: 2026-10-24
- 확정 근거: CI 자동 실행, API·인프라 workflow 수동 실행과 관리 범위 분리를 사용자가 승인했어요.
- 관련 기록: [ADR-0008](0008-workers-d1-local-and-terraform.md)의 원격 인프라·배포 결정을 대체해요. 로컬 Workers·D1 기반은 유지해요.
- 구현·검증 상태: workflow·관리 범위 분리·R2 backend와 최초 설정 경로를 구현했어요.
  전체 로컬 검사를 통과했어요. 실제 리소스 생성·GitHub 설정·원격 CI·배포는 수행하지 않았어요.

## 문제와 현재 상태

ADR-0008의 Terraform은 Worker 번들과 binding까지 관리했어요. API만 바꿔도 Terraform 적용이 필요하고,
Wrangler로 따로 배포하면 다음 Terraform 적용이 코드·설정을 덮어쓸 수 있었어요.
현재 팀에는 공유 state 저장소가 없으며 자동 배포 대신 필요할 때 배포 workflow를 실행하려고 해요.

## 결정

- 자동 `quality.yml`은 PR·main push의 API·로컬 D1·Android·Terraform 검사를 유지해요.
- `deploy-api.yml`은 `workflow_dispatch`로 실행해요. 선택한 SHA의 main 포함 여부와 최신 main push CI 성공을 확인해요.
  같은 SHA에서 API 검사·배포 설정 dry-run·D1 migration·Wrangler 배포·HTTP 검증을 실행해요.
- Terraform은 `cloudflare_worker`로 Worker 자체만 만들고 D1을 관리해요.
  Worker 버전·코드·binding·호환 날짜·observability는 Wrangler가 관리해요.
  Terraform이 번들 파일을 읽거나 Worker 버전·배포 리소스를 선언하지 않아요.
- `infra.yml`은 별도 수동 실행이며 main의 CI 성공을 확인해요. 기본 동작은 plan이에요.
  apply를 선택하면 같은 실행이 만든 plan 파일을 적용해요. API 배포는 Terraform과 R2 자격증명에 의존하지 않아요.
- 공유 state는 기존 Cloudflare 환경의 R2 S3 backend로 준비해요. S3 lockfile과 두 workflow의 공통 concurrency group을 사용해요.
  최초 버킷 생성은 `infra/state`의 Terraform으로 하고 로컬 state를 생성한 버킷으로 이전해요.
  실제 인증·저장·잠금은 자격증명이 준비된 계정에서 확인해야 해요.
- 실제 D1 ID는 최초 Terraform output에서 GitHub 환경 변수로 등록해요.
  로컬 Wrangler 설정은 보존하고 배포 실행에서만 별도 설정 파일에 원격 ID와 SHA를 넣어요.
- health JSON은 유지하고 `X-Qletter-Revision` 헤더를 추가해요. 배포 검증은 해당 SHA와 health·JSON 404 계약을 모두 확인해요.
  확인할 수 없는 이전 배포나 실패한 CI를 성공으로 처리하지 않아요.
  revision은 실행마다 바뀌므로 `wrangler types --strict-vars=false`로 환경 변수 타입을 문자열로 생성해요.
- `AGENTS.md`에는 의사결정 문서 언급을 추가하지 않아요.

## 근거와 대안

공식 출처와 설치한 provider·Wrangler의 타입·CLI를 2026-10-24에 확인했어요.

- [Cloudflare IaC 지침](https://developers.cloudflare.com/workers/platform/infrastructure-as-code/#terraform)은
  Terraform의 `cloudflare_worker`와 Wrangler의 버전·배포 관리를 나누는 구성을 지원해요.
  설치한 provider 5.28.1의 schema에서 코드·binding이 없는 Worker 리소스를 확인했어요.
- 모든 코드 배포를 Terraform으로 하면 관리 도구는 하나지만 API 배포가 backend·provider 적용에 묶여요.
  현재 요구에서는 인프라 변경과 API 배포를 독립적으로 실행하는 편이 맞아요.
  코드 필드만 `ignore_changes`로 숨기는 대신 코드 관리 기능이 없는 리소스로 바꿔 책임을 나눴어요.
- 로컬 수동 명령만 문서화하면 작업은 줄지만 SHA·검사·migration·배포 확인을 빠뜨리기 쉬워요.
  [GitHub 수동 workflow](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)로 실행 절차를 고정해요.
- [Terraform S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3)는 `use_lockfile`을 지원하고,
  [R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/)는 조건부 PutObject를 원자적으로 처리한다고 명시해요.
  기존 state 저장소가 없어 같은 Cloudflare 계정의 R2를 기본으로 준비해요. 새 state 서비스를 별도 공급자에 추가하지 않아요.
- 공유 state를 runner의 임시 파일이나 Git에만 보관하면 후속 실행과 동시 적용을 안전하게 관리하기 어려워 채택하지 않았어요.

## 가정·한계와 영향

원격 Terraform state·리소스는 이번 작업에서 만들지 않았어요. 따라서 기존 Worker state를 옮기는 작업은 실행하지 않았어요.
이미 이전 코드로 리소스를 생성한 환경이 있다면 새 root를 적용하기 전에 state·import를 확인해야 해요.
Cloudflare·R2 활성화, 계정·토큰·버킷 자격증명, GitHub production 환경은 [배포 가이드](../deployment.md)의 선행 설정이에요.
무료 운영·R2 backend 호환성·실제 state 잠금·배포 성공을 로컬 schema나 fixture 테스트만으로 보장하지 않아요.
현재 배포 확인은 health·404와 revision까지예요. 제품 인증·요약·저장의 전체 경로는 기능별로 확장해요.
DB migration은 코드 롤백과 분리돼요. 실패 시 DB를 자동 복구하지 않으며 이전 Worker와 호환되게 변경해야 해요.

## 검증과 재검토 조건

배포 보조 로직은 성공한 main CI만 허용하고 미완료·실패·PR·다른 SHA·더 오래된 성공으로 우회하는 경우를 거부해요.
로컬 설정 보존, placeholder D1 거부, 이전 revision의 health 거부와 JSON 404를 테스트해요.
API의 workerd 테스트, 두 Terraform root의 schema·backend 설정, actionlint와 전체 검사를 실행해요.

2026-10-24 macOS arm64에서 확인한 결과예요.

- workerd 테스트 5개·Bun 도구 테스트 14개와 `mise run check`를 통과했어요. Android는 변경되지 않은 입력의 Gradle cache를 재사용했어요.
- actionlint 1.7.12로 세 workflow를 검사했어요.
- workflow의 실제 Bash preflight를 로컬 Git·GitHub 응답 fixture로 실행했어요. 성공한 main 커밋만 통과하고 미머지 SHA·다른 ref·실패한 CI·잘못된 SHA는 차단됐어요.
- fixture 배포 설정의 dry-run과 로컬 workerd HTTP를 확인했어요. health JSON을 유지하면서 fixture revision 헤더가 반영됐어요. 실제 원격 배포 증거는 아니에요.
- Worker 번들 디렉터리를 임시로 분리한 상태에서도 `infra:check`가 통과했어요. 두 root의 원격 state는 만들지 않았어요.

원격 token·R2·GitHub 환경 설정 뒤 수동 plan·apply·최초 배포·재배포·잠금과 실패 경로를 해당 SHA에서 확인해야 해요.
state 저장·잠금에 호환 문제가 있거나 팀이 다른 backend를 채택하면 이 결정을 재검토해요.

## 반론과 변경 이력

- 2026-10-24: 매 API 배포마다 Terraform plan/apply를 실행할 필요가 있는지 재검토했어요.
  API 배포와 인프라 적용의 실행·관리 범위를 분리하는 방향을 승인받아 ADR-0008의 해당 부분을 대체했어요.
