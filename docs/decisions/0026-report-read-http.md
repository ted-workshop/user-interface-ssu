# ADR-0026: 리포트 목록·상세 조회를 권한 행 기준으로 연결해요

- 상태: 확정
- 작성·확정일: 2026-10-31
- 확정 근거: 사용자가 #12를 조회 기본과 검색·필터의 두 PR로 나누고 첫 PR 구현을 승인했어요. 세부 구현은 승인 범위 안에서 판단했어요.
- 관련 기록: [ADR-0018](0018-api-contract-and-policies.md)의 HTTP 정책, [ADR-0020](0020-shared-analysis-and-report-permissions.md)의 공통 보고서·권한, [ADR-0024](0024-direct-summary-http.md)의 세션·입력 경계를 적용해요.
- 구현·검증 상태: 로컬 구현과 workerd·로컬 D1 검사를 마쳤어요. 실제 로그인, 공급자 생성, 원격 배포, Android 연결, 원격 CI는 확인하지 않았어요.

## 문제와 현재 상태

[#12](https://github.com/ted-workshop/user-interface-ssu/issues/12)는 완성한 리포트를 새 분석 없이 다시 읽고 찾게 해요.
main `2b84d23`에는 보고서 저장과 `reportId` 응답이 있지만 본문을 읽는 HTTP가 없어요.
계약과 저장 모델은 [API 계약](../api-contract.md), [D1 가이드](../database.md)에 이미 있어요.

## 결정

- `GET /v1/reports`(`limit`, `cursor`)와 `GET /v1/reports/{id}`를 연결해요. `q`, `channelUrl`, `origin`, `deliveryStatus`는
  후속 PR의 범위예요. 그때까지 strict 입력 검사로 400을 반환해요.
- 목록은 본인의 `audience='user'` 권한 행에서 시작해 `permissions_library`의 `(created_at, report_id)` 순서로 읽어요.
  cursor 형식은 공통 규칙을 따르고 `createdAt` 자리에 `savedAt`을 담아요.
- 상세는 본인 권한 또는 공개 규칙이 있으면 읽어요. 그 외와 없는 ID는 같은 404예요.
  `viewerContext`는 본인의 권한 행과 요청이 모두 있을 때만 채우고, 공개 열람만으로는 `null`이에요. 읽기는 아무것도 쓰지 않아요.
- `deliveryStatus`는 조회 시 SQL로 계산해요. `failed|ambiguous`가 있으면 `failed`, `queued|sending`이 있으면 `pending`,
  그 외 `sent`가 있으면 `sent`, 나머지는 `not_applicable`이에요.
- 계약이 정하지 않은 "일부 성공 + 일부 취소"는 취소를 제외해 `sent`로 해석해요. 취소는 발송 대상을 없앤 결과이고
  전부 취소를 `not_applicable`로 정한 계약과 같은 기준이에요.
- `InvalidInput`, cursor, `limit`, 쿼리·ID 파싱은 `http-input.ts`로 옮겨 `summary-requests`와 함께 사용해요.
  동작은 바꾸지 않아요.
- 새 마이그레이션은 추가하지 않아요. 아래 실행 계획에서 기존 인덱스로 충분했어요.

## 근거와 대안

- 보고서 표에서 시작하면 소유자 조건이 없는 글로벌 스캔이 되어 [D1 가이드](../database.md)의 금지 사항과 어긋나요. 권한 행에서 시작해요.
- `deliveryStatus`를 저장하면 발송 전이마다 동기화해야 해서 어긋날 위험이 있어요. 조회 계산은 사용자·보고서 unique 인덱스로 찾을 수 있어요.
- 검색 파라미터를 무시하면 앱이 전체 목록을 검색 결과로 오해할 수 있어요. 그래서 구현 전까지 거부해요.
- 상세의 400과 404 구분은 ADR-0024의 `summary-requests`와 같게 해요.
- ADR 번호 0025는 닫힌 PR #38의 브랜치 `feature/27-auth-screens-1031a`가 사용하므로 충돌을 피해 0026을 써요.

## 가정·한계와 영향

- #9의 세션 발급이 없어 테스트는 세션을 DB에 직접 넣어요. 실제 로그인 후 재조회는 미검증이고, #12의 재로그인 완료 기준은 #9 이후에 확인해야 해요.
- 생성 결과는 공급자 fixture예요. 공개 규칙은 #23의 공개 API가 없어 테스트에서 직접 INSERT해요. 실제 공개 관리 기능의 증거가 아니에요.
- 권한 행은 있지만 요청이 없는 경우는 현재 쓰기 경로에 없어요. 생기면 목록에서 빠지고 상세의 `viewerContext`는 `null`이에요.
- `#12` 전체 완료가 아니에요. 검색·필터와 그 조회량 측정은 후속 PR에서 해요.

## 검증과 재검토 조건

2026-10-31 Windows 11 로컬, 기준 커밋 `2b84d23` 위의 미커밋 변경으로 확인했어요. 새 테스트가 구현 전에 실패하는 것을 먼저 확인했어요.

- workerd 테스트 256개를 통과했어요. 신규 `apps/api/test/reports.test.ts` 30개는 인증, 계약 형식, A/B 격리, 공통 보고서, 공개 열람,
  페이지 경계·동률, 발송 상태, 잘못된 입력을 다뤄요. Biome, 타입 검사, 생성 타입 확인, Worker dry-run 빌드도 통과했어요.
- `mise run api:check`는 실패로 끝났어요. `apps/api/tools` 3개와 `scripts` 4개가 실패했고, 이번 변경의 파일을 사용하지 않아요.
  확인한 원인은 POSIX 파일 권한 `0600` 검사가 Windows에서 `0666`으로 보이는 것이고, `scripts`의 나머지는 원인을 따로 확인하지 않았어요.
  이 실행에는 Git의 `sh`를 임시로 PATH에 추가했어요.
  WSL Ubuntu에서 이번 변경을 포함한 커밋 `4661e02`를 `mise run api:check`로 검사하면 workerd 256개, `tools` 16개, `scripts` 49개가 모두 통과해요.
  원격 CI는 아직 확인하지 않았어요.
- 보고서 150개, 권한 200개인 로컬 D1의 임시 측정이에요. 원격 과금·성능의 증거가 아니에요.

| 조회 | 인덱스 | 반환 | rows_read |
| --- | --- | --- | --- |
| 첫 페이지 (`LIMIT 21`) | `permissions_library` 범위 | 21 | 84 |
| 다음 페이지 (cursor) | `permissions_library`의 `(created_at, report_id)` 범위 | 21 | 85 |
| 상세 | 보고서 PK, `permissions_user_identity`, `permissions_public_identity` | 1 | 5 |

제목 검색·필터가 이 계획을 바꾸거나, 보관함 규모에서 조회량이 문제가 되면 다시 검토해요.
계약의 일부 취소 해석이 팀 기준과 다르면 이 판단을 수정해요.

## 반론과 변경 이력

- 2026-10-31: 첫 PR 범위로 작성했어요. 아직 제기된 반론은 없어요.
