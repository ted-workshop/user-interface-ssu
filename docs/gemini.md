# YouTube 영상 요약의 공급자 검증

공식 SDK의 `interactions.create`에 공개 YouTube URL을 Agentic 입력으로 전달해 한국어 리포트를 요청해요.
프롬프트·생성 설정·후처리 복원은 [ADR-0017](decisions/0017-report-generation-parity.md)에 있어요.
직접 요약 HTTP API와 영속 실행기는 [ADR-0024](decisions/0024-direct-summary-http.md)에 따라 연결했어요.
현재 설정의 실제 생성 성공·원본 대조와 Android 화면 연결은 아직 검증하지 못했어요.

## 현재 설정

운영·검증 모델은 `gemini-3.8-flash`(ADR-0029), 기본 시간 제한은 600초예요. 2026-11-03 이전 기록은 `gemini-3.6-flash`예요.
로컬 검증 키는 Git에서 제외한 `credentials.json`에 `0600` 권한으로 보관해요.

운영 원본은 GitHub `production` Environment에서 관리해요. API 키는 `GEMINI_API_KEY` Secret,
모델은 `GEMINI_MODEL` Variable로 두고 수동 배포 때 Worker에 전달해요.
2026-10-27 키와 모델을 등록하고 Secret 이름·갱신 시각과 모델 값을 다시 조회했어요.
Worker에서 공통 함수를 호출할 때는 `env.GEMINI_API_KEY`·`env.GEMINI_MODEL`을 `apiKey`·`model`에 전달해요.
이 계약은 workerd에서 검사했고, 제품 요약 HTTP는 영속 실행기를 거쳐 같은 공통 함수를 호출해요.
이 연결의 로컬 fixture 검사를 배포된 Worker의 공급자 성공으로 보지 않아요.
로컬 Wrangler의 모델 값은 개발용이며 운영 배포는 GitHub Variable을 요구해요. 누락되면 배포 전에 실패해요.
GitHub 설정을 바꾼 뒤의 실제 Worker 반영은 별도 수동 배포가 필요해요. [운영 설정 결정](decisions/0015-gemini-production-settings.md)에 범위와 검증을 구분해요.

2026-10-27 기존 리포트와 동일하게 프롬프트 원문·Interactions Agentic·SDK 기본 설정·후처리를 복원했어요.
축약 프롬프트·180초 기한·4,096토큰 상한·무재시도 설정은 현재 설정이 아니에요.
2026-10-27 복원 뒤의 실제 영상 요청은 34,220ms 뒤 HTTP 429였고 본문·사용량은 받지 못했어요.
아래 `generateContent` 성공은 다른 생성 조건에서 확인한 과거 실측이에요.
당시 AI Studio에서 확인한 사용량이 로컬 키와 같은 프로젝트·모델인지 미확인이어서 일일 한도 소진으로 단정하지 않았어요.
아래 교체 키의 403은 이전 실측 기록이에요.

## 2026-11-03 재검증과 3.8 Flash 시험

로컬 `credentials.json`의 키와 같은 Interactions·Agentic·600초 기한·SDK 기본 재시도로 다시 실행했어요.
이 파일은 2026-10-30 이후 수정하지 않았어요. 같은 날 GitHub `production`의 `GEMINI_API_KEY`가 새로 등록됐지만
이 실행들은 그 값을 쓰지 않았어요. 새 키가 로컬 파일과 같은지는 확인하지 못했어요.
모델 조회(`models/<이름>`)는 키 인증과 모델 존재만 확인하며 생성 가능 여부의 증거가 아니에요.

| 기록 ID | 모델 | UTC 시작 시간 | 전체 시간 | 결과 |
| --- | --- | --- | --- | --- |
| `video-2lv5x-1103a` | `gemini-3.6-flash` | 2026-11-03 02:07:13.884 | 34,466ms | HTTP 503, `temporary` |
| `zoo-flash36-1103a` | `gemini-3.6-flash` | 2026-11-03 02:25:59.381 | 34,110ms | HTTP 503, `temporary` |
| `zoo-flash38-1103a` | `gemini-3.8-flash` | 2026-11-03 02:26:43.193 | 600,187ms | 응답 없이 `timeout` |

- `gemini-3.6-flash`·`gemini-3.7-flash`·`gemini-3.8-flash`의 모델 조회는 모두 HTTP 200이었고
  `generateContent`를 지원한다고 표시됐어요. 기록 파일의 경과 시간이 34초 안팎이므로 앞선 재검증처럼
  SDK 기본 재시도 5회가 모두 503이었을 가능성이 크지만, 이번 두 실행은 전송 관찰을 켜지 않아 요청 수를 확인하지 못했어요.
### 새 키 재검증과 텍스트 대조

같은 날 GitHub에 새로 등록한 키(로컬 `credentials.json`에 넣어 모델 조회 3.6·3.8 모두 HTTP 200 확인)로 같은 짧은 영상을
Interactions·Agentic으로 요청하고, 영상 없는 텍스트 요청과 비교했어요. 새 키가 GitHub Secret과 같은 값인지는 확인하지 못했어요.

| 기록 ID 또는 요청 | 모델 | 소요 | 결과 |
| --- | --- | --- | --- |
| `zoo-flash38-newkey-1103a` | `gemini-3.8-flash` | 47,168ms | 영상·Agentic, HTTP 503 |
| `zoo-flash36-newkey-1103a` | `gemini-3.6-flash` | 37,854ms | 영상·Agentic, HTTP 503 |
| `zoo-flashlite-newkey-1103a` | `gemini-3.5-flash-lite` | 36,114ms | 영상·Agentic, HTTP 500 |
| 텍스트 한 줄 `generateContent` | `gemini-3.6-flash` | 3.1초 | HTTP 200 |
| 텍스트 한 줄 `generateContent` | `gemini-3.5-flash-lite` | 1.6초 | HTTP 200 |
| 텍스트 한 줄 `generateContent` | `gemini-3.8-flash` | 첫 시도 즉시 | HTTP 503 "high demand" |
| 텍스트 한 줄 `generateContent` | `gemini-3.8-flash` | 1,310초 | 응답 없이 연결 종료(curl 코드 000) |

- 영상·Agentic 요청은 세 모델 모두 실패했고 영상 없는 텍스트 요청은 3.6·3.5 flash-lite에서 성공했어요.
  그래서 키·계정 문제보다 Interactions의 Agentic 영상 경로 쪽이 의심돼요. 다만 원인은 확인하지 못했어요.
- 3.8은 텍스트 요청도 503과 21분 무응답이어서 이번 관찰에서는 가장 불안정했어요. 한 번씩의 관찰이에요.
- 텍스트 요청은 한 번씩만 보냈고, 3.8의 두 텍스트 요청 사이에 몇 분의 간격이 있었어요. 전송 관찰(재시도 횟수)은 켜지 않았어요.

- 시험 당시 3.8 Flash는 `agenticVideoModels` 허용 목록에 없어서 한 줄을 임시로 추가했다가 되돌렸어요.
  사용자는 3.8이 Agentic을 지원하지 않는다고 판단해 3.6 고정을 정했다가, 2026-11-03 확인한
  [영상 이해 문서](https://aistudio.google.com/docs/video-understanding)가 Agentic 지원 모델에 3.8 Flash를
  포함하는 것을 보고("Gemini 4 Argon, 3.8 Flash, 3.6 Flash, 3.5 Flash Lite") 3.8로 가기로 바꿨어요.
  이 변경은 [ADR-0029](decisions/0029-gemini-3-8-flash.md)에 있고 허용 목록과 개발용 기본 모델에 3.8을 추가했어요.
  첫 시험의 600초 시간 초과는 원인을 알지 못한 채 남아 있어요.
- 3.8의 600초 시간 초과는 3.6의 빠른 503과 다른 실패 방식이에요. 한 번의 실행이라 모델 특성이라고 단정하지 않아요.
- 3.6과 3.8의 요금이 같다는 말은 사용자가 전달했어요. 공식 요금표로 확인하지 않았어요.
- 생성 성공·원본 대조가 없으므로 #5는 미완료예요. 기록은 `.artifacts/gemini/`에 `0600`으로 보관해요.

## 2026-10-31 main 반영과 재검증

기존 #5 변경을 보존한 채 작업 트리를 `main`의 `2b84d23`까지 반영했어요.
직접 요약 HTTP·영속 실행기·채널 출처 저장·계정별 하루 3회 정책과 함께 오류 분류 수정을 검증했어요.
`generateReport`의 요청 코드와 프롬프트는 반영 전과 같고, Bun 1.4.4·SDK 2.31.0·
`gemini-3.6-flash`·Interactions·Agentic·600초 기한·SDK 기본 재시도를 유지했어요.

기존 [Me at the zoo](https://www.youtube.com/watch?v=jNQXAC9IVRw) 표본 한 편을 새 기록 ID로 실행했어요.
기존 관찰 스크립트에서 기록 ID만 바꿔 원래 CLI를 호출했고, 요청 옵션과 응답 처리를 변경하지 않았어요.

| 기록 ID | UTC 시작 시간 | 전체 시간 | 실제 생성 요청 수 | 결과 |
| --- | --- | --- | --- | --- |
| `zoo-recheck-1031a` | 2026-10-31 05:50:44.196 | 37,740ms | 5 | 모두 HTTP 503, `service_unavailable` |

다섯 응답 모두 `Retry-After: 30`이었어요. CLI의 실패 분류는 `temporary`이며 본문·사용량은
반환되지 않았고 `quota`·`cost`는 `null`이에요. 이 응답 뒤 별도의 생성 명령을 실행하지 않았어요.
제품 영속 실행기는 SDK의 최종 5xx를 `provider_outcome_unknown`으로 보존하므로,
CLI의 `temporary` 분류가 제품 작업의 자동 재실행 허용을 뜻하지 않아요.
이번 실행은 로컬 CLI이며 실제 Worker·D1 제품 경로의 실행 결과는 아니에요.

2026-10-31 확인한 [영상 입력 문서](https://ai.google.dev/gemini-api/docs/video-understanding#agentic-video-understanding)는
Gemini 3.6 Flash의 Agentic 영상 처리를 지원하며, `background` 없이 동기 실행할 수 있다고 설명해요.
[공식 오류 문서](https://ai.google.dev/gemini-api/docs/api-errors)는 `service_unavailable`을
공급자의 일시적 과부하 또는 가용성 문제로 설명해요. 이번 응답만으로 구체적인 공급자 내부 원인,
장애 범위·복구 시점·프로젝트 잔여량을 확인할 수 없어요. 영상 미지원이나 한도 소진으로 단정하지 않아요.

결과와 응답 관찰은 `.artifacts/gemini/zoo-recheck-1031a.json`과
`zoo-recheck-1031a-transport.json`에 `0600`으로 보관해요. 기존 키·관찰 스크립트·실행 기록을
그대로 보존했어요. 현재 설정의 생성 성공·원본 주장·시간 링크 대조가 없어 #5는 미완료예요.
로컬 회귀·전체 검사 결과와 최초 검사 실패의 원인은 [ADR-0017](decisions/0017-report-generation-parity.md)에 남겨요.

## 2026-10-30 재검증

`37fea11` 기반 작업 트리에서 Bun 1.4.4·SDK 2.31.0·`gemini-3.6-flash`를 사용했어요.
프롬프트 해시는 ADR-0017과 같고, Interactions·Agentic·600초 기한·SDK 기본 재시도를 유지했어요.
이번 코드 수정은 공급자 오류 해석에 한정돼요. 운영 모델 Variable도 같은 값임을 다시 확인했어요.

첫 입력 키의 모델 조회는 HTTP 400·`API_KEY_INVALID`였어요. 키 오류 진단과 수정 검증에서
생성 엔드포인트에 보낸 요청 5회도 모두 HTTP 400이었어요. 마지막 `invalid-key-regression-1030a`는
UTC 01:31:38.015 시작이며 수정한 코드가 이를 `configuration`으로 기록했어요.
이는 잘못된 키의 오류 분류 검증이고, 영상 처리 성공의 증거는 아니에요.

교체한 키의 같은 모델 조회는 UTC 01:29:57.962 시작, 486ms 뒤 HTTP 200이었어요.
이후 같은 생성 설정으로 다음 두 영상을 확인했어요.

| 기록 ID | 영상 ID | UTC 시작 시간 | 전체 시간 | 실제 생성 요청 수 | 결과 |
| --- | --- | --- | --- | --- | --- |
| `report-recheck-1030b` | `2lv5xHjLx1c` | 2026-10-30 01:30:10.101 | 69,269ms | 5 | 모두 HTTP 503, `service_unavailable` |
| `zoo-recheck-1030a` | `jNQXAC9IVRw` | 2026-10-30 01:32:05.853 | 34,035ms | 5 | 모두 HTTP 503, `service_unavailable` |

명령 2회와 실제 생성 요청 10회를 구분해요. 각 응답의 `Retry-After`는 30초였고,
원래 함수를 호출하는 로컬 관찰 스크립트가 응답 상태·허용한 오류 코드·요청 시각과 비밀값을 제외한 응답 구조를 기록했어요.
키·헤더 전체·공급자 오류 문구는 출력하지 않았어요. 요청 설정과 SDK 재시도를 바꾸지 않았어요.
기록은 `.artifacts/gemini/<기록-ID>.json`과 `<기록-ID>-transport.json`에 `0600`으로 보관해요.
초기 키 오류·중간 수정 검증의 실패 기록도 덮어쓰지 않았어요.

2026-10-30 확인한 [공식 오류 문서](https://ai.google.dev/gemini-api/docs/api-errors)는
`service_unavailable`을 공급자의 일시적인 과부하 또는 가용성 문제로 설명해요.
두 영상에서 같은 응답을 받았지만 Google 내부 원인이나 장애 범위는 확인하지 못했어요.
이 결과로 이전 429의 원인을 설명하거나, 한도 소진·영상 미지원으로 단정하지 않아요.

본문·사용량은 반환되지 않았고 실행 파일의 `quota`·`cost`는 계속 `null`이에요.
이후 제공받은 AI Studio의 표시 한도는 아래에 별도 근거로 기록해요.
현재 조건의 생성 성공·원본/시간 링크 대조가 없어 #5와 #7의
공급자 검증 조건은 미완료예요. 이 실행에서 Worker 배포·원격 DB·Android 연동은 하지 않았어요.

### AI Studio 표시 한도

2026-10-30 사용자가 이번 키의 프로젝트 자료로 제공한 Usage·Rate Limit 화면 2장을 확인했어요.
두 화면은 같은 프로젝트를 선택하고 있으며, 모델은 `Gemini 3.6 Flash`예요.
키 소속은 사용자 제공 자료에 근거하고 별도의 Google 관리 API로 조회한 것은 아니에요.
화면은 "지난 28일 동안의 모델별 최대 사용량과 한도 비교"이므로 앞 숫자를 현재 사용량으로 쓰지 않아요.

| 항목 | 화면에 표시된 지난 28일 최대값 | 표시 한도 |
| --- | --- | --- |
| RPM, 분당 요청 수 | 5 | 5회/분 |
| TPM, 분당 입력 토큰 수 | 3.8K, 반올림된 화면 값 | 250K 토큰/분 |
| RPD, 일일 요청 수 | 10 | 20회/일 |

요금제는 화면에 표시되지 않았지만, 2026-10-30 사용자가 이번 키의 프로젝트가 무료 플랜임을 직접 확인했어요.
무료 플랜이라는 기록은 이 사용자 확인에 근거해요. 현재 분/일의 사용량·잔여량·과금액은 여전히 미확인이에요.
특히 `10 / 20`을 "오늘 10회 남음"으로 해석하지 않아요.
Usage 화면의 마지막 503 막대는 10건으로 로컬 생성 요청 10회의 실패 수와 같지만,
모든 API 키를 합친 화면이므로 개별 요청이 일치한다고 확정하지 않아요.
RPM 최대값이 한도에 닿았다는 사실도 이번 `service_unavailable`의 원인을 증명하지 않아요.

2026-10-30 확인한 [공식 한도 문서](https://ai.google.dev/gemini-api/docs/rate-limits)에 따라
한도는 모델별로 프로젝트의 모든 키가 공유해요. 화면에도 여러 API 키가 있어 Qletter 전용 예산으로
간주하지 않아요. 관찰한 SDK 재시도까지 실제 요청 예산에 포함해야 하므로 20 RPD를 사용자별
하루 20회 요약 허용량으로 옮기지 않아요. 표시 한도 확인과 제품의 일일 상한 확정은 구분해요.
원본 화면은 Git에 포함하지 않고 수치와 관찰 범위만 기록해요.

## 2026-10-27 설정 복원 검증

전체 프롬프트·요청 옵션 4쌍, Markdown 4개·시간 표기 7개의 오프라인 대조 결과가 같았어요.
이 검사는 SDK 응답을 가짜로 제공했으며 실제 생성 성공을 뜻하지 않아요.
기존 실행 환경의 lockfile은 확인하지 않아 SDK 버전까지 같다고 보고하지 않아요.

2026-10-27 macOS arm64·Bun 1.4.2·SDK 2.31.0·`gemini-3.6-flash`로
다음 명령을 실행했어요. 제한 시간은 600초, 출력 상한과 재시도 옵션은 명시하지 않았어요.

```sh
mise exec -- bun run --cwd apps/api summary 'https://www.youtube.com/watch?v=2lv5xHjLx1c' report-parity-1027a
```

| 기록 ID | UTC 시작 시간 | 전체 시간 | 실제 결과 |
| --- | --- | --- | --- |
| `report-parity-1027a` | 2026-10-27 09:06:52.330 | 34,220ms | SDK 기본 재시도 후 HTTP 429, `quota` |

[영상](https://www.youtube.com/watch?v=2lv5xHjLx1c)의 제목은
`Gemini 4 Argon 퍼블릭 공개! AI Ultra 1년 개같이 물린거 드디어 본전?`, 채널은 `코드팩토리`예요.
[oEmbed 응답](https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D2lv5xHjLx1c&format=json)에서 확인했어요.
이 제목은 영상의 메타데이터이며 제목에 포함된 제품 출시 사실을 검증한 것은 아니에요.
본문·사용량·구체적인 한도 위반 수치는 반환되지 않았어요. 계정 한도·잔여량·비용은 `null`이에요.
요청 실패 뒤 다른 모델·API 경로로 전환하지 않았어요.

## 이전 Interactions 검증 기록

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
일일 한도 소진이나 무료 할당량 0으로 단정하지 않아요. 이 경로에서는 영상 요약 본문을 받지 못했어요.

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
계정·결제·모델은 바꾸지 않았어요. 이후 같은 키·모델에서 API 경로를 대조해 아래의 생성 성공을 확인했어요.

## 이전 generateContent 비교와 생성 결과

2026-10-27 같은 로컬 키·`gemini-3.6-flash`·공개 영상으로 요청 경로를 대조했어요.
SDK는 2.31.0, 실행 환경은 macOS arm64·Bun 1.4.2예요. 각 요청은 자동 재시도 없이 실행했어요.

| UTC 시작 시간 | 요청 | 시간 | 결과 |
| --- | --- | --- | --- |
| 07:13:49.572 | 기존 CLI `manual-summary-01` | 777ms | HTTP 429 |
| 07:17:05.121 | Interactions·Agentic 영상·기존 리포트 | 579ms | HTTP 429, `too_many_requests`, `Retry-After: 30` |
| 07:18:29.600 | 같은 Interactions 경로의 짧은 텍스트 | 3,020ms | HTTP 200, `OK`, 합계 253토큰 |
| 07:19:20.503 | Interactions·기본 영상 처리·기존 리포트 | 577ms | HTTP 429, 같은 code·대기 시간 |
| 07:20:47.224 | generateContent·한국어 두 문장 요청 | 17,695ms | HTTP 200, `STOP`, 합계 2,251토큰 |
| 07:27:27.058 | 수정한 CLI `zoo-generate-content-1027c`·전체 리포트 | 47,190ms | `generated`, 합계 3,353토큰 |
| 07:31:23.121 | 근거 범위를 좁힌 CLI `zoo-grounded-1027d` | 16,249ms | `generated`, 합계 4,257토큰 |

[공식 오류 문서](https://ai.google.dev/gemini-api/docs/api-errors)는 `too_many_requests`를 단기 요청 제한,
`quota_exceeded`를 일일 한도 초과로 구분해요. 실제 Interactions 오류에는 전자와 일반적인 프로젝트 한도 안내만 있었고,
어떤 카운터를 초과했는지는 없었어요. `Retry-After: 30`보다 긴 간격을 둬도 영상 요청은 실패했어요.
Google 내부의 제한 원인은 미확정이며 일일 초기화 시각을 기다리면 해결된다고 해석하지 않아요.

첫 전체 리포트는 영상 밖의 인물 이력·최초 기록·역사적 의미를 포함했어요.
서론·핵심 정리·질문도 영상의 관찰·발화 범위에 한정하도록 프롬프트를 좁힌 뒤 다시 생성했어요.
두 번째 결과의 3줄 요약은 다음 내용을 담았어요.

1. 한 남성이 코끼리 우리 앞에서 촬영해요.
2. 화자는 코끼리의 멋진 특징으로 매우 긴 코를 꼽아요.
3. 더 할 말이 없다는 언급과 함께 짧은 영상을 마무리해요.

두 번째 리포트의 실제 모델은 `gemini-3.6-flash`, 생성 시간은 16,074ms예요.
입력 2,118·출력 709·생각 1,430·합계 4,257토큰을 반환했어요. 도구·캐시 사용량은 반환하지 않아 `null`이에요.
리포트의 배경 지식이 줄어든 것은 해당 표본의 관찰이며 다른 영상의 사실성을 보증하지 않아요.
각 시간 링크와 원본의 장면·발화를 대조한 증거는 아직 없고 `timestampVerification`도 `unverified`예요.
실제 계정의 한도·잔여량·과금액은 확인하지 않아 `quota`·`cost`는 계속 `null`이에요.

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
  "model": "gemini-3.8-flash",
  "timeoutMs": 600000
}
```

```sh
chmod 600 apps/api/.artifacts/gemini/credentials.json
mise exec -- bun run --cwd apps/api summary 'https://www.youtube.com/watch?v=jNQXAC9IVRw' zoo-next
```

모델은 명시한 값으로 고정하고 `gemini-3.5-flash-lite`·`gemini-3.6-flash`·`gemini-3.7-flash`·`gemini-3.8-flash`만 받아요.
기본 시간 제한은 600초이며 허용 범위는 1~600초예요.
Interactions의 Agentic 영상 처리를 사용하며 출력 상한·temperature·thinking·재시도 옵션은 명시하지 않아요.
SDK 기본 재시도를 사용하므로 한 번의 명령에서 여러 HTTP 요청이 발생할 수 있어요.
다른 모델·API 경로로 자동 전환하지 않아요.
시점이 붙은 입력도 영상 전체를 처리해요.

명령 출력은 기록 ID·상태·결과 파일·전체 시간이에요. 성공 시 종료 코드 0, 실패 시 1이에요.
동일 ID의 결과·중단 기록이 있으면 요청 전에 거부해요. 이전 기록을 지우지 말고 원인을 확인한 뒤 새 ID를 사용해요.
중단 또는 결과 파일 저장 실패가 생겼다면 공급자 호출이 이미 실행됐을 수 있어요.

## 결과와 원본 대조

- `generated`는 완료 상태와 후처리 전 앞뒤 공백을 제외한 200자 이상의 본문을 받은 상태예요. 내용의 정확성·영상 전체 분석·시간 링크 검증 완료를 뜻하지 않아요.
- `video`의 제목·채널과 `metadataSource`를 먼저 확인해요. 길이·공개 상태·라이브 상태는 oEmbed만으로 판단하지 않아요.
- `api`·`processing`·`timeoutMs`로 요청 경로와 제한 시간을 구분해요. 현재는 `interactions`·`agentic`이에요.
- `report`에는 실제 응답 모델·`interactionId`·생성 시간·Markdown과 공급자 토큰 수를 담아요.
  입력·출력·생각·도구·캐시·합계는 독립된 응답 필드예요. 누락을 0으로 바꾸거나 합계를 임의로 다시 계산하지 않아요.
- `timestampVerification`은 항상 `unverified`예요. 원본 재생과 자막을 열고 주장·수치·각 링크의 시점을 대조해요.
  확인한 URL·구간·주장·결과를 별도 검토 기록에 남겨요. 확인하지 못한 시점은 결과에서 빼고 추측해 보충하지 않아요.
- 영상에 없는 배경 지식·주장을 섞었는지, 짧은 영상의 내용을 부풀렸는지, 한국어로 읽을 수 있는지 확인해요.
  자동 검사와 사람의 원본 대조 결과를 구분해 남겨요.
- 프롬프트는 1,500자 이상과 3줄 요약·서론·본론·결론·한번 생각해보기 구조를 지시해요.
  응답의 생각 블록을 제거하고 단독 시간 표기를 링크로 바꿔요. 링크 변환은 시점의 정확성 검증과 별개예요.

## 실패와 지원 범위

| reason | 확인할 내용 |
| --- | --- |
| `invalid_url` | 명령 인자와 허용된 YouTube 영상 주소를 확인해요. 외부 요청은 하지 않아요. |
| `configuration` | 키·모델·시간 제한과 계정 접근 권한을 확인해요. HTTP 400이어도 구조화된 `API_KEY_INVALID`가 확인되면 이 분류예요. |
| `metadata_unavailable` | oEmbed의 HTTP 상태와 영상 접근을 따로 확인해요. 삭제·비공개로 단정하지 않아요. |
| `quota` | HTTP 429예요. 일일 소진으로 단정하지 않고 실제 모델별 한도·사용량·공급자 상태를 확인해요. `quotaViolations`가 있으면 초과 항목만 참고해요. |
| `temporary`·`timeout` | 공급자·네트워크·시간 제한을 확인해요. 중단이 공급자 과금 취소를 보장하지는 않아요. |
| `unknown` | HTTP 상태를 확인할 수 없는 오류예요. SDK·네트워크·호출 경로를 확인하고 일시 장애로 단정하지 않아요. |
| `provider_rejected` | 모델·입력 지원과 요청 조건을 확인해요. 키 오류로 확인되지 않은 HTTP 400·404를 영상 미지원으로 단정하지 않아요. |
| `invalid_response` | 응답이 미완료·빈 본문·200자 미만이에요. 반환된 사용량이 있으면 보존해요. |

정규화·입력 거부와 가짜 응답의 성공/실패는 CI에서 검사해요. 실제 지원 범위와 달라요.
이전 `generateContent` 설정에서 짧은 공개 영상의 한국어 리포트 생성을 확인했어요. 현재 복원한 설정의 실제 생성,
Shorts·종료 라이브·긴 영상,
영상에 근거한 시간 링크와 Workers에서의 실제 공급자 호출은 아직 미검증이에요.
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
