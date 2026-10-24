# API 배포와 인프라 적용

CI는 PR·main push에서 자동 실행해요. API 배포와 인프라 적용은 각각 GitHub Actions에서 수동 실행해요.
두 workflow는 기본 브랜치에 반영돼야 Run workflow 버튼이 나타나요.
현재는 설정과 로컬 검사까지이며 원격 리소스·GitHub 환경·비밀값을 생성하거나 실제 배포하지 않았어요.

## 관리 범위

- Terraform: D1, Worker 자체의 생성, 공유 state를 저장할 R2 버킷이에요.
- Wrangler: Worker 코드·binding·런타임 설정, SQL 마이그레이션과 API 배포예요.
- `quality.yml`: 키 없이 변경 파일의 범위에 따라 API·로컬 D1·Android·Terraform을 검사해요. 선택한 검사와 최종 `quality`의 성공을 확인해요.

API 코드를 바꿀 때 Terraform plan/apply는 필요하지 않아요.
Terraform의 `cloudflare_worker`에는 버전·코드·binding을 선언하지 않아서 API 배포를 이전 코드로 되돌리지 않아요.
커스텀 도메인은 아직 정의하지 않았으며 초기 API 주소는 계정의 `workers.dev` URL을 사용해요.

## 처음 한 번 준비하기

Cloudflare 계정에서 Workers와 R2 사용 가능 여부를 확인하고 계정의 `workers.dev` 주소를 준비해요.
아래 환경변수는 로컬의 비공개 설정으로 제공해요. 실제 값을 문서·tfvars·Git에 넣지 않아요.

| 변수 | 용도 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | 사용할 Cloudflare 계정 ID |
| `CLOUDFLARE_API_TOKEN` | 대상 계정의 Worker·D1 및 최초 R2 버킷 생성 권한 |
| `TF_STATE_BUCKET` | state 버킷 이름, 기본 이름은 `qletter-terraform-state` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | 해당 R2 버킷의 Object Read & Write용 S3 자격증명 |

공유 state 저장소가 없으므로 버킷은 한 번만 로컬 Terraform state로 만들어요.

```sh
export TF_VAR_account_id="$CLOUDFLARE_ACCOUNT_ID"
export TF_VAR_state_bucket="$TF_STATE_BUCKET"
mise exec -- terraform -chdir=infra/state init -input=false -lockfile=readonly
mise exec -- terraform -chdir=infra/state plan -out=bootstrap.tfplan
mise exec -- terraform -chdir=infra/state apply bootstrap.tfplan
```

버킷이 생성되면 이 버킷에 접근하는 R2 S3 자격증명을 준비하고 bootstrap state도 원격으로 옮겨요.

```sh
cp infra/state/backend.tf.example infra/state/backend.tf
mise exec -- terraform -chdir=infra/state init -migrate-state \
  -backend-config="bucket=$TF_STATE_BUCKET" \
  -backend-config="endpoints={s3=\"https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com\"}"
mise exec -- terraform -chdir=infra/state state list
```

이전이 성공하기 전에는 로컬 state를 보관해요. state·plan·생성한 `backend.tf`는 Git에서 제외해요.
새 checkout에서 버킷을 관리할 때는 `backend.tf`를 먼저 복사하고 같은 backend 설정으로 초기화해요.
기존 버킷이 있으면 다시 만들지 않고 기존 state와 import 필요 여부를 확인해요.
실제 R2 인증·state 저장·잠금 동작은 대상 계정에서 별도로 검증해야 해요.

## GitHub production 환경

저장소 Settings의 Environments에 `production`을 만들고 허용 배포 브랜치를 `main`으로 제한해요.
해당 환경에 다음 값을 등록해요.

| 종류 | 이름 | 값 |
| --- | --- | --- |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | 대상 계정 ID |
| Variable | `TF_STATE_BUCKET` | 위에서 만든 R2 버킷 이름 |
| Variable | `CLOUDFLARE_D1_DATABASE_ID` | 최초 인프라 적용 후 output의 `database_id` |
| Variable | `QLETTER_API_URL` | 경로·query가 없는 HTTPS API origin |
| Secret | `CLOUDFLARE_API_TOKEN` | Worker·D1 관리용 Cloudflare API token |
| Secret | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | state 버킷 전용 S3 자격증명 |

API 배포 job에는 R2 자격증명을 전달하지 않아요. 인프라 job만 공유 state를 읽고 써요.
초기 D1 ID는 아래 인프라 적용에서 확인할 수 있어요. 최초 API 배포 전에 등록해요.

## 인프라를 바꿀 때

1. 변경을 PR로 검토하고 `quality`가 성공한 뒤 main에 반영해요.
2. Actions → Terraform Infrastructure → Run workflow에서 main을 선택해요.
3. `operation=plan`으로 변경을 확인해요. 적용할 때는 `operation=apply`로 실행해요.
4. apply 실행은 plan을 다시 만들고 그 실행에서 저장한 plan 파일만 적용해요. 이전 plan 실행의 승계는 아니에요.
5. 첫 적용 후 summary의 D1 ID를 `CLOUDFLARE_D1_DATABASE_ID`에 등록해요.

Worker와 D1을 먼저 만든 뒤 API를 배포해요. 인프라 workflow는 Worker 코드를 배포하지 않아요.
R2 state에는 S3 lockfile을 사용하고 API 배포와 인프라 적용은 같은 concurrency group으로 동시에 실행되지 않게 해요.
`operation=plan`은 원격 변경을 적용하지 않지만 state 읽기·잠금·공급자 조회 권한이 필요해요.

## API를 배포할 때

1. Actions → Deploy API → Run workflow에서 main을 선택해요.
2. `sha`에 main에 포함된 40자리 SHA를 넣어요. 비우면 실행 시점의 최신 main을 선택해요.
3. 해당 SHA의 최신 main push Quality 실행이 성공했는지 확인하고 같은 SHA를 checkout해요.
4. API 검사와 실제 D1 ID·SHA를 넣은 배포 설정의 dry-run이 통과하면 원격 D1 migration을 적용해요.
5. Wrangler로 Worker를 배포하고 tag·message에 해당 SHA를 기록해요.
6. health 200·동일한 revision 헤더·JSON 404를 확인한 뒤 summary에 SHA와 URL을 남겨요.

`apps/api/wrangler.deploy.json`은 이 실행에서만 생성해요. 로컬 DB ID와 `BUILD_REVISION=local` 설정은 변경하지 않아요.
상태 확인이 실패하면 배포 job은 실패해요. 응답이 200이어도 이전 SHA가 응답하면 성공으로 처리하지 않아요.
현재 검증은 health·404까지이며 인증·요약·사용자별 저장의 전체 경로 검증은 기능 구현 후 추가해요.

DB 변경은 이전 Worker도 사용할 수 있도록 작성해요. migration 성공 뒤 배포가 실패해도 DB를 자동으로 되돌리지 않아요.
이전 SHA 재배포 역시 DB를 되돌리지 않으므로 해당 스키마와 코드의 호환성을 확인해요.
배포·인프라 workflow는 실행 중인 다른 배포를 자동 취소하지 않아요.

## 로컬 검사

```sh
mise run api:check
mise run infra:check
mise run check
git diff --check
```

workflow 문법은 actionlint 1.7.12로 확인했어요. 로컬 테스트의 GitHub 실행 정보와 HTTP 응답은 fixture이며 실제 배포 증거가 아니에요.
구조 선택과 대안은 [ADR-0009](decisions/0009-manual-deployment-ownership.md)에 있어요.
