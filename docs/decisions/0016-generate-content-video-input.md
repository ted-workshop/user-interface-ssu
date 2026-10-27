# ADR-0016: 실제 영상에 성공한 generateContent 경로를 사용해요

- 상태: 대체
- 작성·확정일: 2026-10-27
- 확정 근거: #5의 실제 영상 검증 범위에서 같은 키·모델·영상의 요청 경로를 대조했어요.
- 관련 기록: [ADR-0014](0014-gemini-video-verification.md)를 대체했으며 [ADR-0017](0017-report-generation-parity.md)로 대체됐어요. 운영 설정은 [ADR-0015](0015-gemini-production-settings.md)를 적용해요.
- 구현·검증 상태: 공통 함수와 검증 CLI를 변경하고 workerd의 영상 검사 47개·Bun의 요약 명령 검사 6개를 통과했어요.
  실제 공개 영상의 한국어 리포트 생성을 확인했어요. 원본의 각 시간 링크 대조와 실제 계정 한도 수치 확인은 미완료예요.
  Worker 배포와 제품 HTTP API·Android 연동은 후속 범위예요.

## 문제와 현재 상태

`manual-summary-01`은 777ms 뒤 HTTP 429로 실패했어요. 오류를 일일 한도 소진으로 해석하면
일반 모델 사용량에 여유가 있는 경우와 영상 입력 경로의 제한을 구분하지 못해요.
사용자가 확인한 AI Studio 화면이 로컬 키와 같은 프로젝트·모델의 화면인지는 미확인 상태예요.

macOS arm64·Bun 1.4.2·공식 `@google/genai` 2.31.0·`gemini-3.6-flash`로 다음 결과를 확인했어요.
아래 비교는 같은 로컬 키와 [Me at the zoo](https://www.youtube.com/watch?v=jNQXAC9IVRw)를 사용했어요.
자동 재시도를 끄고 앞선 429의 `Retry-After: 30`보다 긴 간격을 뒀어요.

| UTC 시작 시간 | 입력·경로 | 처리 시간 | 결과 |
| --- | --- | --- | --- |
| 07:17:05.121 | 기존 리포트·Interactions Agentic 영상 | 579ms | HTTP 429, `too_many_requests`, `Retry-After: 30` |
| 07:18:29.600 | 짧은 텍스트·같은 Interactions 경로 | 3,020ms | HTTP 200, `completed`, `OK` |
| 07:19:20.503 | 기존 리포트·Interactions 기본 영상 처리 | 577ms | HTTP 429, 같은 code·대기 시간 |
| 07:20:47.224 | 한국어 두 문장·generateContent 기본 영상 처리 | 17,695ms | HTTP 200, `STOP`, 읽을 수 있는 한국어 설명 |
| 07:27:27.058 | 전체 리포트·수정한 generateContent CLI | 47,190ms | `generated`, 한국어 Markdown |
| 07:31:23.121 | 근거 범위를 좁힌 리포트·generateContent CLI | 16,249ms | `generated`, 한국어 Markdown |

전체 리포트의 공급자 사용량은 입력 2,031·출력 454·생각 868·합계 3,353토큰이에요.
누락한 도구·캐시 사용량, 계정 잔여량과 비용은 `null`로 남겨요.
프롬프트 수정 뒤에는 입력 2,118·출력 709·생각 1,430·합계 4,257토큰을 반환했어요.
외부 배경 설명이 줄어든 것을 해당 표본에서 확인했으며 각 시간 링크의 원본 대조는 미완료예요.

이 결과는 키·모델·해당 영상이 generateContent에서 동작한다는 증거예요.
Google 내부에서 Interactions 영상 요청을 제한한 이유나 모든 영상의 지원 여부는 확정하지 않아요.

## 결정

- [공통 함수](../../apps/api/src/summary.ts)는 `models.generateContent`에 YouTube URL의 `fileData`와 리포트 프롬프트를 전달해요.
  정적 영상 처리를 사용하며 키·모델을 자동으로 바꾸거나 Interactions로 다시 보내지 않아요.
- `httpOptions.retryOptions.attempts: 1`과 `automaticContinuation: false`로 SDK가 재시도나 후속 생성 요청을 자동 실행하지 않게 해요.
  기존 180초 기본 기한·4,096 출력 토큰 상한과 `store: false`를 명시해요.
- 첫 응답 후보의 종료 사유가 `STOP`이고 필요한 본문 구조가 있을 때 생성 성공으로 기록해요.
  출력 중단·안전 차단·후속 생성 요구·빈 본문은 알려진 사용량을 보존하고 실패로 반환해요.
- `responseId`·`modelVersion`·`usageMetadata`를 기록해요. `interactionId`는 새 결과에서 사용하지 않아요.
  입력·출력·생각·도구·캐시·합계는 SDK 응답 값을 각각 옮기고 누락은 `null`이에요.
- SDK의 `ApiError.message` JSON에서 허용한 할당량 필드만 읽어요. 키·프로젝트·오류 원문은 결과에 넣지 않아요.
- [CLI](../../apps/api/tools/summary.ts)는 `api: "generateContent"`·`processing: "static"`을 남겨 실행 경로를 구분해요.
  과거 개인 검증 기록은 당시 결과로 보존해요. 제품 요약 API나 영속 데이터 소비자는 아직 없어 마이그레이션은 없어요.
- 첫 전체 리포트가 영상 밖의 최초 기록·인물 이력·역사적 의미를 포함했어요.
  프롬프트의 서론·핵심 정리·질문도 영상의 관찰·발화로 제한하고, 외부 지식으로 채우지 않도록 구체화해요.
  형식 검사와 원본 대조는 따로 수행해요.

## 근거와 대안

2026-10-27 [Google Interactions 오류 문서](https://ai.google.dev/gemini-api/docs/api-errors)는
`too_many_requests`를 단기 요청 제한, `quota_exceeded`를 일일 한도 초과로 구분해요.
실제 429에는 전자가 있었고 어떤 카운터를 초과했는지 수치는 없었어요.
일일 초기화 시각을 기다리면 해결된다는 근거로 해석하지 않아요.

[generateContent 공식 명세](https://ai.google.dev/api/generate-content)와 설치 SDK의 타입·구현을 확인했어요.
명세의 영상 입력과 실제 성공한 SDK 호출을 적용해요.
[영상 처리 가이드](https://ai.google.dev/gemini-api/docs/video-understanding#choose-a-processing-mode)는
짧은 영상이나 전체 내용을 정리하는 요청에는 정적 처리를 권장해요.

Interactions는 새 기능과 긴 영상 탐색을 사용할 수 있다는 장점이 있지만 현재 영상 검증에서 반복 실패했어요.
오류 뒤 자동으로 다른 경로·모델·키를 시도하면 중복 호출과 비용을 구분하기 어려워 채택하지 않아요.
영상 다운로드·별도 자막 수집 서비스는 추가 운영 부담이 있어 실제 성공한 네이티브 URL 입력을 먼저 사용해요.

## 가정·한계와 영향

실제 성공 표본은 짧은 공개 영상 한 편이에요. Shorts·종료 라이브·긴 영상·Workers의 실제 공급자 호출은 미검증이에요.
서버용 CLI의 공급자 성공과 workerd의 가짜 HTTP 응답 검사를 구분해요.
`generated`와 `STOP`은 사실성·전체 영상 이해·시간 링크 정확성을 보증하지 않아요.
`timestampVerification`은 원본 대조 전 `unverified`로 남겨요.

AI Studio의 프로젝트·모델별 실제 한도·현재 사용량과 무료 영상 입력 한도는 추가 확인이 필요해요.
이 기록으로 계정 설정·과금 플랜·GitHub Secret·모델을 바꾸지 않아요.

## 검증과 재검토 조건

실제 성공한 API 경로, 키·모델 전달, 토큰 누락, SDK의 생각 내용 제외, 종료 사유별 실패,
타임아웃·무재시도·무자동후속요청·할당량 비공개 처리를 workerd에서 검사해요.
명령 기록·동시 요청·파일 권한은 Bun에서 검사하고 최종 `mise run check`를 실행해요.
실제 명령·생성 결과와 남은 원본 대조는 [Gemini 가이드](../gemini.md)에 남겨요.

2026-10-27 최종 `mise run check`에서 workerd 80개·Bun 도구 16개·공통 도구 49개와
Android 포맷·lint·로컬 테스트·debug 빌드, Terraform의 backend 없는 검사를 통과했어요.

같은 키·모델·영상의 Interactions 성공이 확인되고 긴 영상 품질·시간·비용의 개선이 측정되면 다시 비교해요.
현재 경로의 실제 오류가 재현되면 같은 입력과 공급자 오류 정보를 기준으로 검토해요.

## 반론과 변경 이력

- 2026-10-27: 사용량에 여유가 있다는 지적에 따라 실제 공급자 오류 코드와 API 경로별 결과를 대조했어요.
  확인된 generateContent 성공을 근거로 ADR-0014의 Agentic 경로 선택을 변경했어요.
- 2026-10-27: 생성한 리포트의 외부 배경 지식을 확인하고 프롬프트의 근거 범위를 좁혔어요. 원본 대조 완료로 표시하지 않아요.
- 2026-10-27: 기존 리포트의 프롬프트·설정을 동일하게 맞추라는 요청으로 ADR-0017을 채택했어요. 당시 실측은 이력으로 보존해요.
