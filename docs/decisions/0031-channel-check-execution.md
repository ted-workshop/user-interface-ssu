# ADR-0031: 채널 확인을 D1 대기열과 첫 기준으로 실행해요

- 상태: 확정
- 작성일: 2026-11-13
- 확정일과 근거: 2026-11-13, 사용자의 #14 구현 시작 요청과 이슈의 완료 기준 범위 안에서 자율 판단했어요.
- 관련 기록: [ADR-0022](0022-d1-scheduled-jobs.md)·[ADR-0023](0023-background-runner-readability.md)의 D1 대기열·1분 Cron,
  [ADR-0018](0018-api-contract-and-policies.md)의 자동화 정책, [ADR-0019](0019-d1-product-schema.md)의 첫 기준·관측 표,
  [ADR-0020](0020-shared-analysis-and-report-permissions.md)의 공통 분석·개인 권한,
  [ADR-0027](0027-no-orm-typed-rows.md)의 행 타입, [ADR-0030](0030-channel-settings-http.md)의 구독·수신 설정을 적용해요.
- 구현·검증 상태: 확인 작업 표·공식 YouTube 조회·예약/지금 확인 HTTP·실행기를 구현하고 로컬 workerd 검사를 통과했어요.
  실제 YouTube 프로젝트 할당량, 원격 Cron, Android 화면은 확인하지 않았어요.

## 문제와 현재 상태

[#14](https://github.com/ted-workshop/user-interface-ssu/issues/14)는 채널을 처음 등록했을 때 과거 영상을 대량 생성하지 않고,
이후 새 영상만 자동 요약 흐름에 연결하는 실행을 요구해요. [기능 명세](../qletter/02-functional-spec.md) F-06의
수용 기준 AC-06은 첫 확인·빈 채널·반복 확인·확인 실패를 구분해요.

기준인 [PR #46](https://github.com/ted-workshop/user-interface-ssu/pull/46)(#13) 브랜치에는 `channels`·`channel_subscriptions`·
`subscription_videos`·`videos` 표와 구독·수신 주소·주기 설정 HTTP가 있어요. 첫 기준·확인 작업·공식 영상 목록 조회·
Cron 연결은 없었어요. 이 기록은 그 브랜치 위에 쌓는 #14 변경에 대한 판단이에요.

## 결정

- 새 표 두 개를 추가해요. `channel_checks`는 사용자별 확인 작업의 `queued|running|completed|failed`,
  수동 여부, 실행권 token, 시작·종료 시각, 확인 자체의 실패 코드를 담아요.
  `channel_check_results`는 확인 한 번에서 시도한 구독별 `completed|failed`, 실패 코드, 그때의 `lastCheckedAt`을 담아요.
  새 의존성·ORM·범용 작업 엔진은 추가하지 않고 기존 `jobs/` 실행기와 행 타입 규칙을 따라요.
- 확인은 [ADR-0022](0022-d1-scheduled-jobs.md)의 1분 Cron에서 전역 하나만 실행해요. 시작 전에 15분 넘게 `running`인
  확인을 `failed`·`interrupted`로 끝내고, 남은 대기 확인은 같은 실행에서 이어가요.
  구독별 공급자 호출은 실행 직전에 활성 상태·확인된 수신 주소·확인 주기를 다시 조회하고, 중지·삭제된 구독은 건너뛰어요.
- 예약 확인은 `nextCheckAt`이 없거나 지난 활성 구독만, `지금 확인`은 본인의 활성 구독 전체를 대상으로 해요.
  같은 계정에 대기·실행 중 확인이 있으면 새 행을 만들지 않고 같은 자원을 반환하며, 마지막 확인 생성 뒤 60초가 지나지 않으면
  `429 RATE_LIMITED`로 막아요. 서버에 `YOUTUBE_API_KEY`·Gemini 생성 설정이 없으면 예약 행을 만들지 않고 HTTP는
  `503 AUTOMATION_UNAVAILABLE`이에요. 활성 구독·확인된 주소가 없으면 `409 AUTOMATION_NOT_READY`예요.
- 공식 YouTube Data API 두 번으로 최근 영상 50개를 읽어요. `channels.list`(`part=contentDetails`)에서 업로드 재생목록 ID를
  찾고 `playlistItems.list`(`part=snippet`, `maxResults=50`)에서 영상 ID·제목·게시 시각을 검증해요.
  입력 URL을 직접 열지 않고 고정 endpoint에 `x-goog-api-key`로 전달하며 10초 기한·redirect 거부·자동 재시도 없음은
  [ADR-0030](0030-channel-settings-http.md)과 같아요.
- 첫 성공 확인은 응답의 영상 ID 전체를 `is_baseline=1`로 저장하고 `baselineInitializedAt`을 기록해요.
  빈 채널도 기준을 기록해 첫 업로드를 반복해서 제외하지 않아요. 첫 확인이 실패하면 기준·`lastCheckedAt`을 만들지 않아요.
  이후 확인은 이 구독에서 관측하지 않은 영상 ID만 `summary_requests.origin='channel'`로 기존 분석 흐름에 접수해요.
  같은 영상·생성 설정은 기존 분석 작업·보고서를 재사용하므로 확인이 반복돼도 결과가 늘지 않아요.
- 영상 관측 기록은 채널 요청 접수보다 먼저 저장해요. 기존 `summary_request_observation` 트리거가 채널 요청에
  관측 기록·활성 구독·기준 초기화를 요구하기 때문이에요. 접수가 실패하면 방금 만든 관측 기록을 지워
  요청 없이 관측만 남는 상태를 만들지 않아요. 관측과 접수 사이의 DB 실패는 원자적이지 않지만,
  다시 접수해도 기존 분석 작업을 재사용해 중복 보고서가 생기지 않아요.
- 확인이 성공한 구독은 `lastCheckedAt=지금`, `nextCheckAt=지금 + 주기`로 갱신해요. 채널별 공급자 실패와
  영상 기록·접수 중 저장 실패(`processing_failed`)는 다른 채널의 확인을 막지 않고
  `lastCheckedAt`을 유지하고 `nextCheckAt`만 `지금 + 주기`로 미뤄 다음 확인에서 다시 시도해요.
  확인 `completed`는 영상 수집·기준 갱신·새 영상 접수까지 마쳤다는 뜻이고, 개별 영상의 분석 완료와는 다른 상태예요.
- 확인 HTTP는 `POST /v1/channel-checks`(빈 본문 또는 `{}`)와 `GET /v1/channel-checks/{id}`이고,
  세션 사용자로만 조회·생성해요. 다른 사용자의 확인은 같은 `404 NOT_FOUND`예요. 확인 객체는
  `id`, `status`, `failureCode`, `createdAt`, `finishedAt`, `channels[]`(구독 ID·제목·상태·실패 코드·마지막 성공 시각)예요.
  채널별 실패 코드는 `provider_unavailable`·`invalid_response`·`processing_failed`, 확인 자체의 실패 코드는 `configuration`·`interrupted`예요.
- 채널 자동 접수는 직접 요약의 계정별 하루 3회 상한을 쓰지 않아요. 이 상한은 사용자가 직접 누르는 새 분석의 접수 정책이고,
  자동 확인은 등록한 채널·주기·활성 수신 설정이 사용량의 경계예요. 확인 주기·수집 개수·동시 실행은 공급자 할당량을
  보장하지 않으므로 운영 측정 뒤 재검토해요.

## 근거와 대안

2026-11-13 확인한 [YouTube Data API 할당량 비용 문서](https://developers.google.com/youtube/v3/determine_quota_cost)는
`channels.list`·`playlistItems.list`를 각각 1 unit으로 적고, `search.list`·`videos.insert`를 제외한 endpoint 합계의
기본 일일 한도를 10,000 units로 안내해요. 이 근거로 채널 하나를 확인할 때 두 번 호출하면 계산상 2 units이에요.
이 값은 계산이고 실제 프로젝트의 잔여량·분당 한도는 확인하지 않았어요.

RSS 피드(`youtube.com/feeds/videos.xml`)는 키 없이 최근 15개를 받을 수 있지만, 이 제품이 이미 공식 Data API로 채널 신원을
확인하고 있어 출처·응답 검증을 한 경로로 합치는 편이 오류 원인을 줄여요. 50개까지 확인할 수 있는 `playlistItems.list`를
선택했고 RSS는 채택하지 않았어요. `search.list`로 채널 영상을 검색하면 호출당 100 units라 반복 확인 비용이 커서 쓰지 않아요.

확인 작업을 표로 나눈 이유는 `queued|running|completed|failed` 상태, 시도한 채널별 실패, 마지막 성공 시각을
서로 다른 수명으로 보존하기 위해서예요. 분석·발송 행에 상태를 섞으면 확인 완료와 개별 분석 완료를 구분하기 어려워요.
별도 메시지 큐·Workflows는 [ADR-0022](0022-d1-scheduled-jobs.md)의 판단대로 추가하지 않았어요.

한 번에 확인 하나만 실행하는 이유는 공급자 quota 보호와 중첩 Cron의 동시 호출 방지예요. 대신 채널이 많은 계정은
한 확인에서 모든 구독을 처리하고, 다른 계정은 다음 1분 실행을 기다려요. 이 지연이 제품 요구를 넘으면 동시성·
실행 시간을 별도 기록에서 재검토해요.

관측 기록을 먼저 저장하는 순서는 기존 스키마 트리거가 강제하는 제약이에요. 순서를 바꾸려면 채널 요청 접수 트리거를
완화해야 하는데, 그러면 관측 없이 채널 요청이 생길 수 있어 채택하지 않았어요. 대신 실패 시 관측을 지우는 보상 처리로
"본 영상을 영영 건너뛰는" 상태를 피해요.

## 가정·한계와 영향

- 마이그레이션 `0009_channel_checks.sql`은 기존 행을 바꾸지 않고 표·인덱스·트리거만 추가해요. 원격 D1에는 아직 적용하지 않았어요.
  번호 0008은 다른 브랜치의 리포트 댓글·공개 마이그레이션이 선점해 비워 두었고, 그 브랜치가 들어오면 번호를 함께 맞춰요.
  wrangler는 적용하지 않은 파일을 번호 순서로 적용하므로 0009 뒤에 0008이 들어와도 서로 의존하지 않아요.
- 확인 한 번은 계정의 활성 구독 수만큼 공급자 호출 2회씩 사용해요. 1분 Cron·전역 하나 실행이라 처리량은
  `분당 1 확인`이고, 사용자·채널이 늘면 확인 대기가 길어져요. 실제 quota·Cron 지연은 측정하지 않았어요.
- 최근 50개 목록만 보므로 확인 사이에 50개를 넘는 업로드가 있으면 일부는 다음 확인에서 처리돼요. 장기간 중지한 동안의
  모든 영상을 복구하거나 제공 정보보다 빠르게 감지한다고 보장하지 않아요.
- 확인 작업·결과 행은 삭제·정리 정책 없이 누적돼요. D1 저장·읽기 사용량이 문제가 되면 보존 기간·집계 방식을 새 기록에서 정해요.
- 서버 설정이 빠진 채 이미 대기 중이던 확인은 한 번 `failed`·`configuration`으로 끝나고, 이후 예약 행을 만들지 않아요.
  설정을 복구하면 다음 예약 실행에서 다시 시작해요.
- 이번 변경은 채널 리포트 발송(#15)과 홈 현황(#16)을 구현하지 않아요. 새 영상은 분석 작업·보고서만 만들고 발송 행을 만들지 않아요.
- Android 화면·원격 배포는 이 범위가 아니에요. 실제 YouTube 호출과 원격 Cron은 미검증이에요.

## 검증과 재검토 조건

- `mise run api:check`가 통과했어요: workerd 419개, Bun tools 16개, 저장소 스크립트 51개, 타입·포맷·Worker dry-run.
- 새 검사는 로컬 D1에 실제 마이그레이션을 적용하고 외부 HTTP는 fixture로 대체해요.
  `channel-checks.test.ts` 14개는 준비 조건·본문 검증, 60초 간격·진행 중 재사용, 첫 기준·빈 채널, 새 영상 한 번 접수,
  첫 실패 뒤 기준 생성, 중지·주소 삭제 시 생략, 채널별 실패 구분, 계정 격리, 설정 오류, 중첩 점유, 중단 복구를 확인해요.
  `youtube-videos.test.ts` 7개는 요청 파라미터·중복 ID·빈 목록·공급자 오류·네트워크 오류·응답 검증·키 누락을 확인해요.
- 실제 공급자 검증은 실행하지 않았어요. `@GoogleDevelopers` 같은 승인된 채널로 확인하려면 서버 키가 필요해요.
- 재검토 조건: 실제 quota 소진·Cron 지연이 관찰되면 동시 실행·수집 개수·주기를 다시 정해요.
  첫 기준 판단이 게시 시각 기반 보정을 요구하거나 Data API 응답 형식이 바뀌면 조회·검증을 다시 설계해요.
  확인 대기 지연이 사용자 요구를 넘으면 계정별 실행 또는 다른 예약 수단을 검토해요.

## 반론과 변경 이력

- 2026-11-13: #14를 PR #46(#13) 브랜치 위에 쌓아 구현했어요. 선행 PR이 리베이스되면 이 변경도 같은 기준으로 다시 검증해요.
- 2026-11-13: 구현 중 기존 `summary_request_observation` 트리거가 채널 요청 접수 전에 관측 기록을 요구하는 것을 확인했어요.
  관측을 먼저 저장하고 접수 실패 시 지우는 방식으로 바꿨고, 검사로 요청 없이 관측만 남지 않는 흐름을 확인해요.
- 2026-11-13: 리뷰에서 영상 기록·접수 중 DB 예외가 채널 단위로 격리되지 않는 문제를 확인했어요. 예외가 나면 확인이
  `running`으로 남아 전역 하나 실행 제한 때문에 모든 계정이 15분 막히고, 실패한 구독의 `nextCheckAt`이 그대로라
  다음 예약에서 같은 구독이 다시 먼저 뽑힐 수 있었어요. 채널별 결과 코드 `processing_failed`를 추가해
  해당 구독만 다음 주기로 미루고 다음 채널로 넘어가게 바꿨어요. 보상 삭제 경로는 `enqueueAnalysis` 실패 검사로 확인해요.
