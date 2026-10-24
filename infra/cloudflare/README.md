# Cloudflare 인프라

D1과 Worker 자체의 생성은 Terraform이 담당해요. Worker 코드·binding·호환 날짜·observability와 배포는 Wrangler가 담당해요.
Terraform은 Wrangler 설정에서 Worker·DB 이름만 읽어요. 해당 JSONC 파일은 주석·trailing comma가 없는 JSON으로 유지해요.

저장소 루트에서 검사해요.

```sh
mise run infra:check
```

state 버킷과 애플리케이션의 두 Terraform root를 포맷·`init -backend=false`·`validate`로 검사해요.
Worker 번들·Bun 의존성·Cloudflare 토큰·원격 state 없이 실행할 수 있어요. provider 다운로드에는 네트워크를 사용해요.
provider 버전을 의도적으로 갱신할 때는 각 root의 `terraform init -backend=false -upgrade` 후 아래 명령으로 개발 환경과 CI의 체크섬을 함께 기록해요.

```sh
for qletter_tf_root in infra/state infra/cloudflare; do
  mise exec -- terraform -chdir="$qletter_tf_root" providers lock \
    -platform=darwin_arm64 -platform=darwin_amd64 \
    -platform=linux_amd64 -platform=windows_amd64
done
```

`init`이 현재 OS의 `h1`만 추가한 상태에서는 다른 OS의 `validate`가 실패할 수 있어요.
두 lockfile을 함께 커밋하고, CI의 `-lockfile=readonly`는 유지해요.

반복 적용은 `Terraform Infrastructure` workflow를 수동 실행해요. API 배포 workflow에서는 Terraform을 실행하지 않아요.
R2의 S3 backend와 lockfile을 사용하고, API 배포와 인프라 적용은 같은 GitHub concurrency group을 사용해요.
state 버킷의 최초 생성·state 이전, 계정·토큰·GitHub 설정은 [배포 가이드](../../docs/deployment.md)를 따라요.

D1과 state 버킷에는 `prevent_destroy`를 둬요. 기존 원격 리소스가 있다면 첫 적용 전에 import 여부를 확인해요.
처음 생성한 D1 ID는 Terraform output으로 확인해 GitHub의 `CLOUDFLARE_D1_DATABASE_ID` 변수에 등록해요.
SQL 마이그레이션은 API 배포 workflow에서 Wrangler로 적용해요. Terraform `local-exec`이나 Worker 버전 리소스를 추가하지 않아요.
커스텀 도메인·메일·Workflows는 이번 구성에 포함하지 않았어요. 필요할 때 해당 리소스를 추가해요.
판단 근거는 [ADR-0009](../../docs/decisions/0009-manual-deployment-ownership.md)에 있어요.
