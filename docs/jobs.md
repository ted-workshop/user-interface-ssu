# 영속 분석·메일 실행

[ADR-0022](decisions/0022-d1-scheduled-jobs.md)의 D1 대기열·예약 실행과
[ADR-0023](decisions/0023-background-runner-readability.md)의 실행·모듈 규칙을 구현했어요.
공급자를 호출하는 함수는 기존 `summary.ts`·`email.ts`를 그대로 사용해요.
직접 요약 HTTP와 기존 세션 검사는 [ADR-0024](decisions/0024-direct-summary-http.md)에 따라 연결해요.
가입·로그인 발급과 Android 화면 연결은 후속 작업이에요.

## 후속 기능에서 사용하는 경계

- `enqueueAnalysis(DB, {userId, url, model, subscriptionId?, admissionLimit?})`: 요청과 공통 작업을 함께 저장해요.
  서버에서 인증한 userId와 설정한 model만 전달해요. subscriptionId가 없으면 직접 요청이에요.
  같은 사용자·영상·생성 설정은 같은 요청 ID를 반환하고 기존 보고서도 재사용해요.
  직접 요약 HTTP는 확정한 하루 3회 상한을 admissionLimit으로 전달해 접수·차감을 한 batch로 저장해요.
  생략은 내부 자동화 호출용이에요. HTTP의 공급자 설정 미비는 0으로 전달해 새 실행 접수만 거부해요.
  `accepted`는 새 접수인지 구분하는 내부 값이고 HTTP는 202·200으로 변환해요.
- `getAnalysisRequest(DB, userId, requestId)` / `retryAnalysis(DB, userId, requestId, attempt)`:
  본인 상태·실패 이유·재시도 가능 여부를 조회하고 관찰한 시도 번호로 재시도해요.
- `enqueueDelivery(DB, userId, requestId, recipientId)`: 완료된 자동 요청과 현재 확인된 주소를 대조해
  발송 하나를 접수해요. 직접 요청은 거부하고 같은 사용자·보고서·주소의 발송은 재사용해요.
- `getDelivery(DB, userId, deliveryId)` / `retryDelivery(DB, userId, deliveryId, attempt)`:
  발송 상태를 조회·재시도해요. 이미 성공한 분석을 다시 실행하지 않아요.
- `runBackgroundJobs(env)`: 저장된 대기 행을 처리해요. Worker의 scheduled 핸들러가 호출하므로
  HTTP 핸들러에서 장기 `waitUntil()` 작업으로 실행하지 않아요.

이 반환값은 서버 내부 상태예요. #11·#15의 HTTP 호출부는 [API 계약](api-contract.md)의 DTO로 변환하고
인증·입력 길이·공급자 운영 한도·사용자별 접수 제한을 적용해야 해요.
analysisJobId·lease token·다른 사용자의 요청을 사용자 API에 그대로 노출하지 않아요.

## 실행과 복구

Cron은 매분 대기 작업을 확인해요. 별도 활성화 플래그는 없으며 실행 가능한 작업이 있으면 처리해요.
대기 작업이 없으면 공급자를 호출하지 않아요. 실행기는 Google 프로젝트 전체의 사용량 제한기가 아니에요.
실제 공급자 성공과 사용량 정책 검증은 #5·#7에 남아 있고, 개발 검사는 fixture를 사용해요.

`runner.ts`는 작업 점유·준비·공급자 호출·결과 저장 순서를 관리해요.
SQL 조회는 `analysis.ts`·`delivery.ts`에 두고 값을 바인딩해요. 저장된 생성 설정은 기존 Zod 스키마,
현재 생성 프로필, 생성 키 순서로 확인해요. 공급자 오류의 작업 실패 코드와 사용량은 함께 분류해요.

각 종류는 동시에 하나의 실행권만 얻어요. 분석 lease 660초, 메일 lease 120초가 지나면
호출 의도가 없는 시도만 같은 번호로 재개해요. `dispatched_at`이 있으면 미실행을 보장할 수 없어
결과 불명으로 종료하고 자동 재호출하지 않아요. 호출 직전에는 같은 실행권의 기간을 연장해요.
늦은 성공 응답도 아직 token이 유지된 실행에는 저장하며, 회수된 실행의 응답은 상태를 덮어쓰지 못해요.

성공 저장은 원자적이에요. 분석 시도·본문·개인 권한·완료 상태 중 일부만 저장하지 않아요.
SMTP 접수 성공과 실제 수신함 도착은 별개예요. SMTP 호출 직전 구독·수신 주소·개인 권한을 다시 확인해요.
메일의 명확한 일시 거부만 1분·5분 뒤 총 3시도까지 재전송해요. 결과 불명·quota·영구 거부는 멈춰요.

`job.claimed`, `job.completed`, `job.failed`, `job.recovered_unknown` 로그에는 종류·작업 ID·시도 번호·
실패 코드만 남겨요. 주소·본문·키·공급자 오류 원문은 넣지 않아요. DB 장애 시 로그만으로 성공을 판단하지 말고
저장된 작업·시도·결과를 함께 확인해요. 결과 불명을 해결하려고 행을 삭제하거나 새 ID로 재접수하지 않아요.

## 로컬 검사

```sh
mise run api:db:migrate
mise exec -- bun run --cwd apps/api vitest run test/jobs.test.ts test/job-migration.test.ts
mise run api:check
```

검사는 실제 workerd·로컬 D1에서 장애와 응답 유실을 주입해요. 예정 시각은 테스트 시계로 움직여
1분·5분·lease 만료를 기다리지 않고 확인해요. 예정 시각 이전 재실행에서 추가 공급자 호출이 없는지도 검사해요.
일부 검사는 기존 SDK까지 실행하지만 외부 HTTP·SMTP 응답은 fixture예요. Google 생성·Gmail 실제 발송·
원격 Cron·무료 CPU 한도 검증과 구분해요.
