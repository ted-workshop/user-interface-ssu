# Android 연동 API 계약

관련 작업은 [#7](https://github.com/ted-workshop/user-interface-ssu/issues/7), 근거는
[ADR-0020](decisions/0020-shared-analysis-and-report-permissions.md)·[인증 정책 ADR-0018](decisions/0018-api-contract-and-policies.md), 저장 모델은 [D1 가이드](database.md)예요.
F-01~F-09·F-11을 구현할 때 따르는 계약이에요. `GET /health`와 아래 `summary-requests`의
접수·목록·상세·재시도 경로를 구현했어요. [ADR-0024](decisions/0024-direct-summary-http.md)에 구현 경계를 남겨요.
기존 D1 세션의 hash·만료·이메일 확인을 검사하며, 세션 발급 #9·리포트 조회 #12·Android 연결은 후속 작업이에요.
로컬 세션·공급자 fixture 검증을 실제 로그인·Gemini 생성 성공으로 보지 않아요.

## 공통 규칙

- 제품 경로는 `/v1`, HTTPS, UTF-8 JSON을 사용해요. 성공은 자원 객체, 목록은
  `{ "items": [], "nextCursor": null }`예요. 없는 값은 `null`, 빈 목록은 `[]`예요.
- 외부 ID는 서버가 생성한 UUID 문자열, 시간은 UTC RFC 3339 문자열이에요.
  DB의 정수 Unix 초를 HTTP에서 변환해요. 내부 row ID·공급자 오류 원문은 노출하지 않아요.
- 인증은 `Authorization: Bearer <sessionToken>`이에요. URL·로그에 토큰을 넣지 않아요.
  모든 개인 조회·변경은 세션의 `userId`로 제한해요. 본문의 `userId`는 허용하지 않아요.
  개인 요청·구독·주소는 타인 ID와 없는 ID 모두 `404 NOT_FOUND`예요. 공통 보고서는 본인의 조회 권한 또는 로그인 사용자 전체 공개 규칙을 확인한 뒤 읽어요. 권한이 없으면 같은 404예요.
- 개인 응답과 인증 응답은 `Cache-Control: no-store`예요. Android는 로그아웃·계정 전환 시
  토큰·개인 캐시·화면 back stack을 비워요. 재로그인 후 서버 상태를 다시 읽어요.
- JSON 키·열거값은 이 문서의 표기를 사용해요. 알 수 없는 입력 필드, 잘못된 cursor·필터·타입은
  `400 INVALID_INPUT`이에요. 본문 상한은 16 KiB이며 초과하면 `413 PAYLOAD_TOO_LARGE`예요.
- `204` 응답에는 본문이 없어요. `201`은 새 동기 자원, `202`는 영구 저장된 비동기 작업의 접수예요.
  `Location`은 해당 자원 경로예요. 접수 응답을 공급자 실행·완료로 해석하지 않아요.
- 목록은 `limit` 기본 20, 최대 100, 최소 1이에요. 시간·ID 내림차순 keyset cursor를 사용해요.
  cursor는 `{"createdAt":1800000000,"id":"<UUID>"}`를 담는 base64url JSON이고 입력 검증 후 bind해요.
  필터를 바꾸면 cursor를 버려요. 변경 중인 목록의 전체 개수·완전한 snapshot은 보장하지 않아요.

```json
{"error":{"code":"INVALID_INPUT","fields":{"url":"YouTube 영상 주소 하나를 입력해 주세요."}}}
```

`error.code`는 안정적인 분기 키예요. `fields`는 필드 오류가 있을 때만 붙어요.
다른 오류는 기존 규약처럼 `{"error":{"code":"NOT_FOUND"}}` 형식이에요.
한국어 안내는 Android가 코드에 맞춰 표시하며 서버 오류 원문을 그대로 보여주지 않아요.

| HTTP | code | 앱의 다음 행동 |
| --- | --- | --- |
| 400 | `INVALID_INPUT`, `INVALID_TOKEN` | 입력 또는 확인 메일을 확인해요. |
| 401 | `AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS` | 로그인으로 이동하거나 입력을 고쳐요. |
| 403 | `EMAIL_VERIFICATION_REQUIRED` | 비밀번호가 맞는 계정에만 이메일 확인을 안내해요. |
| 404 | `NOT_FOUND` | 다른 계정 정보나 존재 여부를 표시하지 않아요. |
| 409 | `CHANNEL_EXISTS`, `RECIPIENT_EXISTS`, `RETRY_NOT_ALLOWED` | 기존 자원·현재 상태를 다시 읽어요. |
| 413 | `PAYLOAD_TOO_LARGE` | 입력을 줄여요. |
| 429 | `RATE_LIMITED`, `USAGE_LIMIT_REACHED` | 정수 초 `Retry-After` 이후에 재시도해요. |
| 503 | `SUMMARY_UNAVAILABLE`, `AUTOMATION_UNAVAILABLE`, `SERVICE_UNAVAILABLE` | 새 분석을 반복하지 않고 나중에 다시 확인해요. |
| 500 | `INTERNAL_ERROR` | 내부 사유 없이 실패와 재시도를 안내해요. |

`GET /health`의 JSON, 기존 JSON 404·500과 revision 헤더는 유지해요.
공급자 429는 사용자 요청 속도 제한과 다른 사실이에요. 이미 접수한 요약의 공급자 실패는
요청 자원의 `status=failed`, `failureCode=quota`로 조회하고 HTTP 조회 자체는 `200`이에요.

## 계정·인증: F-11

| 메서드·경로 | 입력 | 성공 응답 |
| --- | --- | --- |
| `POST /v1/auth/registrations` | `email`, `password`, `nickname` | `202 {"status":"verification_required"}` |
| `POST /v1/auth/email-verifications` | `email` | 존재 여부와 무관하게 `202 {"status":"accepted"}` |
| `POST /v1/auth/email-verifications/confirm` | `token`, `password` | `204`, 로그인 화면으로 돌아가요. |
| `POST /v1/auth/sessions` | `email`, `password` | `201`, 아래 세션 객체 |
| `DELETE /v1/auth/session` | 현재 Bearer 토큰 | 현재 세션 폐기 후 `204` |
| `GET /v1/me` | Bearer 토큰 | `200 {"id":"…","email":"…","nickname":"…","emailVerified":true}` |
| `POST /v1/auth/password-resets` | `email` | 존재 여부와 무관하게 `202 {"status":"accepted"}` |
| `POST /v1/auth/password-resets/confirm` | `token`, `password` | 비밀번호 교체·모든 세션 폐기 후 `204` |

```json
{"sessionToken":"<이번 로그인에서만 반환한 비밀값>","expiresAt":"2026-11-26T10:00:00Z","user":{"id":"<UUID>","email":"reader@example.com","nickname":"읽는사람"}}
```

- 이메일은 앞뒤 공백 제거 후 ASCII 소문자로 정규화해요. ASCII 이메일만 지원하고 최대 254자예요.
  Gmail의 점·`+tag`를 제거하거나 서로 다른 주소를 합치지 않아요. 로그인 이메일 변경은 이 범위에 없어요.
- 닉네임은 NFC·앞뒤 공백 제거 후 Unicode code point 2~20자이며 제어문자·줄바꿈은 거부해요.
  중복은 허용하고 소유자는 UUID로 구별해요. 공개 리포트·댓글 #23은 이메일 대신 이 값을 사용해요.
- MFA 없는 비밀번호는 Unicode code point 15~128자, 공백·유니코드를 허용해요. trim·자르기·대소문자
  변환을 하지 않아요. 유출·흔한 비밀번호는 거부하고 임의의 특수문자 조합·주기적 교체는 강제하지 않아요.
  비밀번호 확인은 Android가 비교하고 서버에는 `password` 하나만 보내요.
- 비밀번호는 검증된 라이브러리의 salt 포함 자기 기술적 hash로만 저장해요. 알고리즘·비용은 #9에서
  OWASP 권고와 실제 Workers CPU를 함께 검증해 선택해요. 무료 CPU에 맞추려고 보안 수준을 낮추지 않아요.
- 가입 후 이메일 확인 전에는 세션을 발급하지 않아요. 중복 가입은 같은 202이며 기존 비밀번호·닉네임을
  덮어쓰지 않아요. 이메일 확인에는 토큰과 가입 비밀번호를 함께 요구해, 남이 미리 등록한 계정을
  메일 링크 클릭만으로 활성화하지 않아요. GET 링크는 안내만 열고 상태를 바꾸지 않아요.
- 이메일 확인·수신 주소 확인 토큰은 24시간, 비밀번호 재설정 토큰은 30분이에요. CSPRNG 32바이트의
  base64url 값을 한 번 전달하고 DB에는 SHA-256 hex만 저장해요. 목적·대상·만료·일회 사용을 함께 검사해요.
  재발급은 같은 목적·대상의 이전 토큰을 폐기해요. 미확인 계정도 복구로 비밀번호를 정할 수 있지만,
  재설정 성공만으로 이메일 확인을 생략하거나 세션을 발급하지 않아요.
- 비밀번호 재설정은 토큰 소비·비밀번호 변경·해당 계정의 세션과 복구/확인 토큰 폐기를 한 batch로 처리해요.
  동일 토큰의 동시 요청은 한 번만 성공해요. 잘못된·만료된·소비된 토큰은 같은 `400 INVALID_TOKEN`이에요.
- 세션도 CSPRNG 32바이트 opaque 토큰, DB에는 SHA-256 hex만 저장해요. 로그인마다 새 토큰을 만들고
  절대 만료는 30일이에요. refresh token·JWT·매 요청 sliding 갱신은 추가하지 않아요.
  Android는 Keystore로 보호하는 저장소에 보관하고 일반 설정·백업·로그에서 제외해요.
- 가입·확인 메일·비밀번호 복구는 계정 유무에 따른 응답·처리 시간 차이를 억제해요.
  로그인 실패는 `INVALID_CREDENTIALS` 하나로 구분해요. 발송 실패로 가입 요청을 거짓 성공 처리하지 않고,
  202 전에 발송 작업을 영구 저장해요. 외부 SMTP 성공까지 HTTP에서 기다리지는 않아요.
  outbox에 필요한 원문 토큰은 별도 서버 키로 암호화하고 발송·만료 뒤 제거해요. 평문 payload·로그는 금지해요.
- 초기 방어 정책은 로그인 IP·정규화 이메일 각각 분당 5회, 가입 IP 시간당 10회,
  확인/복구 메일 IP 시간당 10회·대상 주소 시간당 3회·최소 60초 간격이에요.
  존재하지 않는 계정에도 같은 제한을 적용해요. 영구 계정 잠금은 하지 않아요.
  분산 환경에서 우회되지 않는 구현·키의 개인정보 보호·측정은 #9의 gate예요.
- 로그아웃은 현재 세션만 폐기해요. 리포트·설정·진행 작업은 남고 채널 자동화도 계속될 수 있어요.

## 요약·리포트: F-01~F-04

| 메서드·경로 | 입력·필터 | 성공 응답 |
| --- | --- | --- |
| `POST /v1/summary-requests` | `{"url":"https://youtu.be/jNQXAC9IVRw"}` | 새 요청 `202`, 기존 요청·리포트 재사용 `200` |
| `GET /v1/summary-requests` | `status`, `limit`, `cursor` | 본인 요청 목록 `200` |
| `GET /v1/summary-requests/{id}` | 본인 요청 ID | 요청 객체 `200` |
| `POST /v1/summary-requests/{id}/retry` | `{"attempt":1}`: 마지막으로 확인한 시도 번호 | 접수 `202`, 이미 접수한 같은 재시도 `200` |
| `GET /v1/reports` | `q`, `channelUrl`, `origin`, `deliveryStatus`, `limit`, `cursor` | 리포트 목록 `200` |
| `GET /v1/reports/{id}` | 접근 가능한 공통 보고서 ID | 보고서 상세 `200` |

```json
{"id":"<request UUID>","videoId":"jNQXAC9IVRw","url":"https://www.youtube.com/watch?v=jNQXAC9IVRw","origin":"direct","status":"queued","attempt":0,"reportId":null,"failureCode":null,"retryable":false,"createdAt":"2026-10-27T10:00:00Z","updatedAt":"2026-10-27T10:00:00Z"}
```

- 서버는 현재 `parseYouTubeUrl`로 URL을 검증하고 같은 `videoId`로 정규화해요.
  시간 query도 전체 영상 요청이에요. 채널·재생목록만 있는 주소와 여러 URL은 거부해요.
- 직접 요약의 새 공통 분석·명시적 재시도는 계정별 UTC 하루 합계 3회로 제한해요.
  작업 접수와 차감을 같은 D1 batch로 저장하고, 진행 중 작업 합류·완성 보고서 재사용·응답 재전달은 차감하지 않아요.
  한도 소진은 `429 USAGE_LIMIT_REACHED`와 다음 UTC 자정까지의 `Retry-After`예요.
  키·모델 설정 미비는 새 분석에 `503 SUMMARY_UNAVAILABLE`을 반환해요.
  기존 상태 조회와 같은 생성 설정의 결과 재사용은 가능해요. 설정 변경으로 현재 생성 설정을 식별할 수 없으면 접수는 503이에요.
  하루 3회는 2026-10-30 사용자 결정이며 공급자가 보장한 처리량은 아니에요. 별도 상한 환경변수는 없어요.
  이 기록은 접수 횟수이며 SDK 내부 재시도를 포함한 공급자의 물리 요청 수·과금 한도가 아니에요.
- 같은 공개 영상·불변 생성 설정은 공통 분석 작업 하나와 보고서 하나를 사용해요. 생성 설정은
  모델·API/영상 처리·프롬프트 버전·언어·옵션을 식별하며 현재 ADR-0017을 따라요.
  `(userId, analysisJobId)`당 개인 요청 하나예요. A·B는 서로 다른 요청 ID와 같은 `reportId`를 받아요.
  진행 중 공통 작업에는 합류하고 완성 보고서는 재사용해 본인 보관·조회 권한을 추가해요.
  타인의 요청·주소·활동은 공유하지 않아요. 기존 실패 작업을 새 ID로 우회하지 않고 명시적 retry만 사용해요.
- 생성 경로 `direct`·`channel`과 최초 채널 연결은 생성 후 바꾸지 않아요.
  직접 요청이 먼저면 이후 채널 발견은 재사용만 하고 발송하지 않아요. 채널 요청이 먼저인 결과를
  앱에서 읽어도 새 직접 결과·추가 발송을 만들지 않아요.
- 상태는 `queued → running → completed | failed`예요. 저장된 공통 보고서의 재사용은 개인 권한 저장 후
  queued/failed에서 completed로 바로 갈 수 있어요. `completed`는 리포트 저장까지 끝난 상태예요.
  실행 시도는 별도 이력으로 남기며 새 재시도가 과거 이력을 덮어쓰지 않아요.
  개인 running 요청은 계정당 하나이고 공통 작업의 running 시도도 하나예요. 여러 계정의 요청이 같은 실행을 기다릴 수 있어요. 화면 종료·HTTP timeout은 작업 취소가 아니에요.
- 조회를 다시 하는 것은 항상 GET이에요. 정상 진행 중에는 5초 간격으로 확인하고 앱이 background면
  polling을 멈춰요. 조회 네트워크 오류는 5·10·20·30초 상한으로 늦추고 작은 jitter를 더해요.
  `Retry-After`가 있으면 그보다 먼저 요청하지 않아요. 진행률·완료 예상 시각은 만들지 않아요.
- 분석 재시도는 공통 작업당 최대 3시도예요. 본인의 `failed` 요청과 해당 공통 작업이 재시도 가능한 실패일 때만 허용해요. 다른 사용자가 이미 재시도했으면 현재 공통 시도를 재사용해요.
  `attempt`는 compare-and-set 기준이에요. 시도 1의 재시도 요청이 유실돼 다시 오면 2를 재사용하고,
  2도 이미 실패했더라도 오래된 `attempt=1`로 시도 3을 시작하지 않아요. 다시 조회한 뒤 눌러야 해요.
  다른 번호는 `409 RETRY_NOT_ALLOWED`예요. 이미 완료된 요청은 기존 결과를 반환해요.
- 공급자 quota·configuration·접근 거부·응답 불명은 자동 재분석하지 않아요. timeout·연결 유실은
  실행 여부를 확인할 수 없으면 `failureCode=provider_outcome_unknown`, `retryable=false`예요.
  현재 SDK 내부 재시도는 ADR-0017 그대로예요. 제품 작업 재시도와 물리적 HTTP 호출 수는 달라요.
  #10은 결과 유실·lease 만료를 재호출 근거로 삼지 않아요. [ADR-0022](decisions/0022-d1-scheduled-jobs.md)의
  실행기는 SDK 내부 시도의 미실행을 확인할 수 없는 최종 5xx도 `provider_outcome_unknown`으로 보존해요.
- 공통 보고서는 `id`, `videoId`, `url`, `title`, `channelName`, `channelUrl`, `bodyMarkdown`,
  `model`, `timestampVerification`, `createdAt`를 반환해요. `requestId`·`origin`·`deliveryStatus`는
  현재 사용자의 `viewerContext` 안에만 둬요. 보관 관계의 시각은 `viewerContext.savedAt`이에요.
  자신의 요청·보관 관계가 없는 공개 열람은 `viewerContext=null`이며 다른 사용자의 정보를 넣지 않아요.
  목록은 `bodyMarkdown`을 제외해요. 내 보관함은 본인 개인 권한 행만 조회하고 공개 열람만으로 보관하지 않아요.
  보관함 정렬·cursor 시간은 `savedAt`, 동률 ID는 공통 보고서 ID예요.
  시간 링크는 실제 원본 대조 전 `unverified`예요. 앱은 raw HTML·임의 스크립트를 실행하지 않아요.
- `channelUrl`은 oEmbed `author_url`이 HTTPS YouTube 채널 주소일 때 그대로 저장하고,
  없거나 형식·출처를 확인할 수 없으면 `null`이에요. 채널명을 URL로 추측해 바꾸지 않아요.
- `q`는 trim 후 1~100자의 제목 부분 검색, `channelUrl`은 저장된 채널 출처 URL의 정확한 일치예요.
  검색의 `%`·`_`는 wildcard가 아닌 문자로 escape해 bind해요. 제목 인덱스가 부분 검색을
  해결한다고 주장하지 않아요. 채널명만으로 다른 채널을 합치지 않아요.
- `origin`은 `direct|channel`, `deliveryStatus`는 `not_applicable|pending|sent|failed`예요.
  직접 요약은 항상 `not_applicable`이에요. 채널 결과는 발송 대상 스냅샷 중 하나라도
  `failed|ambiguous`면 `failed`, 그 외 `queued|sending`이 있으면 `pending`, 전부 `sent`면 `sent`예요.
  대상이 없거나 전부 취소됐으면 `not_applicable`이에요. 일부 성공 시에도 주소별 상태를 함께 보여줘요.

실패 자원의 `failureCode`는 아래 값으로 분기해요. `retryable`은 현재 설정·시도 수·처리 여부를
서버가 확인한 결과예요. 앱이 실패 코드만으로 새 분석·발송을 시작하지 않아요.

| failureCode | 의미와 기본 처리 |
| --- | --- |
| `invalid_url` | 잘못된 영상 입력. 보통 접수 전 400이며 URL을 고쳐요. |
| `metadata_unavailable` | 제목·채널 출처 조회 실패. 접근 제한의 정확한 원인을 단정하지 않아요. |
| `configuration` | 서버 자격증명·모델 등의 준비 문제. 운영 확인 전 retryable=false예요. |
| `quota` | 공급자 제한 응답. 일일 소진으로 단정하지 않고 운영 확인 전 retryable=false예요. |
| `temporary` | 명시적인 일시 거부. 미실행이 확인되고 총 3회 이내일 때만 retryable=true예요. |
| `provider_rejected`, `invalid_response` | 입력 거부 또는 결과 검증 실패. 자동 재분석하지 않아요. |
| `provider_outcome_unknown` | 분석 timeout·연결 종료·알 수 없는 공급자 실패로 실행 여부가 불명확해요. retryable=false예요. |
| `invalid_input`, `permanent` | 메일 입력·영구 거부. 주소·정책을 확인하고 자동 재발송하지 않아요. |
| `ambiguous` | SMTP 접수 여부 불명. 증거 확인 전 retryable=false예요. |
| `channel_inactive`, `recipient_inactive`, `access_revoked` | 현재 자동화·수신 설정 때문에 발송을 취소했어요. retryable=false예요. |

## 채널·수신 설정·발송: F-05~F-09

| 메서드·경로 | 입력·결과 | 성공 |
| --- | --- | --- |
| `POST /v1/channel-previews` | `{"input":"@handle 또는 채널 URL"}` → `youtubeChannelId`, `title`, `url` | 200 |
| `POST /v1/channels` | 확인한 `youtubeChannelId`를 서버에서 재검증하고 등록 | 201 |
| `GET /v1/channels` | 삭제되지 않은 본인 채널 목록 | 200 |
| `PATCH /v1/channels/{id}` | `{"status":"active 또는 paused"}` | 채널 객체 200 |
| `DELETE /v1/channels/{id}` | 자동화 중단·논리 삭제, 리포트 보존 | 204 |
| `POST /v1/channel-checks` | `{}`: 본인의 활성 채널 확인 요청 | 영속 확인 작업 `202 {"id":"…","status":"queued"}` |
| `GET /v1/channel-checks/{id}` | `queued|running|completed|failed`, 채널별 실패·`lastCheckedAt` | 200 |
| `GET /v1/settings` | `checkIntervalMinutes` | 200 |
| `PATCH /v1/settings` | `{"checkIntervalMinutes":360}` | 적용된 설정 200 |
| `GET /v1/recipients` | 본인 수신 주소 목록 | 200 |
| `POST /v1/recipients` | `{"email":"reader@example.com"}` | 미확인 수신 주소 201 |
| `POST /v1/recipients/{id}/verifications` | 본인 미확인 수신 주소 | 202 |
| `POST /v1/recipient-verifications/confirm` | `{"token":"…"}`와 로그인한 소유자 | 204 |
| `DELETE /v1/recipients/{id}` | 논리 삭제·대기 발송 취소 | 204 |
| `GET /v1/reports/{id}/deliveries` | 수신 주소별 `id`, `email`, `status`, `attempt`, `failureCode`, `retryable` | 목록 200 |
| `POST /v1/deliveries/{id}/retry` | `{"attempt":1}`: 분석과 같은 재시도 충돌 규칙 | 접수 202, 재사용 200 |
| `GET /v1/dashboard` | 아래 집계 객체 | 200 |

채널 객체는 `id`, `youtubeChannelId`, `title`, `url`, `status`, `baselineInitializedAt`,
`lastCheckedAt`, `nextCheckAt`, `createdAt`예요. 수신 주소 객체는 `id`, `email`, `verifiedAt`,
`createdAt`예요. 채널·수신 주소·발송 목록도 공통 `limit`·`cursor` 규칙을 따라요.

- 같은 계정의 같은 YouTube 채널은 하나만 활성 등록해요. 다른 계정의 등록과는 독립이에요.
  삭제 후 재등록은 새 UUID와 새 기준을 만들고 이전 발송을 되살리지 않아요.
- 첫 **성공한** 확인에서 반환된 영상 ID 전체를 기준으로 저장해요. 빈 채널도
  `baselineInitializedAt`을 기록해요. 실패 시 기준은 `null`이고 과거 영상을 생성하지 않아요.
  이후 새로 관찰한 ID만 처리하고 게시 시각만으로 소급 여부를 추측하지 않아요.
- 기본 확인 주기는 360분, 선택지는 60·360·1,440분인 경과 시간 간격이에요. 도착 시한이 아니며
  벽시계 시각·시간대를 선택하는 기능은 없어요. `지금 확인`은 계정당 최소 60초 간격, 진행 중이면
  같은 작업을 반환해요. 공급자 미검증 상태에서는 `503 AUTOMATION_UNAVAILABLE`로 접수를 막아요.
  주기·상한은 제품 초기 정책이고 공급자가 보장하는 할당량이 아니에요.
- 활성 채널과 확인된 수신 주소가 모두 있을 때만 자동화를 시작해요. 주소 추가 시 자동으로 동의하지 않은
  이전 리포트를 보내지 않아요. 채널 결과가 저장되는 시점의 확인된 주소 목록을 발송 대상으로 고정해요.
  같은 `(reportId, recipientId)`는 한 번만 만들어요. 삭제 후 같은 주소를 재추가해도 과거 발송을 재생성하지 않아요.
- 중지·삭제는 신규 확인과 대기/실패 발송 재시도를 멈춰요. 시작한 분석은 결과를 보관할 수 있지만
  발송 전 상태를 다시 확인해요. 이미 SMTP가 접수한 메시지를 회수할 수 있다고 보장하지 않아요.
  삭제는 DB tombstone이며 기존 리포트·시도·발송 이력을 보존해요.
- 발송 상태는 `queued → sending → sent | failed | ambiguous`, 미발송 중단은 `cancelled`예요.
  `sent`는 SMTP 접수이며 받은편지함 도착·열람이 아니에요. 같은 UUID에서 만든 Message-ID도
  공급자의 중복 제거를 보장하지 않아요. `ambiguous`는 자동 재시도·새 ID 우회 발송을 막고
  보낸편지함/수신함 증거로 확인한 뒤 접수 확인 또는 취소해요.
- 확실한 일시 거부만 총 3시도 한도에서 1분·5분 뒤 재시도해요. 영구 거부·quota·결과 불명은
  자동 재시도하지 않아요. 사용자 retry도 한도·상태·채널·수신 주소의 현재 유효성을 재검사해요.
  새 주소 추가는 과거 실패 발송의 대상 변경이 아니에요. 성공한 주소의 이력은 불변이에요.
- 확인·복구 메일도 저장된 발송 작업으로 실행하되 제품 리포트 `deliveries`와 섞지 않아요.
  토큰 메일 outbox의 실행·복구 방식은 #9에서 함께 구현해요. #8의 리포트 발송 표를
  임의의 주소로 메일을 보내는 범용 API로 사용하지 않아요.

```json
{"recentReports":[],"activeChannelCount":0,"summaryCounts":{"queued":0,"running":0,"failed":0},"deliveryCounts":{"pending":0,"failed":0},"lastCheckedAt":null,"nextCheckAt":null}
```

홈은 최근 리포트 최대 5개, 현재 계정의 작업·수신 주소별 발송을 집계해요. `ambiguous`는 발송 실패에,
`cancelled`와 직접 요약의 `not_applicable`은 대기·실패 어느 쪽에도 넣지 않아요.

## 공급자 증거와 출시 전 gate

2026-10-27 현재 [Gemini 기록](gemini.md)·[ADR-0017](decisions/0017-report-generation-parity.md)은
현재 Interactions·Agentic·동일 프롬프트의 실제 요청이 HTTP 429였음을 보여줘요.
이전 generateContent 성공을 현재 설정의 지원 증거로 쓰지 않아요. 현재 모델은
`gemini-3.6-flash`, SDK 2.31.0, 요청 기한은 600초이며 모델·API를 자동 교체하지 않아요.
600초는 영상 길이·완료 시간 보장이 아니에요. oEmbed는 제목·채널의 출처이고 길이·공개 여부·접근
가능성의 증거가 아니에요. 비공개·삭제·로그인 필요·진행 중 라이브는 지원 대상에서 제외해요.

다음은 아직 미확정이며 #5 결과 없이는 수치를 만들어 채우지 않아요.

- 실제 설정에서의 생성 성공·원본 주장·시간 링크 정확성, 일반 영상·Shorts·종료 라이브·길이별 지원 범위.
- 같은 프로젝트·모델의 실제 RPM/TPM/RPD·비용·잔여량과 계정별 하루 3회 정책의 운영 적합성.
- 배포된 Worker에서의 Gemini 호출과 Gmail 인증·실제 수신, 인증 hash의 CPU·무료 운영 가능성.

계정별 하루 3회는 확정했지만 실제 운영 출시는 #5의 공급자 검증과 프로젝트 공유 한도 검토가 남아 있어요.
HTTP는 키·모델 설정이 준비되지 않으면 새 분석을 접수하지 않고 위의 503을 반환해요.
기존 상태·리포트 읽기는 계속 가능해야 해요. 하루 3회 설정만으로 현재 공급자 경로의 성공을 보장하지 않아요.
메일의 [로컬 인증·SMTP 접수·실제 수신 기록](email.md)은 배포 환경 성공과 구분해요.
#7의 공급자 의존 완료 기준과 앱/API 담당자의 예제 검토는 이 문서 작성만으로 완료되지 않아요.

## 구현 시 확인할 예제

| 시나리오 | 기대 결과 | 담당 후속 작업 |
| --- | --- | --- |
| 틀린 비밀번호와 네트워크 단절 | `401 INVALID_CREDENTIALS`와 HTTP 응답 없음의 안내가 달라요. | #9·#27 |
| 같은 영상의 `youtu.be`·`watch`·시간 query | 같은 본인 request UUID, 생성 1회, 직접 결과의 발송 없음 | #10·#11 |
| 상태 조회 응답 유실·앱 재실행 | GET만 다시 호출해요. attempt와 리포트 수는 그대로예요. | #11·#28 |
| 시도 1 retry의 응답 유실 후 같은 body 전송 | 시도 2를 재사용하고 3을 시작하지 않아요. | #10·#11 |
| 권한 없는 B가 비공개 report ID 조회 | 일반 404이며 본문·존재 여부를 노출하지 않아요. B가 같은 요약을 요청해 권한을 얻으면 같은 ID를 읽어요. | #9·#12 |
| 첫 확인이 실패하거나 빈 채널이 성공 | 실패는 기준 null, 빈 성공은 기준 존재, 과거 분석 0개 | #14 |
| 직접 결과가 있는 영상을 채널에서 발견 | 기존 리포트 재사용, 발송 행 0개 | #14·#15 |
| 수신 주소 중 하나만 실패·채널 삭제 | 성공 이력 보존, 대기 발송 취소, 리포트 조회 가능 | #13·#15 |

구현 순서는 계약 → 스키마 #8 → 인증 #9·실행 기반 #10 → 사용자 흐름 #11~#17이에요.
공통 보고서·조회 권한·댓글 저장 기반은 #8에 포함해요. 공개·댓글 HTTP는 #23, 모음은 #24예요.

## 공통 보고서 권한·댓글: #23

- `report_permissions`의 `user` 규칙은 개인 보관·조회 관계예요. `authenticated` 규칙은 로그인 사용자
  전체에 적용하며 공개 권한 행을 사용자 수만큼 복제하지 않아요. 새 보고서는 공개 규칙 없이 시작해요.
- `GET /v1/reports/{id}/comments`, `POST /v1/reports/{id}/comments`,
  `DELETE /v1/reports/{id}/comments/{commentId}`는 동일한 공통 report ID를 사용해요.
  목록은 공통 pagination, 작성은 `{ "body": "댓글" }`와 `201`, 본인 삭제는 `204`예요.
  댓글은 `id`, `reportId`, `body`, `author: { "nickname": "…" }`, `createdAt`, `canDelete`를 반환해요.
  `canDelete`는 세션 사용자와 댓글 작성자 ID를 서버에서 비교해 정하고 중복 가능한 닉네임으로 판단하지 않아요.
  본문은 trim 후 1~2,000 code point이고 빈 댓글은 거부해요. 이메일을 응답하지 않아요.
- 댓글 조회·작성은 로그인과 댓글을 허용한 공개 규칙이 필요해요. 개인 read 권한만으로 비공개 댓글을
  읽거나 쓰지 못해요. 본인 댓글만 삭제하며 댓글 수정·답글·좋아요는 제외해요.
- A의 보관 관계 제거가 공통 보고서·B의 권한·댓글을 삭제하지 않아요. 공개 철회는 댓글 접근을 차단해요.
- 공통 보고서는 시스템 생성물이므로 최초 요청자에게 전역 공개 변경 권한을 주지 않아요.
  공개 관리 주체와 철회 시 댓글 보존/삭제 정책은 #23의 미확정 gate예요. 공개 변경 API는 아직 확정하지 않아요.
  권한 FK·로컬 댓글 검사는 실제 로그인·공개·댓글 HTTP 구현을 증명하지 않아요.
