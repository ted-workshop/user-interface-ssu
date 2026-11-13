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
  실제 채널 리포트 완료는 `completeAnalysis` batch가 저장 시점에 확인된 주소별 발송 행을 직접 만들어요.
- `getDelivery(DB, userId, deliveryId)` / `retryDelivery(DB, userId, deliveryId, attempt)`:
  발송 상태를 조회·재시도해요. 이미 성공한 분석을 다시 실행하지 않아요.
- `scheduleDueCheck(DB, now)`: 활성 구독과 확인된 수신 주소가 있고 `nextCheckAt`이 없거나 지난 첫 계정의
  `channel_checks` 행을 만들어요. 서버 설정이 없으면 호출부가 예약 행을 만들지 않아요.
- `claimChannelCheck(DB, now)` / `storeBaseline` / `storeNewVideos` / `recordCheckFailure` / `completeChannelCheck`:
  확인 하나만 점유해 공식 업로드 목록을 읽어요. 첫 성공은 현재 영상을 기준으로만 저장하고,
  이후에는 처음 관측한 영상만 `enqueueAnalysis`로 접수해요. 채널별 공급자 실패와 확인 작업 자체의 실패를 분리해요.
  한 확인은 최근 확인이 오래된 순으로 채널 2개·새 분석 2건까지만 처리하고 나머지는 다음 확인으로 미뤄요.
  지금 확인에서 활성 구독이 남으면 `continued_from_id`로 같은 묶음의 후속 작업을 대기시키고 `nextCheckId`로 알려줘요.
  채널 자동 접수도 직접 요약과 같은 계정별 하루 3회 접수 한도를 쓰고, 한도를 넘은 영상은 관측만 남겨 다시 시도해요.
- `runBackgroundJobs(env)`: 저장된 분석·발송·인증 메일·채널 확인 대기 행을 처리해요. 인증 메일은 [ADR-0028](decisions/0028-auth-http.md)의 `auth_mail_outbox`예요. Worker의 scheduled 핸들러가 호출하므로
  HTTP 핸들러에서 장기 `waitUntil()` 작업으로 실행하지 않아요.

이 반환값은 서버 내부 상태예요. #11·#15의 HTTP 호출부는 [API 계약](api-contract.md)의 DTO로 변환하고
인증·입력 길이·공급자 운영 한도·사용자별 접수 제한을 적용해요. 발송 목록은 리포트 개인 권한을 확인하고,
재시도는 세션 사용자와 발송 ID로 제한해요.
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

성공 저장은 원자적이에요. 분석 시도·본문·개인 권한·완료 상태·채널 발송 행 중 일부만 저장하지 않아요.
발송 행은 리포트 저장 시점에 확인된 주소로 고정하고, SMTP 실패는 이후 실행기에서만 다뤄 본문·완료 상태를 바꾸지 않아요.
SMTP 접수 성공과 실제 수신함 도착은 별개예요. SMTP 호출 직전 구독·수신 주소·개인 권한을 다시 확인해요.
메일의 명확한 일시 거부만 1분·5분 뒤 총 3시도까지 재전송해요. 결과 불명·quota·영구 거부는 멈춰요.

채널 확인도 실행 전에 활성 구독·확인된 주소·주기를 다시 조회하고, 관측·기준·다음 시각 갱신·접수 시점에도 같은 조건을 봐요.
영상 관측 기록은 채널 요청 접수에 필요한 스키마 조건이라 요청보다 먼저 저장해요. 접수 전에 중단돼 요청이 없는 관측은
다음 확인에서 이어서 접수하고, 접수가 저장 실패로 끝나면 이번 관측을 되돌려 다음 확인에서 다시 처리해요.
영상 기록·접수 저장이 실패하면 해당 구독만 `processing_failed`로 남기고 다음 주기로 미룬 뒤 다음 채널을 이어가요.
한 확인의 채널·접수 상한은 무료 Workers invocation의 subrequest 50개를 넘지 않기 위한 실행 예산이에요.
상한 때문에 처리하지 못한 구독은 `lastCheckedAt`이 오래된 순서로 다음 확인에서 이어가요.
공급자 성공 후 관측·접수 사이의 중단은 원자적이지 않아 같은 영상을 다시 접수할 수 있어요. 이때는 기존
분석 작업·보고서를 재사용하고 새 보고서를 만들지 않아요. 15분 넘게 실행 중인 확인은 `failed`·`interrupted`로
끝내고, 기준이 없는 구독은 다음 예약 확인에서 다시 시도해요.

`job.claimed`, `job.completed`, `job.failed`, `job.recovered_unknown` 로그에는 종류·작업 ID·시도 번호·
실패 코드만 남겨요. 주소·본문·키·공급자 오류 원문은 넣지 않아요. DB 장애 시 로그만으로 성공을 판단하지 말고
저장된 작업·시도·결과를 함께 확인해요. 결과 불명을 해결하려고 행을 삭제하거나 새 ID로 재접수하지 않아요.

## 로컬 검사

```sh
mise run api:db:migrate
mise exec -- bun run --cwd apps/api vitest run test/jobs.test.ts test/job-migration.test.ts test/deliveries.test.ts test/channel-checks.test.ts test/youtube-videos.test.ts
mise run api:check
```

검사는 실제 workerd·로컬 D1에서 장애와 응답 유실을 주입해요. 예정 시각은 테스트 시계로 움직여
1분·5분·lease 만료를 기다리지 않고 확인해요. 예정 시각 이전 재실행에서 추가 공급자 호출이 없는지도 검사해요.
일부 검사는 기존 SDK까지 실행하지만 외부 HTTP·SMTP 응답은 fixture예요. Google 생성·Gmail 실제 발송·
원격 Cron·무료 CPU 한도 검증과 구분해요.
