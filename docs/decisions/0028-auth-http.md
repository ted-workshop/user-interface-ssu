# ADR-0028: 인증 HTTP를 scrypt·암호화 메일 대기열·D1 요청 제한으로 구현해요

- 상태: 확정
- 작성일: 2026-11-01
- 확정일과 근거: 2026-11-02 사용자가 kitae0522의 동의를 받아 비밀번호 규칙과 메일 코드 방식을 정했어요. 무료 CPU 한도 대응은 #17에서 측정한 뒤 정해요.
- 관련 기록: [ADR-0018](0018-api-contract-and-policies.md)의 인증 정책, [ADR-0012](0012-gmail-smtp-email-foundation.md)의 메일, [ADR-0024](0024-direct-summary-http.md)의 세션 검사를 적용해요.
- 구현·검증 상태: 로컬 구현과 workerd·로컬 D1 검사까지예요. 실제 Workers CPU, 실제 Gmail 발송, 원격 배포, Android 연결은 확인하지 않았어요.

## 문제와 현재 상태

[#9](https://github.com/ted-workshop/user-interface-ssu/issues/9)는 가입·로그인·복구와 계정별 접근 제어를 요구해요.
작성 시점의 main에는 세션 검사만 있고 세션을 발급하는 경로가 없어요. [API 계약](../api-contract.md)이 경로와 정책을 정해요.

## 결정

- 계약의 경로 8개를 `src/accounts.ts`에 구현해요. 입력은 Zod strict schema로 확인해요.
- 비밀번호는 `node:crypto`의 scrypt N=2^13, r=8, p=10으로 저장해요. 해시 문자열에 비용을 함께 담아요.
  없는 계정의 로그인과 중복 가입도 같은 해시 비용을 써서 처리 시간 차이를 줄여요.
- `0006`에 `auth_mail_outbox`를 추가해요. 원문 토큰은 `AUTH_TOKEN_KEY`의 AES-GCM 암호문으로만 두고, 발송·만료 뒤 행을 지워요.
  기존 Cron 실행기가 실행당 한 통을 보내요. 확실한 일시 거부만 1분·5분 뒤 총 3회 시도하고, 접수 불명과 발송 중 중단은 재발송하지 않아요.
- 비밀번호는 과제 범위에 맞춰 길이 8~128자와 한 글자 반복만 검사해요. 유출·흔한 비밀번호 검사는 하지 않아요.
  [ADR-0018](0018-api-contract-and-policies.md)의 15자 기준을 이 범위에서 바꿔요.
- 메일에는 앱 링크 대신 앱에 입력할 코드를 넣어요. 앱 링크 형식이 정해지지 않았어요.
- 재설정은 비밀번호 변경·세션 삭제·다른 토큰 폐기·토큰 소비를 한 batch에 넣고, 모든 문장을 "이 토큰이 살아 있음"으로 조건을 걸어요.
- 요청 제한은 D1 고정 윈도우로 원자적으로 세요. 키는 IP·이메일 원문 대신 HMAC이에요. 계약 수치를 그대로 쓰고,
  계약에 없는 확인 경로 두 개는 해시 남용을 줄이려고 IP당 분당 5회를 추가해요.

## 근거와 대안

2026-11-01 확인한 사실이에요.

- [Workers 한도](https://developers.cloudflare.com/workers/platform/limits/): Free CPU는 HTTP 요청당 10ms, Paid는 기본 30초예요. 초과 시 Error 1102예요.
- [OWASP 비밀번호 저장 지침](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): Argon2id, 그다음 scrypt를 권해요. PBKDF2-SHA256은 60만 회이고 FIPS가 필요할 때의 선택이에요.

Windows PC의 로컬 workerd에서 한 번씩 잰 경과 시간이에요. Cloudflare CPU 측정값이 아니에요.

| 구성 | 시간 |
| --- | --- |
| PBKDF2-SHA256 100,000회 (OWASP 미달) | 33ms |
| PBKDF2-SHA256 600,000회 | 202ms |
| scrypt 2^13, r8, p10 | 116ms |
| scrypt 2^14, r8, p5 | 175ms |
| scrypt 2^15, r8, p3 | 146ms |
| scrypt 2^16, r8, p2 | 200ms |
| scrypt 2^17, r8, p1 | 225ms |

scrypt 2^13은 이 측정에서 가장 빠른 OWASP 충족 구성이고 메모리도 가장 적어요. Argon2id는 WASM 의존성이 필요해 비교하지 않았어요.
10ms에 맞추려고 비용을 낮추는 안은 계약이 금지해요.

요청 제한을 Durable Object·KV로 구현하면 별도 저장소가 생겨요. Workers 내장 Rate Limiting은 위치별 근사값이에요.
D1은 전역으로 일관되고 이미 쓰고 있어요. 대신 요청마다 쓰기가 발생해요.

## 가정·한계와 영향

- **미해결: 무료 플랜 충돌. 실측은 [#17](https://github.com/ted-workshop/user-interface-ssu/issues/17)의 인증 CPU 확인에서 해요.** OWASP 충족 해시는 로컬에서 100ms가 넘어서 Free의 10ms를 넘을 가능성이 높아요. 실제 CPU는 측정하지 않았어요.
  넘으면 가입·로그인·확인·재설정이 Error 1102로 실패해요. 원격 측정 후 Paid 전환이나 외부 해시 실행 등을 정해야 해요.
- 8자 비밀번호는 흔한 값도 통과해요. 실제 운영 전환 때 다시 검토해요.
- 고정 윈도우라 경계에서 일시적으로 두 배까지 통과할 수 있어요. 거부된 요청도 횟수에 포함돼서 남이 특정 주소의 메일 요청을 한 시간 막을 수 있어요.
- `AUTH_TOKEN_KEY`가 새 필수 Secret이에요. 없으면 배포가 실패해요. 키를 바꾸면 대기 중인 메일은 복호화되지 않아 대기열에서 지워져요.
- Cron이 분당 한 통만 보내므로 가입이 몰리면 메일이 늦어요. 만료된 세션 행은 아직 지우지 않아요.

## 검증과 재검토 조건

실제 workerd·로컬 D1과 메일 fixture로 `apps/api/test/accounts.test.ts`를 검사해요.
Free 플랜 실측에서 해시 경로가 실패하면 이 결정을 바꿔요. 분산 우회·정상 사용자 차단 측정도 남아 있어요.

## 반론과 변경 이력

- 2026-11-01: 구현과 함께 제안으로 작성했어요.
- 2026-11-02: 전체 재검토로 오류 응답의 no-store, 본문 없는 경로의 query 거부, 본문 제한 범위, 키 오류 시 메일 보존, 로컬 안내를 고쳤어요. CPU·실제 메일 검증은 #17로 넘겨요.
- 2026-11-02: 비밀번호 규칙과 메일 코드 방식을 합의해 확정하고, main과 번호가 겹쳐 0028로 옮겼어요. 행 타입은 [ADR-0027](0027-no-orm-typed-rows.md)을 따르고 입력 처리는 `http-input.ts`로 모았어요.
