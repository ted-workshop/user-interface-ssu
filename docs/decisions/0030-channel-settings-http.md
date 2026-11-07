# ADR-0030: 공식 채널 조회와 개인 구독·수신 설정 HTTP를 연결해요

- 상태: 확정
- 작성일: 2026-11-05
- 확정일과 근거: 2026-11-05, 담당자 99eadb의 #13 구현·업로드 요청 범위 안에서 자율 판단했어요.
- 관련 기록: [ADR-0018](0018-api-contract-and-policies.md)의 설정 정책, [ADR-0020](0020-shared-analysis-and-report-permissions.md)의 공통 채널·개인 구독, [ADR-0027](0027-no-orm-typed-rows.md)의 SQL·행 타입, [ADR-0028](0028-auth-http.md)의 암호화 메일·요청 제한을 적용해요. 기존 확정 정책을 대체하지 않아요.
- 구현·검증 상태: HTTP와 공급자 어댑터를 구현했어요. workerd·로컬 D1과 공급자 fixture 검증을 진행했으며 실제 YouTube 조회·Gmail 수신·원격 배포·Android 연결은 미검증이에요. 아래 검증 절을 함께 확인해요.

## 문제와 현재 상태

[#13](https://github.com/ted-workshop/user-interface-ssu/issues/13)은 채널 확인·등록·중복 방지·중지/재개·삭제와 수신 주소·확인 주기를 요구해요.
기준 main `65604d04e643a497b86ec7f03073a81644505672`에는 인증·D1 표·중단 트리거가 있지만 설정 HTTP는 없어요.
새 영상 발견·예약 실행(#14)과 리포트 발송 연결(#15)은 별도 작업이에요.

## 결정

- `channel-settings.ts`에 계약의 설정 경로 12개를 구현하고 세션 사용자로 모든 개인 SQL을 제한해요.
  기존 입력·본문 상한·cursor 규칙을 재사용하고 정책 위반에는 한국어 필드 안내를 더해요. ORM·새 표·별도 repository 계층은 추가하지 않아요.
- `youtube-channels.ts`는 공식 `channels.list`를 사용해요. `@handle`, HTTPS YouTube의 `/@handle`, `/channel/UC…`, `/user/username`을 각각 `forHandle`, `id`, `forUsername`으로 조회해요.
  `youtube.com`, `www.youtube.com`, `m.youtube.com`만 허용하고 입력 URL 자체는 열지 않아요. 공유 query·fragment는 버려요.
  `/c/…`, 임의 경로, 영상·재생목록, 채널 하위 탭 주소는 거부하고 지원 형식으로 다시 입력하도록 안내해요.
- 서버만 `YOUTUBE_API_KEY`를 사용하고 고정 Google HTTPS endpoint의 `x-goog-api-key` 헤더로 전달해요.
  응답은 ID·제목만 검증하며 URL은 확인된 ID의 `/channel/…`로 통일해요. 미리보기는 저장하지 않고 등록 때 다시 조회해요.
  빈 결과는 입력 오류, 키 누락·네트워크·비정상 응답·공급자 제한은 `503 SERVICE_UNAVAILABLE`이에요. 10초 기한·redirect 거부·자동 재시도 없음으로 동작해요.
- 공통 채널은 ID로 upsert하고 개인 구독은 같은 batch에서 추가해요. 기존 partial unique index로 동시 중복을 막고 중지한 구독도 중복으로 봐요.
  삭제는 tombstone이고 재등록에는 새 구독 UUID를 부여해요. 초기 기준과 확인 시각은 null로 두며 #14의 첫 성공 전에는 값을 만들지 않아요.
- 주기는 기본 360분, 허용값 60·360·1440분이에요. 주기 저장과 활성 구독의 다음 시각 재계산은 같은 batch예요.
  이미 확인한 구독은 `lastCheckedAt + interval`을 사용하고 지난 시각이면 #14에서 즉시 확인할 대상이에요.
  중지는 `nextCheckAt=null`, 재개는 최신 주기로 다시 계산해요. 아직 확인한 적 없는 구독은 null을 유지해요.
- 주소 추가는 미확인 자원만 생성해요. 본문 없는 `POST /recipients/{id}/verifications`에서 별도로 메일을 접수해요.
  이미 확인한 주소는 `400 INVALID_INPUT`, 타인·삭제 주소는 404예요. 재등록도 확인을 다시 받아요.
- 기존 `account_tokens`의 `verify_recipient`와 암호화 outbox를 재사용해요. 32바이트 코드, SHA-256 해시, 24시간 만료, 소유자·목적·주소 검사와 일회 소비를 유지해요.
  재발급은 같은 주소의 기존 코드만 폐기해요. 주소 확인·코드 소비·대기 메일 제거를 원자적으로 처리해 동시 확인은 한 번만 성공해요.
- 확인 메일은 계정 이메일 대신 해당 수신 주소로 보내요. 공통 Cron·SMTP·복구 정책을 유지하고 같은 메일 IP/주소/간격 요청 제한을 공유해요.
  삭제 전에는 outbox를 먼저 지워 기존 `recipient_stop`의 토큰 삭제와 FK가 충돌하지 않게 해요.
  실행기는 대기 메일에 연결된 토큰·주소 상태를 다시 검사해요. 이미 SMTP에 접수된 메시지의 회수는 보장하지 않아요.
- 기존 `subscription_stop`·`recipient_stop`을 그대로 사용해 대기 발송을 취소하고 리포트·계정·발송 이력은 보존해요.
  직접 요약은 수신 설정을 요구하지 않아요. 예약 실행기가 활성 구독·확인된 살아 있는 주소·최신 주기를 조회하는 경계는 #14에 남겨요.

## 근거와 대안

2026-11-05 확인한 공식 문서예요.

- [channels.list](https://developers.google.com/youtube/data/reference/rest/v3/channels/list)는 ID·핸들·기존 사용자명 조회를 제공하고 호출당 1 unit이에요.
  이 근거로 공식 조회 하나로 식별할 수 있는 형식을 지원해요. 미리보기와 등록을 모두 호출하면 계산상 2 units이며 실제 측정값이 아니에요.
- [할당량 안내](https://developers.google.com/youtube/data/getting-started#quota-usage)는 `search.list`·`videos.insert`를 제외한 endpoint 합계 기본 일일 10,000 units를 안내해요.
  잘못된 요청도 비용이 발생하고 실제 프로젝트의 할당량·사용량은 Console에서 확인해야 해요. 사용자 키의 실제 잔여량은 확인하지 않았어요.
- [키 관리 지침](https://docs.cloud.google.com/docs/authentication/api-keys-best-practices)은 query 대신 헤더 전달, 키 사용 제한, 클라이언트·저장소에 키를 넣지 않는 방식을 안내해요.

비공식 HTML 파싱은 키 없이 조회할 수 있지만 응답 구조·접근 제한에 의존해 채널 신원을 안정적으로 확인하기 어려워 채택하지 않아요.
검색으로 `/c/…`를 추정하면 동명 채널을 잘못 등록할 수 있어 지원 형식을 안내해요. 미리보기 결과를 그대로 신뢰하면 오래된 ID·가짜 제목을 저장할 수 있어 등록 때 재조회해요.
별도 토큰 표·메일 실행기는 기존 암호화·재시도 로직과 중복되므로 추가하지 않아요. 메일 즉시 발송은 HTTP 지연과 접수 유실 문제 때문에 기존 영속 대기열을 유지해요.

## 가정·한계와 영향

- 마이그레이션·의존성·런타임 버전 변경은 없어요. 공통 채널 제목은 마지막 공식 등록 조회의 값으로 갱신되고 구독·기록은 사용자별이에요.
- `YOUTUBE_API_KEY`가 새 필수 Worker Secret이에요. 배포 workflow와 임시 secrets 파일에 이름을 추가했어요.
  저장소 관리자가 GitHub `production` Environment secret으로 등록해야 다음 수동 배포가 가능해요. 키 생성만으로 서버에 설정되지 않아요.
  등록 전 수동 배포는 원격 변경 전에 중단하고 기존 배포는 유지돼요. 이 작업에서는 Secret 변경이나 배포를 실행하지 않아요.
- 실제 키가 작업 환경에 제공되지 않아 공식 요청 성공·실제 별칭 일치·프로젝트 한도는 확인하지 못했어요.
  성공 fixture는 공급자 성공 증거가 아니에요. 실제 SMTP와 수신함도 확인하지 않았어요. 해당 검증 전에는 #13 전체 완료로 닫지 않아요.
- 채널 미리보기·등록에 별도 사용자별 일일 quota를 새로 정하지 않았어요. 공유 공급자 quota 보호의 추가 정책은 실제 사용량과 #14 호출량을 보고 재검토해요.
- 메일 제한에 거부된 요청도 포함되고, 전체 확인 메일 처리량은 기존 실행당 한 통이에요. 설정 조회·저장은 원격 호출 없이 계속 가능해요.

## 검증과 재검토 조건

- Linux, 저장소 고정 Bun 1.4.4·Node 24.22.1·Wrangler 4.152.0·Vitest 5.0.5를 사용해요.
- 변경 전 `mise run api:check` 통과를 확인했어요. 새 API의 세 흐름은 구현 전 404로 실패한 뒤 구현 후 통과했어요.
- `channel-settings.test.ts`와 `youtube-channels.test.ts`의 48개 검사가 통과했어요. 로컬 D1은 실제 migration을 사용하고 외부 HTTP·SMTP만 fixture예요.
  계정 격리, 동시 중복, 엄격한 입력·cursor, 만료·재발급·동시 확인, 암호문·대상 주소, quota 오류, 저장 rollback, 리포트 보존, 직접 요약 독립성을 확인해요.
- 최종 `mise run api:check`가 통과했어요: workerd 360개, Bun tools 16개, scripts 51개, 타입·포맷·Worker dry-run을 확인했어요. `git diff --check`도 통과했어요.
- `mise run infra:check`는 포맷·provider 설치 후 로컬 provider의 Unix socket 생성이 `operation not permitted`로 실패했어요. 원격 state·리소스는 사용하지 않았고 인프라 정의 변경도 없어요.
- `mise run android:check`는 Gradle 9.6.0 다운로드에서 `Network is unreachable`로 실패했어요. Android 코드는 바꾸지 않았어요. 따라서 전체 검사 통과로 보고하지 않으며 원격 CI 결과를 별도로 확인해요.
- 미검증: 실제 키의 YouTube 응답·공급자 한도, 실제 수신 확인, 원격 Worker·Cron, Android 화면, #14·#15 전체 자동화.
- 공식 조회 형식이 바뀌거나 `/c/…` 지원이 필수가 되면 정확한 신원 확인 근거를 먼저 마련해 재검토해요. quota 소진·대기열 지연이 관찰되면 사용 제한·캐시·발송 처리량을 별도 결정해요.

## 반론과 변경 이력

- 2026-11-05: #13의 정책을 기존 계약과 저장 모델에 연결했어요. 누락된 파일·비밀값을 임의 생성하지 않고 실제 공급자 검증을 미완료로 남겨요.
- 2026-11-05: 열린 PR #43이 ADR-0029를 사용하므로 번호 충돌을 피하려고 0030을 사용했어요. 그 PR의 코드는 이 변경에 포함하지 않아요.
- 2026-11-07: 리포트 검색·모음과 채널 설정을 함께 등록하고 두 결정 기록을 유지했어요. 리뷰에 따라 수신 주소 확인도 ADR-0028의 계정 확인과 같은 IP당 분당 5회를 공유하고, 필드 안내가 없는 오류는 공통 응답 함수를 사용해요.
- 이미 등록한 채널은 공식 조회 전에 거부하고 동시 등록은 기존 DB 제약으로 처리해요. `items`가 없거나 빈 배열인 성공 응답은 결과 없음으로 처리해요. 응답 형태는 fixture로 검증하며 실제 키의 응답은 아직 미확인이에요.
- `d299fbd`의 리포트 모음·검색과 통합한 뒤 `mise run api:check`에서 workerd 393개, 도구 16개, 저장소 스크립트 51개와 Worker dry-run이 통과했어요. Android는 Gradle 다운로드 연결 실패, Terraform은 provider의 로컬 소켓 생성 제한으로 이 환경에서 완료하지 못했어요.
