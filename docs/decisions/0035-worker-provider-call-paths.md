# ADR-0035: Workers에서 oEmbed와 Interactions 호출 경로를 고쳐요

- 상태: 확정
- 작성·확정일: 2026-11-10
- 확정 근거: #11의 실제 공급자 경로 검증 중 확인한 두 런타임 오류를 사용자가 준비한 키와 로컬 Worker로 재현하고 수정했어요.
- 관련 기록: [ADR-0017](0017-report-generation-parity.md), [ADR-0024](0024-direct-summary-http.md), [ADR-0032](0032-gemini-single-call.md), [이슈 #11](https://github.com/ted-workshop/user-interface-ssu/issues/11)
- 구현·검증 상태: 코드와 workerd 회귀 검사를 반영했어요. 로컬 Worker에서 실제 oEmbed 조회와 Gemini 생성 1건을 확인했어요.
  2026-11-10 `gemini-3.5-flash-lite`로 전체 HTTP 접수→상태 조회→리포트 읽기를 완료했어요.
  같은 시각 `gemini-3.6-flash` 3회와 `gemini-3.8-flash` 1회는 503 `high demand`였어요.

## 문제와 현재 상태

#11은 로그인한 계정이 실제 YouTube URL을 접수하고 저장된 리포트를 읽는 경로를 요구해요.
로컬 Worker에서 실행했을 때 영상 분석이 공급자 호출 전에 두 번 실패했어요.

- `getVideoMetadata`의 `fetch(..., { redirect: "error" })`는 Workers 런타임에서
  `TypeError: Invalid redirect value ...`로 거부돼요. 모든 분석이 `metadata_unavailable`이 됐어요.
- `new GoogleGenAI({ apiKey })`의 `interactions` 경로는 `api_version`이 비어 있으면 v1을 사용해요.
  `text` 입력은 v1beta에만 있어서 같은 요청이 v1에서는 거부돼요.

## 결정

- oEmbed 조회는 `redirect: "manual"`을 사용하고 2xx가 아니면 `metadata_unavailable`로 처리해요.
  리디렉트를 따라가지 않는 기존 의도를 유지하면서 Workers가 허용하는 값만 사용해요.
- 공통 생성 함수의 SDK 클라이언트에 `apiVersion: "v1beta"`를 명시해요.
  다른 코드가 클라이언트를 만들 때 이 값을 빠뜨리지 않도록 생성 함수 한 곳에서 정해요.
- 회귀 검사는 리다이렉트 옵션·3xx 실패·Interactions URL의 `/v1beta` 경로를 확인해요.

## 근거와 대안

2026-11-10 로컬 `wrangler dev`에서 확인한 사실이에요.

- `redirect: "error"`는 workerd가 `"follow"`와 `"manual"`만 허용한다는 오류를 반환했어요.
  같은 조회를 `"manual"`로 바꾸자 oEmbed가 200으로 응답했어요.
- API 버전을 지정하지 않은 SDK 요청은 `input[1].type = "text"`가 v1에서 지원되지 않는다는 HTTP 400을 받았어요.
  같은 요청에 `apiVersion: "v1beta"`를 지정하자 생성이 완료됐어요.
- 수정한 공통 함수로 실제 영상 `Me at the zoo`를 생성했을 때 66.6초, 10,300토큰, 4,057자 결과를 받았어요.
  로컬 Worker의 임시 진단 경로에서도 `gemini-3.6-flash` 생성이 77초, 10,664토큰으로 성공했어요.

대안으로 환경 변수 `GOOGLE_GENAI_API_VERSION`을 두는 방법은 배포 설정이 빠지면 같은 오류가 재발해요.
리디렉트를 `"follow"`로 바꾸는 방법은 oEmbed의 리디렉트 대상을 다시 검증해야 해서 채택하지 않았어요.
SDK 버전만 올리는 방법은 이 버전에서 확인한 원인을 없앤다는 근거가 없어요.

## 가정·한계와 영향

- 이 결정은 `@google/genai` 2.31.0에서 확인했어요. SDK가 기본 버전이나 Interactions 경로를 바꾸면 다시 확인해요.
- `"manual"`은 3xx 응답을 반환하므로 2xx만 성공으로 처리해요. 리디렉트를 따라가는 동작은 추가하지 않았어요.
- 전체 HTTP 경로는 `gemini-3.5-flash-lite`로 확인했어요. `gemini-3.6-flash`·`gemini-3.8-flash`의 가용성은 아직 확인하지 못했어요.
- 장시간 실행 중 작업이 660초 실행권을 넘기면 다음 예약 실행이 결과 불명으로 복구해요. 이 동작은 기존 ADR-0022·0023을 따라요.

## 검증과 재검토 조건

- `mise run api:check`에서 workerd 회귀 검사와 타입·포맷·Worker dry-run을 통과했어요.
- 실제 oEmbed·Gemini 호출은 `Me at the zoo` 표본으로 확인했어요.
- 2026-11-10 `gemini-3.5-flash-lite`로 `Keyboard Cat!` 영상의 전체 HTTP 경로를 완료했어요.
  접수→예약 실행 17.3초·6,991토큰→보고서 2,040자 저장→`GET /v1/reports/:id` 읽기를 확인했어요.
- 같은 날 `gemini-3.6-flash`는 세 번 모두 503이었고, `gemini-3.8-flash`도 503 `high demand`를 반환해
  모델·키 문제가 아닌 공급자 가용성으로 구분했어요.
- 공급자가 계속 503을 반환하거나 600초 제한을 넘기면 모델·요청 방식·시간 제한을 다시 검토해요.
- SDK 업그레이드, Interactions의 v1 지원, oEmbed 리디렉트 정책 변경이 확인되면 이 결정을 다시 검토해요.

## 반론과 변경 이력

- 2026-11-10: `gemini-3.5-flash-lite`로 전체 HTTP 경로를 완료했어요. 저장 단계에서 누락된 `id`를 null로 정규화하는 문제는 [ADR-0036](0036-null-provider-fields.md)으로 분리했어요.
- 2026-11-10: 로컬 Worker 실제 호출에서 두 런타임 오류를 확인하고 수정했어요.
  문서만으로는 드러나지 않던 문제라 테스트에 런타임에서 유효한 옵션과 URL 경로를 고정했어요.
