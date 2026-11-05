# ADR-0029: 모음 항목은 본인의 보관 권한 행을 가리켜요

- 상태: 확정
- 작성·확정일: 2026-11-05
- 확정 근거: 사용자가 #24의 경로·응답·정렬 설계안을 검토하고 추천대로 진행하도록 승인했어요. 세부 구현은 승인 범위 안에서 판단했어요.
- 관련 기록: [ADR-0020](0020-shared-analysis-and-report-permissions.md)의 공통 보고서·권한, [ADR-0024](0024-direct-summary-http.md)의 세션·입력 경계, [ADR-0026](0026-report-read-http.md)의 보관함 조회, [ADR-0027](0027-no-orm-typed-rows.md)의 행 타입 규칙을 적용해요.
- 구현·검증 상태: 로컬 구현과 workerd·로컬 D1 검사를 마쳤어요. 원격 CI·배포·Android 연결은 확인하지 않았어요.

## 문제와 현재 상태

[#24](https://github.com/ted-workshop/user-interface-ssu/issues/24)는 사용자가 원하는 주제로 리포트를 묶어 다시 찾게 해요.
보고서는 같은 영상·설정이면 사용자 사이에 하나만 있고, 각 사용자의 보관함은 `report_permissions`의 개인 규칙 행이에요.
그래서 "내 리포트"와 "리포트 삭제"는 공통 보고서가 아니라 본인의 개인 규칙 행으로 판단해야 해요.

## 결정

- `0007_collections.sql`에 `collections`와 `collection_items`를 추가해요.
- 모음 이름은 NFC·앞뒤 공백 제거 후 1~30 code point예요. 제어문자는 거부하고 대소문자는 구분해요. `(user_id, name)` unique예요.
- `collection_items`는 `(collection_id, permission_id)`를 PK로 두고 본인의 개인 규칙 행을 가리켜요.
  모음 삭제와 개인 규칙 삭제는 모두 항목을 함께 지워요. 모음 주인과 개인 규칙의 사용자가 다르면 trigger가 거부해요.
- HTTP는 `GET·POST /v1/collections`, `PATCH·DELETE /v1/collections/{id}`, `GET /v1/collections/{id}/reports`,
  `PUT·DELETE /v1/collections/{id}/reports/{reportId}`예요. 담기·빼기는 반복해도 같은 결과예요.
- 같은 이름은 `409 COLLECTION_EXISTS`, 빈 이름·길이 초과는 `400 INVALID_INPUT`과 `fields.name`이에요.
  다른 사용자의 모음·없는 모음·보관함에 없는 리포트는 같은 404예요.
- 모음 목록은 만든 시각, 모음 안 리포트는 담은 시각 최신순이에요. 항목 형식은 보관함 목록과 같고 `addedAt`을 더해요.
- `reportId` query를 보내면 각 모음에 `containsReport`를 붙여 "모음에 담기" 화면이 한 번에 표시하게 해요.

## 근거와 대안

- 항목이 공통 `report_id`를 가리키면 다른 사용자의 리포트를 막고 보관 해제를 반영하는 조건을 모든 조회에 다시 써야 해요.
  개인 규칙 행을 가리키면 FK·CASCADE·trigger가 "내 보관함의 리포트만", "보관 관계가 지워지면 함께 사라짐"을 저장 단계에서 보장해요.
  `permission_identity` trigger가 규칙 행의 사용자·보고서 변경을 막아 연결이 다른 리포트로 바뀌지 않아요.
- 정렬은 이슈의 "최신 생성순" 대신 담은 시각을 택했어요. 보관함이 저장한 시각순인 것과 같고,
  리포트 생성 시각으로 정렬하면 방금 담은 오래된 리포트가 목록 아래에 묻혀요.
- 대소문자 무시 비교는 SQLite `NOCASE`가 ASCII만 처리해 한글·유니코드와 규칙이 어긋나서 채택하지 않았어요.
- 중복 이름은 `INSERT ... ON CONFLICT DO NOTHING`과 `UPDATE OR IGNORE`의 변경 행 수로 판단해요. D1 오류 문구를 해석하지 않아요.
- 모음 상세 단건 조회, 개수 상한, `updatedAt`은 이슈와 화면 요구가 확인되지 않아 추가하지 않았어요.
- 보관함 목록의 모음 필터는 #24 범위 밖이에요. 모음별 목록은 `/v1/collections/{id}/reports`로 읽어요.

## 가정·한계와 영향

- 현재 API에는 보관함에서 빼기가 없어요. 보관 해제 후 모음에서 빠지는 동작은 테스트에서 권한 행을 직접 지워 확인해요.
- 모음 안 목록의 cursor는 `(담은 시각, report ID)`예요. 보고서 ID는 권한 행을 거쳐 읽어 인덱스로만 정렬하지 않아요.
  모음 하나의 크기는 개인 보관함보다 작다고 보고 조회량은 측정하지 않았어요.
- 모음 공개·공유는 #23의 공개 정책 이후 별도 작업이에요.

## 검증과 재검토 조건

- `apps/api/test/collections.test.ts` 13개는 인증, 생성·이름 변경·삭제 후 재조회, 목록 정렬·페이지, 빈 이름·길이·NFC·대소문자·중복,
  여러 모음 담기·중복 담기·빼기, 담은 시각 정렬과 항목 형식, 모음 삭제 후 보관함 보존, 보관 해제 후 모음에서 제외,
  A/B 격리, DB trigger, 잘못된 입력, 새 작업·보관 관계를 만들지 않는 읽기를 다뤄요.
- 2026-11-05 Windows 11 로컬에서 main `65604d0` 기준 첫 구현을 workerd 325개, Biome, 타입 검사, Worker dry-run 빌드로 확인했어요.
  같은 날 WSL Ubuntu에서 커밋 `202135b`를 `mise run api:check`로 검사해 workerd 325개, `tools` 16개, `scripts` 50개가 통과했어요.
- main `8a533eb`(#45)을 합친 뒤 Windows 11 로컬에서 workerd 343개, Biome, 타입 검사, Worker dry-run 빌드를 통과했어요.
- 원격 CI는 PR에서 확인해요.
- 모음이 커져 조회량이 문제가 되거나 화면이 다른 정렬·필드를 요구하면 정렬과 인덱스를 다시 검토해요.

## 반론과 변경 이력

- 2026-11-05: #24 첫 구현으로 작성했어요.
- 2026-11-05: #45 리뷰 의견을 이 PR에도 적용했어요. keyset 조건과 `containsReport` 조각을 bind 값과 함께 묶고, 필드 입력 오류 응답을 `http-input.ts`로 모아 계정 경로와 같이 써요.
