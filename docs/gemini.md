# YouTube 영상 요약의 공급자 검증

공식 SDK의 Agentic Video 입력으로 한국어 리포트를 생성하는 공통 함수와 수동 검증 도구를 제공해요.
선택한 범위와 대안은 [ADR-0014](decisions/0014-gemini-video-verification.md)에 있어요.
제품의 요약 HTTP API·영속 작업·Android 화면은 아직 없어요.

## 현재 설정

검증 모델은 `gemini-3.6-flash`, 시간 제한은 180초예요.
로컬 검증 키는 Git에서 제외한 `credentials.json`에 `0600` 권한으로 보관해요.

운영 원본은 GitHub `production` Environment에서 관리해요. API 키는 `GEMINI_API_KEY` Secret,
모델은 `GEMINI_MODEL` Variable로 두고 수동 배포 때 Worker에 전달해요.
2026-10-27 키와 모델을 등록하고 Secret 이름·갱신 시각과 모델 값을 다시 조회했어요.
Worker에서 공통 함수를 호출할 때는 `env.GEMINI_API_KEY`·`env.GEMINI_MODEL`을 `apiKey`·`model`에 전달해요.
이 계약은 workerd에서 검사했으며 제품 요약 HTTP 호출부는 후속 범위예요.
로컬 Wrangler의 모델 값은 개발용이며 운영 배포는 GitHub Variable을 요구해요. 누락되면 배포 전에 실패해요.
GitHub 설정을 바꾼 뒤의 실제 Worker 반영은 별도 수동 배포가 필요해요. [운영 설정 결정](decisions/0015-gemini-production-settings.md)에 범위와 검증을 구분해요.

2026-10-27 사용자가 현재 사용량 초과를 확인했다고 알려 추가 공급자 호출을 멈췄어요.
현재 잔여량과 초기화 시각은 별도로 확인하지 않았고,
사용량 회복을 확인한 뒤 새 기록 ID로 실제 영상 검증을 재개해요. 아래 교체 키의 403은 이전 실측 기록이에요.

## 공급자 검증 기록

2026-10-27 macOS arm64·Bun 1.4.2·`@google/genai` 2.31.0과 `gemini-3.6-flash`를 사용했어요.
키는 Git에서 제외한 개인 파일로 읽고, 키 변경 뒤에도 같은 모델로 재검증했어요.
각 명령은 자동 재시도 없이 한 번만 Gemini를 호출했어요.

| 기록 ID | UTC 시작 시간 | 전체 시간 | 실제 결과 |
| --- | --- | --- | --- |
| `zoo-1027a` | 2026-10-27 01:33:05.474 | 667ms | HTTP 429, `quota` |
| `zoo-quota-1027a` | 2026-10-27 01:34:20.784 | 654ms | HTTP 429, `quota` |
| `zoo-quota-details-1027a` | 2026-10-27 01:35:03.360 | 655ms | HTTP 429, `quota`, 위반 수치 없음 |
| `zoo-new-key-1027a` | 2026-10-27 01:41:04.571 | 1,016ms | 교체한 키에서도 HTTP 429, `quota` |
| `zoo-rekey-1027b` | 2026-10-27 01:59:11.235 | 666ms | 키 재입력 후 HTTP 403, `configuration` |
| `zoo-rekey-auth-1027b` | 2026-10-27 02:00:54.383 | 619ms | HTTP 403, 무료 티어 사용 불가 안내 확인 |

표본은 [Me at the zoo](https://www.youtube.com/watch?v=jNQXAC9IVRw)예요.
[YouTube oEmbed 응답](https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DjNQXAC9IVRw&format=json)에서
제목 `Me at the zoo`와 채널 `jawed`를 확인했어요. 이 조회 성공이 Gemini의 영상 접근 성공을 뜻하지는 않아요.
전체 시간은 메타데이터 조회와 공급자 응답까지 포함하며 요약 완료 시간이 아니에요.

영상 요청에서 요약 본문·토큰 사용량은 반환되지 않았어요. 계정의 한도·잔여량·실제 비용은 `null`이에요.
앞선 429 응답에는 구체적인 한도 위반 수치가 없었고 AI Studio도 로그인 화면이어서 RPM·TPM·RPD를 확인하지 못했어요.
일일 한도 소진이나 무료 할당량 0으로 단정하지 않아요. **#5의 실제 요약 성공·원본 대조는 미완료예요.**

추가로 교체한 키에서 같은 모델의 짧은 텍스트 입력과 최소 영상 입력을 각각 한 번 비교했어요.
텍스트 진단은 UTC 01:42:06.292 시작, 1,507ms 뒤 `incomplete`였어요. 출력 상한을 32토큰으로 둔 요청이며,
응답 사용량은 입력 12·생각 29·출력 0·합계 41토큰이에요. 이를 완성된 답변이나 영상 요약 성공으로 세지 않아요.
최소 영상 진단은 UTC 01:43:35.016 시작, 460ms 뒤 HTTP 429였어요. 영상과 한국어 한 문장 요청만 넣고 출력 상한은 512토큰으로 뒀어요.
따라서 긴 리포트 프롬프트를 제거해도 같은 실패를 관찰했어요. 텍스트 처리와 영상 입력의 차이는 확인했지만,
영상 입력 한도·프로젝트 한도·공급자 일시 제한 중 무엇이 원인인지는 응답에 근거가 없어 미확정이에요.

키를 다시 입력한 뒤의 영상 요청은 두 번 모두 HTTP 403이었어요. 같은 설정으로 모델 메타데이터를 조회하면
UTC 02:00:11.046 시작, 223ms 뒤 `models/gemini-3.6-flash`를 읽을 수 있었어요.
하지만 실제 생성 요청의 403 응답에는 무료 티어 사용 불가 안내가 있었어요.
진단 기록의 `matchedCauses: ["free_tier_unavailable"]`는 오류 문구에서 분류한 로컬 값이며 Google의 공식 reason 코드가 아니에요.
키·계정 식별자·오류 원문은 기록하지 않았어요. 이 결과를 이전 키들의 429 원인으로 소급하지 않아요.

2026-10-27 확인한 [Google의 무료 티어 제한 안내](https://ai.google.dev/gemini-api/docs/troubleshooting#gemini-api-free-tier-unavailability)는
프로젝트별 이용 자격을 평가하므로 같은 프로젝트에서 키를 새로 만들어도 해결되지 않는다고 설명해요.
해당 프로젝트로 계속하려면 결제 계정을 연결한 유료 티어가 필요하며, 무료 운영을 유지하려면 이용 자격이 있는 프로젝트가 필요해요.
메타데이터 조회 성공은 생성 요청의 이용 자격·과금 상태를 검증하지 않는다고도 안내해요.
계정·결제·모델은 바꾸지 않았어요. 현재는 선택한 키의 사용량 회복을 확인한 뒤 실제 리포트를 만들고 원본과 대조하는 검증이 남아 있어요.

개인 실행의 원본 기록은 `apps/api/.artifacts/gemini/<기록-ID>.json`, 합친 출력은 같은 디렉터리의
`probe-output.txt`에 있어요. Git에는 키와 개인 실행 파일을 넣지 않아요. 위 표는 그 기록에서 비밀값 없이 옮긴 실측이에요.
진단 기록은 같은 디렉터리의 `text-diagnostic-1027a.json`, `minimal-video-diagnostic-1027a.json`에 따로 보관해요.
재입력 뒤의 진단은 `model-metadata-rekey-1027b.json`, `inference-auth-diagnostic-1027b.json`에 보관해요.

## 다시 실행하기

저장소에서 `mise run setup`을 완료한 뒤 개인 설정 파일을 준비해요.

```sh
umask 077
mkdir -p apps/api/.artifacts/gemini
```

`apps/api/.artifacts/gemini/credentials.json`을 로컬 편집기로 만들어요. 아래는 형식 예시예요.
실제 키를 명령 인자·채팅·PR·Android 리소스에 넣지 않아요.
이 파일은 수동 공급자 검증용이에요. GitHub Secret의 값을 내려받는 기능은 없으며 운영 설정과 별도로 시험할 모델을 명시해요.

```json
{
  "apiKey": "개인 Gemini API 키",
  "model": "gemini-3.6-flash",
  "timeoutMs": 180000
}
```

```sh
chmod 600 apps/api/.artifacts/gemini/credentials.json
mise exec -- bun run --cwd apps/api summary 'https://www.youtube.com/watch?v=jNQXAC9IVRw' zoo-next
```

모델은 명시한 값으로 고정해요. 기본 시간 제한은 180초이며 허용 범위는 1~600초예요.
출력은 4,096토큰으로 제한해요. 공급자 상태와 무관하게 다른 모델로 바꾸거나 자동 재시도하지 않아요.
시점이 붙은 입력도 영상 전체를 처리해요.

명령 출력은 기록 ID·상태·결과 파일·전체 시간이에요. 성공 시 종료 코드 0, 실패 시 1이에요.
동일 ID의 결과·중단 기록이 있으면 요청 전에 거부해요. 이전 기록을 지우지 말고 원인을 확인한 뒤 새 ID를 사용해요.
중단 또는 결과 파일 저장 실패가 생겼다면 공급자 호출이 이미 실행됐을 수 있어요.

## 결과와 원본 대조

- `generated`는 형식을 갖춘 본문을 받은 상태예요. 내용의 정확성·영상 전체 분석·시간 링크 검증 완료를 뜻하지 않아요.
- `video`의 제목·채널과 `metadataSource`를 먼저 확인해요. 길이·공개 상태·라이브 상태는 oEmbed만으로 판단하지 않아요.
- `report`에는 실제 응답 모델·interaction ID·생성 시간·Markdown과 공급자 토큰 수를 담아요.
  입력·출력·생각·도구·캐시·합계는 독립된 응답 필드예요. 누락을 0으로 바꾸거나 합계를 임의로 다시 계산하지 않아요.
- `timestampVerification`은 항상 `unverified`예요. 원본 재생과 자막을 열고 주장·수치·각 링크의 시점을 대조해요.
  확인한 URL·구간·주장·결과를 별도 검토 기록에 남겨요. 확인하지 못한 시점은 결과에서 빼고 추측해 보충하지 않아요.
- 영상에 없는 배경 지식·주장을 섞었는지, 짧은 영상의 내용을 부풀렸는지, 한국어로 읽을 수 있는지 확인해요.
  자동 검사와 사람의 원본 대조 결과를 구분해 남겨요.

## 실패와 지원 범위

| reason | 확인할 내용 |
| --- | --- |
| `invalid_url` | 명령 인자와 허용된 YouTube 영상 주소를 확인해요. 외부 요청은 하지 않아요. |
| `configuration` | 키·모델·시간 제한과 계정 접근 권한을 확인해요. |
| `metadata_unavailable` | oEmbed의 HTTP 상태와 영상 접근을 따로 확인해요. 삭제·비공개로 단정하지 않아요. |
| `quota` | HTTP 429예요. 실제 모델별 한도·사용량·공급자 상태를 확인해요. `quotaViolations`가 있으면 초과 항목만 참고해요. |
| `temporary`·`timeout` | 공급자·네트워크·시간 제한을 확인해요. 중단이 공급자 과금 취소를 보장하지는 않아요. |
| `unknown` | HTTP 상태를 확인할 수 없는 오류예요. SDK·네트워크·호출 경로를 확인하고 일시 장애로 단정하지 않아요. |
| `provider_rejected` | 모델·입력 지원과 요청 조건을 확인해요. HTTP 400·404를 영상 미지원으로 단정하지 않아요. |
| `invalid_response` | 응답이 미완료·빈 본문·리포트 형식 누락이에요. 반환된 사용량이 있으면 보존해요. |

정규화·입력 거부와 가짜 응답의 성공/실패는 CI에서 검사해요. 실제 지원 범위와 달라요.
공개 영상의 성공, Shorts, 종료 라이브, 긴 영상, 영상에 근거한 시간 링크, Workers에서의 실제 공급자 호출은 아직 미검증이에요.
비공개·삭제·로그인 필요·진행 중인 생방송은 [초기 제품 범위](qletter/02-functional-spec.md)에서 제외해요.

2026-10-27 확인한 [Google 영상 입력 문서](https://ai.google.dev/gemini-api/docs/video-understanding)는
공개 YouTube URL 입력이 preview이고 무료 플랜의 하루 영상 입력 길이 제한은 8시간이라고 설명해요.
이것은 이 키의 실제 사용 가능량이나 모델 호출이 무료라는 증거가 아니에요.
[프로젝트 한도 문서](https://ai.google.dev/gemini-api/docs/rate-limits)와 해당 계정의 AI Studio에서
RPM·TPM·RPD·현재 사용량·과금 플랜을 확인한 뒤 정책을 정해요.

## 로컬 검사

```sh
mise run api:check
```

workerd에서 실제 SDK에 가짜 HTTP 응답을 주는 검사와 Bun의 파일·명령 검사를 실행해요.
CI에는 키가 필요하지 않고 실제 Gemini를 호출하지 않아요. 공급자 검증은 위 명령을 수동으로 별도 실행해요.
