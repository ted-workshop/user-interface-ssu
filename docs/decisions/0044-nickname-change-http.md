# ADR-0044: 닉네임 변경은 세션 사용자의 계정 행만 갱신해요

- 상태: 확정
- 작성·확정일: 2026-11-22
- 확정 근거: [#76](https://github.com/ted-workshop/user-interface-ssu/issues/76)의 승인된 API 범위에서 자율적으로 정한 구현 판단이에요.
- 관련 기록: [ADR-0028](0028-auth-http.md)의 닉네임 검증·세션·no-store를 재사용하고, [ADR-0027](0027-no-orm-typed-rows.md)의 행 타입과 [ADR-0043](0043-android-auth-account-channel.md)이 남긴 후속 API 요구를 이어요. [API 계약](../api-contract.md)의 계정 섹션을 갱신해요.
- 구현·검증 상태: API 구현과 workerd·로컬 D1 회귀 검사까지 마쳤어요. 원격 배포, 실제 기기, Android 계정 화면 연결은 확인하지 않았어요.

## 문제와 현재 상태

[#27](https://github.com/ted-workshop/user-interface-ssu/issues/27) 계정 화면 목업에는 닉네임 변경이 있지만,
[#9](https://github.com/ted-workshop/user-interface-ssu/issues/9)에서 구현한 인증 API에는 경로가 없어요.
Android는 [ADR-0043](0043-android-auth-account-channel.md)에 따라 닉네임을 읽기 전용으로 보여 줘요.

`users.nickname`은 가입 때 저장한 뒤 바뀌지 않고, 댓글 작성자 표시는 조회할 때 `users.nickname`을 조인해 읽어요.
그래서 계정 행 하나를 바꾸면 기존 댓글도 새 이름을 보여 주는 구조예요.

## 결정

- `PATCH /v1/me`를 `src/accounts.ts`에 추가하고 `{ "nickname": "..." }`만 받아요.
  가입과 같은 Zod `nickname` 스키마와 `FIELD_GUIDE`를 재사용해 NFC·앞뒤 공백 제거 뒤 2~20 code point,
  제어문자·줄바꿈 거부를 같게 적용해요. 잘못된 값은 `400 INVALID_INPUT`과 `fields.nickname`이에요.
- `requireSession`으로 현재 세션을 확인하고 `users.nickname`을 세션의 `userId` 행에만 써요.
  본문의 `userId`·`email` 등 다른 필드는 strict schema가 거부해요.
- 변경문과 응답 조회문을 한 D1 batch에 넣어요. 성공하면 `200`으로 `GET /v1/me`와 같은
  `{id,email,nickname,emailVerified:true}`를 돌려주고, `requireSession`이 붙이는 `Cache-Control: no-store`를 유지해요.
- 닉네임 변경은 자격 증명 변경이 아니므로 세션을 폐기하지 않아요.
  중복·예약·변경 이력은 두지 않고 소유자는 UUID로 구별해요.
- 댓글은 저장 시점 스냅샷을 만들지 않고 기존처럼 조회할 때 현재 `users.nickname`을 읽어요.
  기존 댓글과 이후 댓글 모두 새 닉네임이 보여요.

## 근거와 대안

- 2026-11-22 [D1 `batch()` 문서](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)는
  batched statements가 SQL transaction이고 각 문장을 순서대로 비동시에 실행·commit한다고 설명해요.
  변경과 응답 조회를 한 batch에 넣으면 같은 사용자의 동시 변경에서도 이번 요청이 쓴 값을 응답해요.
  변경 뒤 별도 SELECT를 두는 대안은 두 요청 사이에 다른 값이 끼어들 수 있어 채택하지 않았어요.
- `PATCH /v1/me` 대신 별도 계정 하위 경로를 두는 대안은 계정 자원이 이미 `/v1/me` 하나로 계약에 있고
  Android·문서가 같은 모양을 쓰므로 채택하지 않았어요.
- 본문에서 `userId`를 받는 대안은 공통 규칙의 "모든 개인 변경은 세션 `userId`로 제한"을 깨고
  다른 사용자의 닉네임을 바꿀 수 있어 거부해요.
- 기존 댓글에 닉네임 스냅샷을 저장하는 대안은 과거 표시가 바뀌지 않는 장점이 있지만,
  이슈의 제외 범위이고 이미 조회 조인으로 현재 값을 읽고 있어 채택하지 않았어요.
  댓글 삭제 권한도 닉네임이 아니라 사용자 ID로 판단해 중복 닉네임과 충돌하지 않아요.
- 닉네임 변경 뒤 모든 세션을 폐기하는 대안은 공개 이름 변경을 자격 증명 변경처럼 다뤄
  불필요한 재로그인을 만들어 채택하지 않았어요.

## 가정·한계와 영향

- 변경 이력을 남기지 않아 이전 닉네임은 복구하거나 추적할 수 없어요.
  운영 감사·신고 대응 요구가 생기면 별도 기록이 필요해요.
- 동시 변경은 마지막 commit이 최종 상태가 돼요. 각 요청의 응답은 그 요청이 쓴 값을 돌려주지만,
  두 요청 중 어느 것이 남을지는 도착 순서에 따라 달라져요.
- 닉네임 중복을 허용하므로 같은 이름을 쓰는 사용자를 이름만으로 구별할 수 없어요.
  소유자 판단은 계속 UUID로 해요.
- DB 스키마·마이그레이션·기존 호출부 변경은 없어요.
  `users.nickname`의 CHECK 제약은 그대로이고 애플리케이션 검증이 제어문자를 추가로 막아요.
- Android 계정 화면은 이 변경 뒤에도 읽기 전용이에요. 수정 UI 연결은 후속 PR로 남아 있어요.

## 검증과 재검토 조건

- 2026-11-22 `mise run api:check`가 통과했어요(workerd 474개, `tools` 16개, `scripts` 51개).
  실제 workerd·로컬 D1 검사이고 원격 배포 검증은 아니에요.
- `apps/api/test/accounts.test.ts`에서 성공 `200`·응답 객체·`no-store`·`GET /v1/me`·DB 반영·기존 세션 유지,
  동시 변경에서 각 응답이 그 요청이 쓴 값인지, 빈 값·1자·21자·제어문자·줄바꿈·비문자열·누락의 `400`과 `fields.nickname`,
  세션 없음·만료 `401`, 본문 `userId`·`email` 거부, 알 수 없는 query와 16 KiB 초과 `413`을 확인해요.
- `apps/api/test/reports.test.ts`에서 변경 전에 쓴 댓글과 변경 뒤에 쓴 댓글 모두
  작성자 표시가 새 닉네임인지 확인해요.
- 미확인: 원격 Worker 배포, 실제 기기·에뮬레이터의 화면 표시, Android 수정 UI.
- 닉네임 이력·신고·차단 요구가 생기거나 댓글에 작성 당시 이름을 보존해야 하는 요구가 생기면 이 결정을 다시 검토해요.

## 반론과 변경 이력

- 2026-11-22: [#76](https://github.com/ted-workshop/user-interface-ssu/issues/76)의 승인 범위에서
  API 계약·구현·회귀 검사를 함께 추가했어요. Android 연결은 후속으로 남겼어요.
