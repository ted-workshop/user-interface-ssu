# ADR-0036: 공급자 응답의 누락 필드는 null로 저장해요

- 상태: 확정
- 작성·확정일: 2026-11-10
- 확정 근거: #11의 실제 영상 경로에서 Interactions 응답의 `id`가 없어 D1 저장이 실패하는 것을 재현하고 수정했어요.
- 관련 기록: [ADR-0035](0035-worker-provider-call-paths.md), [ADR-0024](0024-direct-summary-http.md), [ADR-0023](0023-background-runner-readability.md), [이슈 #11](https://github.com/ted-workshop/user-interface-ssu/issues/11)
- 구현·검증 상태: 코드와 회귀 검사를 반영했고, 로컬 Worker에서 전체 HTTP 접수→상태 조회→리포트 읽기를 완료했어요.

## 문제와 현재 상태

실제 `gemini-3.5-flash-lite` Interactions 응답에는 `id`가 없었어요.
`generateReport`는 `interactionId: response.id`를 그대로 반환했고, `completeAnalysis`가 이 `undefined`를 D1에 bind하면서 실패했어요.

```text
D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'
```

D1 batch가 원자적으로 rollback돼 시도와 보고서가 저장되지 않았고, 작업은 `running`으로 남아 660초 실행권이 끝난 뒤에야 결과 불명으로 복구됐어요.
성공한 생성도 저장 단계에서 사라질 수 있는 문제였고, 테스트 fixture에는 `id`가 있어 발견하지 못했어요.

## 결정

- `generateReport`는 `interactionId: response.id ?? null`로 정규화해요.
- `AnalysisResult.interactionId`를 `string | null`로 맞추고, nullable인 `provider_interaction_id`에 null을 저장해요.
- `id`가 없는 실제 응답을 회귀 검사로 고정해요.
- 누락 필드를 빈 문자열이나 임의 ID로 채우지 않아요.

## 근거와 대안

- 실제 호출에서 응답 `id`가 없음을 확인했어요. 같은 응답의 `model`·`status`·`output_text`·`usage`는 정상이었어요.
- 수정 뒤 실제 `Keyboard Cat!` 영상이 17.3초, 6,991토큰으로 완료됐고 보고서 2,040자를 `GET /v1/reports/:id`로 읽었어요.
  `provider_interaction_id`는 `NULL`로 저장됐어요.
- 빈 문자열을 넣는 대안은 공급자 ID가 있는 것처럼 보여서 채택하지 않았어요.
- 필수 ID로 검증하는 대안은 공급자가 ID를 보장하지 않아 실제 응답을 실패시키므로 채택하지 않았어요.
- 저장 오류를 잡아 `failed`로만 표시하는 대안은 원인을 숨기고 성공한 보고서를 버리므로 채택하지 않았어요.

## 가정·한계와 영향

- 이 수정은 Interactions의 `interactionId`에 한정해요. 새 공급자 필드를 추가할 때도 선택 값은 D1에 넣기 전에 null로 맞춰야 해요.
- 로컬 Worker·로컬 D1·`gemini-3.5-flash-lite` 결과예요. 배포 Worker와 3.6·3.8 모델은 공급자 503으로 아직 확인하지 못했어요.
- 보고서는 구조를 갖췄지만 영상 밖 배경 지식이 섞였고 시간 링크는 `unverified`로 남아요. 경로 검증과 내용 품질 검증을 구분해요.

## 검증과 재검토 조건

- `mise run api:check`에서 workerd 회귀 검사와 타입·포맷·Worker dry-run을 통과했어요.
- 실제 경로: 가입·이메일 확인·로그인 → `POST /v1/summary-requests` → 예약 실행 → `GET /v1/summary-requests/:id` 완료 → `GET /v1/reports/:id` 본문 읽기.
- 공급자 응답 스키마가 바뀌어 다른 필드가 누락되면 같은 방식으로 정규화하고 회귀 검사를 추가해요.

## 반론과 변경 이력

- 2026-11-10: 실제 3.5-lite 응답의 누락 `id`로 D1 저장이 실패하는 것을 확인하고 null 정규화를 적용했어요.
