# ADR-0008: 로컬 Workers·D1을 검증하고 원격 인프라는 Terraform으로 정의해요

- 상태: 대체. 원격 인프라·배포 결정은 [ADR-0009](0009-manual-deployment-ownership.md)를 따라요. 로컬 Workers·D1 기반은 유지해요.
- 작성·확정일: 2026-10-24
- 확정 근거: #4 구현 범위 안의 실행·검사 판단과 사용자의 Terraform 우선 지시에 따라 정했어요.
- 관련 기록: [ADR-0001](0001-workers-d1-free-tier.md), [ADR-0003](0003-shared-modules-sync-async.md)
- 구현·검증 상태: 로컬 Worker·D1과 Terraform 설정을 구현하고 전체 로컬 검사를 통과했어요.
  커밋·원격 CI·원격 plan·리소스 생성·배포·Android 기기 실행은 별도예요.

## 문제와 현재 상태

[#4](https://github.com/ted-workshop/user-interface-ssu/issues/4)는 Workers·D1의 실제 로컬 실행과 재현 가능한 검사를 요구해요.
기존 `Bun.serve`와 Bun 안의 Hono 테스트만으로는 이 실행 환경을 검증하지 못했어요.
새 workerd 테스트에 기존 진입점을 연결하면 `ReferenceError: Bun is not defined`로 실패하는 것을 확인했어요.
Android 개발 연결은 `127.0.0.1:3000`의 기존 health JSON·404·오류 비노출 계약을 유지해야 해요.

## 결정

- Hono 앱을 하나의 ES module Worker로 export하고 `Bindings: Env`를 사용해요.
  서버 포트는 Wrangler 설정으로 옮기고 `mise run api:dev`는 `wrangler dev --local`을 실행해요.
- `DB`는 로컬 D1 binding이에요. 0으로 된 ID는 로컬 식별자이며 실제 원격 리소스 ID가 아니에요.
  `0001_initialize.sql`의 `SELECT 1`로 마이그레이션 이력을 시작해요. 제품 스키마는 #8에서 정해요.
- `wrangler types --include-runtime=false`로 작은 환경 타입 파일을 추적하고 `--check`로 불일치를 막아요.
  런타임 타입은 고정한 `@cloudflare/workers-types`로 제공해요. Bun·DOM 타입은 공통 도구 검사에만 둬요.
- API 테스트는 공식 Cloudflare Vitest plugin으로 workerd 안에서 실행해요.
  health·404는 실제 Worker export를 호출하고, 예외·D1 처리는 같은 Hono 앱의 테스트 전용 경로에서 확인해요.
  제품 API에 진단용 DB 경로를 추가하지 않아요. 테스트 DB는 개발 DB와 분리해요.
- Bun workspace·lockfile과 기존 mise 명령은 유지해요. Node.js 24.15.0을 고정해 Wrangler·Vitest를 실행해요.
  Wrangler 4.152.0과 Workers 타입 5.20261019.1, plugin 1.4.7, Vitest 5.0.5를 고정했어요.
  호환 날짜는 설치된 workerd와 같은 `2026-10-19`로 맞춰 로컬 런타임의 날짜 fallback을 피했어요.
- D1·Worker·binding은 [Terraform](../../infra/cloudflare/main.tf)으로 정의해요.
  이름·호환 날짜·flag·observability는 Wrangler 설정을 읽고, 원격 binding은 Terraform D1 resource의 ID를 참조해요.
  Worker 번들 파일과 SHA-256을 함께 전달하고 D1에는 `prevent_destroy`를 둬요.
  Terraform 1.17.0·Cloudflare provider 5.28.1을 고정하고 provider lockfile을 추적해요.
- `infra:check`는 Worker 번들을 만든 뒤 backend 없이 포맷·provider 스키마를 검사해요.
  공유 remote state·대상 계정·공개 라우트와 원격 적용은 #17에서 확정해요. 이번에는 state·원격 리소스를 만들지 않아요.
- CI는 공급자 키 없이 로컬 D1 migration·API·Android·Terraform을 검사하고 세 job을 `quality`에 묶어요.
  Git hook도 인프라 변경에 `infra:check`를 선택해요.

## 근거와 대안

공식 출처 확인 날짜는 2026-10-24예요. 설치한 package 타입·Wrangler schema와 CLI help도 함께 확인했어요.

- [Workers 테스트 지침](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)은
  현재 `@cloudflare/vitest-plugin`과 workerd 실행을 안내해요. 기존 Bun 테스트를 유지하면 도구 추가는 줄지만
  `Bun.serve`의 런타임 오류를 놓치므로 API 테스트를 옮겼어요. 공통 도구 테스트는 Bun을 유지해요.
- [D1 마이그레이션](https://developers.cloudflare.com/d1/reference/migrations/)과
  [D1 테스트 API](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/#d1)를 사용해요.
  임시 제품 테이블이나 DB 확인 HTTP 경로는 이력 확인에 필요하지 않아 추가하지 않았어요.
- [생성 타입](https://developers.cloudflare.com/workers/languages/typescript/#generate-types)은 설정과 binding을 연결해요.
  전체 런타임 선언도 생성할 수 있지만 기존 코드가 작은 저장소에서는 환경 선언만 추적하고
  고정한 런타임 타입 의존성으로 나누는 편이 생성 diff를 줄여요. 수동 Env 선언은 설정과 어긋날 수 있어 쓰지 않아요.
- [Workers 권장 방식](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)에 맞춰
  Node 호환 flag와 observability를 설정해요. 새 날짜로 올릴 때는 workerd·타입·테스트를 함께 갱신해요.
- [Cloudflare provider의 Worker](https://registry.terraform.io/providers/cloudflare/cloudflare/5.28.1/docs/resources/workers_script)와
  [D1](https://registry.terraform.io/providers/cloudflare/cloudflare/5.28.1/docs/resources/d1_database) 정의를 사용해요.
  Wrangler만으로 원격 리소스를 관리하면 파일은 줄지만 사용자가 선택한 Terraform state 관리와 맞지 않아요.
  같은 리소스를 두 도구에서 배포하는 방식도 소유권과 drift 문제가 있어 채택하지 않았어요.
  SQL은 리소스 수명과 다르므로 Terraform `local-exec` 대신 D1의 migration 이력을 유지해요.

## 가정·한계와 영향

새 worktree의 로컬 DB만 사용했어요. 기존 원격 리소스와 제품 데이터는 조회하거나 변경하지 않았어요.
신규 제품 기능·테이블·비밀값도 만들지 않았어요.
health는 DB 상태와 독립적으로 기존 JSON을 반환해요. SQL 실패의 일반 오류 처리는 workerd 테스트로 확인해요.
Wrangler JSONC는 Terraform `jsondecode`도 읽으므로 주석·trailing comma 없이 유지해요.
실제 원격 적용 전에 공유 state·잠금·인증·기존 리소스 import·무료 한도·도메인·배포 순서를 확인해야 해요.
로컬 D1과 provider 스키마 검사는 실제 Cloudflare 계정·과금·공급자·Android UI 검증이 아니에요.

## 검증과 재검토 조건

- 기존 진입점이 workerd에서 실패하는 경로를 확인한 뒤 Worker 진입점으로 바꿨어요.
- `mise run api:check`: 생성 타입 일치·소스/테스트 타입·5개 workerd 테스트·Worker dry-run·7개 Git hook 테스트가 통과했어요.
- 설정의 binding 이름만 임시로 바꾸면 `types:check`가 타입 불일치를 거부했어요. 원본 설정으로 복구한 뒤 전체 검사를 통과했어요.
- `mise run api:db:migrate`: 새 로컬 DB에 1개 파일을 적용했고, 재실행은 `No migrations to apply`였어요.
  `d1_migrations`에서 `0001_initialize.sql` 1개를 읽었고 Worker 재시작 뒤에도 유지됐어요.
- `mise run api:dev`: 3000 포트의 프로세스가 workerd인 것을 확인하고 health 200·JSON 404를 요청했어요.
  종료 시 연결 실패, 재시작 후 동일한 health JSON을 확인했어요. HTTP probe 출력은 Git에서 제외한 `.artifacts/issue-4/probe-output.txt`에 있어요.
- `mise run infra:check`: Terraform 포맷·provider lockfile·스키마 검사가 통과했어요. state 파일은 만들지 않았어요.
- macOS arm64·Bun 1.4.2·Node.js 24.15.0·OpenJDK 25.0.2·Android SDK 37.0에서 `mise run check`를 통과했어요.
  Android Spotless·Lint·JVM 단위 테스트·debug APK 빌드는 성공했어요. `git diff --check`와 수정한 Markdown의 로컬 링크도 확인했어요.

인증·요약·영구 제품 저장·원격 CI·원격 plan·배포·기기 UI는 검증하지 않았어요.
타입 생성·로컬 D1·provider 스키마가 달라지거나 단일 번들 외 module·asset이 필요해지면 이 배포 정의를 재검토해요.
공유 state와 실제 적용을 정할 때는 #17의 결정에 연결하고, 이 기록의 당시 근거는 유지해요.

## 반론과 변경 이력

- 2026-10-24: API 배포를 매번 Terraform으로 적용하는 대신 Wrangler의 수동 workflow로 분리하기로 했어요.
  원격 인프라·공유 state·배포의 현재 결정은 ADR-0009에 남기고 아래 당시 선택과 검증은 보존해요.
- 2026-10-24: Terraform으로 관리 가능한 부분을 Terraform으로 관리하라는 지시를 반영했어요.
  원격 리소스 정의와 로컬 개발·SQL migration의 책임을 구분했어요. 원격 적용 범위로 확대하지 않았어요.
