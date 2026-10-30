# D1 공통 보고서와 개인 접근·발송

[API 계약](api-contract.md)·[ADR-0020](decisions/0020-shared-analysis-and-report-permissions.md)과
[전체 ERD](diagrams/qletter-full-erd-proposal.mmd)를 구현하는 저장 기반이에요.
`0001`·`0002`의 이력을 보존하고 `0003_shared_reports.sql`이 공통 보고서 모델로 전환해요.
`0004_job_leases.sql`은 실행권·호출 의도 열을 추가해요. 제품 테이블은 17개·122개 열이에요.
[실행기](jobs.md)는 로컬 D1에서 검증했고 인증·제품 HTTP·원격 적용은 아직 하지 않았어요.

## 공통 데이터와 개인 관계

채널·영상·분석 작업·분석 시도·보고서는 공통이에요. `(video_id, generation_key)`는 작업 하나이고
작업당 완성 보고서도 하나예요. 생성 설정은 서버가 고정한 모델·API·영상 처리·프롬프트 버전·언어·
옵션을 식별하며 현재 ADR-0017을 따라요. 실행기는 접수 시 정규화 JSON의 SHA-256을 만들고 호출 직전 설정과 키를 다시 대조해요.
같은 입력의 두 개인 요청이 서로 다른 공통 작업을 만드는 우회 경로를 허용하면 안 돼요.

사용자별 요청·생성 경로·구독·최초 관찰·설정·수신 주소·발송은 개인 관계예요.
A·B는 서로 다른 요청으로 같은 report_id를 받고 각자의 `report_permissions`를 가져요.
직접 요청과 채널 자동 요청의 경로를 바꾸지 않으며 A의 직접 결과를 소급 발송하지 않아요.
B의 별도 자동 요청은 같은 보고서를 재사용해 B의 확인된 주소에 발송할 수 있어요.

SQLite STRICT, UTC Unix 초 INTEGER, UUID를 사용해요. 영상 ID만 YouTube 원본 ID예요.
현재 메타데이터에서 확인하지 못한 채널 ID·URL·게시 시각은 NULL로 두고 추측하지 않아요.
시도 usage_json도 공급자가 주지 않은 사용량은 NULL이며 비용·할당량을 계산해 채우지 않아요.

## 조회·보관·댓글 권한

- 개인 규칙은 audience=user, user_id 필수, read=1/comment=0이에요.
  `(report_id, user_id)` partial unique가 중복 보관을 막아요.
- 공개 규칙은 audience=authenticated, user_id=NULL, read=1/comment=1이에요.
  report_id partial unique로 공개 규칙을 하나만 둬요. 사용자 수만큼 복제하지 않아요.
- 보관함은 본인의 개인 규칙만 조회해요. 공개 보고서를 읽는 행동은 보관 관계를 만들지 않아요.
- 본문은 본인의 read 규칙 또는 로그인 사용자 전체 공개 규칙을 검사해요. 댓글 조회·작성은 로그인과
  공개 댓글 규칙을 검사해요. 개인 read 권한만으로 비공개 댓글을 읽거나 쓰지 못해요.
- comments.report_id는 공통 보고서예요. 공개 전환 전 댓글 INSERT는 DB도 거부해요.
  댓글 수정은 거부하고 본인 삭제 권한은 API의 세션 사용자 조건으로 검사해야 해요.
- 본인의 개인 규칙 제거는 공통 보고서·타인 권한·댓글을 지우지 않고 본인의 대기 발송만 취소해요.
  공개 규칙 제거는 댓글 접근을 차단해요. 현재 저장 기반은 댓글 행을 자동 삭제하지 않아요.
  공개 관리 주체·철회 후 댓글 보존/삭제 API 정책은 #23에서 확정해야 해요.

FK·CHECK·trigger는 로그인·SELECT 권한이나 RLS가 아니에요. 개인 요청·구독·주소·발송은 세션에서
얻은 user_id를 조건으로 bind해요. 공통 본문·댓글에도 위 권한 조건이 필요해요.
보고서 ID를 알거나 같은 영상을 요청했다는 사실만으로 타인의 요청·주소·활동을 보여주지 않아요.
로컬 SQL의 읽기·삭제 권한 예제는 실제 인증 HTTP를 구현한 증거가 아니에요.

## 저장·실행 경계

1. 정규화 영상과 서버 생성 설정 키의 공통 작업을 INSERT 또는 재사용해요. 개인 요청은
   `(user_id, analysis_job_id)` unique예요. 생성 경로·구독·소유자는 바꾸지 않아요.
2. 공통 작업 claim은 `WHERE status='queued'` 조건과 실제 변경 행 수를 확인해요.
   running 개인 요청과 실행 가능한 직접 요청 또는 활성 구독·확인 주소가 있어야 분석 시도를 넣어요.
   개인 running 요청은 계정당 하나, running 분석 시도는 공통 작업당 하나예요.
3. UPDATE 0건은 SQL 오류가 아니에요. batch의 다음 INSERT도 claim 성공 조건을 검사하고,
   시도 행의 존재만 보고 타인의 실행권을 인수했다고 판단하지 않아요. [실행기](jobs.md)가 호출 전에는 token·만료를, 결과 저장에는 아직 회수되지 않은 token을 검사해요.
4. 성공 시 `시도 succeeded → 보고서 INSERT → 공통 작업 completed`를 한 batch로 저장해요.
   본문·출처·성공 시도는 불변이고 잘못된 작업의 시도나 보고서 없는 완료는 거부해요.
5. 개인 조회 규칙을 저장한 뒤 개인 요청을 completed로 바꿔요. 보고서·개인 권한 없이 완료할 수 없어요.
   캐시 재사용은 queued/failed에서 completed로 바로 갈 수 있고 새 공급자 시도를 만들지 않아요.
6. 주소별 발송 INSERT는 개인 요청 완료·접근 저장과 같은 batch의 적격 `INSERT … SELECT`로 묶어요.
   부적격 주소가 0개여도 완성 보고서는 보존해요. 자동 요청은 본인 활성 구독의 최초 기준 이후
   관찰 영상이어야 하고 최초 기준 영상·다른 채널 영상·타인 구독으로 만들 수 없어요.
7. 분석·메일 시도는 각각 최대 3회이고 과거 종료 시도를 덮어쓰지 않아요. 성공·결과 불명 분석 시도가
   있으면 새 공급자 시도도 막아요. 결과 불명은 확인 없이 실패한 미실행으로 간주하지 않아요.
8. SMTP claim 때 구독·개인 권한·현재 주소를 재검사해요. 성공은 accepted 시도가 있어야 하며,
   ambiguous에서 수동 sent 정정은 비밀값 없는 resolution_evidence가 필요해요.
   DB가 근거의 실제 진위를 확인하는 것은 아니에요. 전송 중 메일의 회수는 보장하지 않아요.

발송은 `(user_id, report_id, recipient_id)`와 `(user_id, report_id, recipient_email)`이 각각 unique예요.
삭제 후 같은 주소를 새 ID로 추가해도 같은 사용자의 과거 보고서를 중복 발송하지 않아요.
다른 사용자의 별도 발송까지 전역 주소 unique로 막지 않아요. 요청·구독·주소는 복합 FK로 사용자와
원래 자동 요청을 연결하고 trigger는 보고서와 요청의 공통 작업이 일치하는지 검사해요.

구독·주소는 tombstone으로 삭제해요. 구독 삭제 후 재등록은 새 ID·새 시작 기준이에요.
빈 채널도 첫 성공 시각을 남겨요. 중지·삭제는 본인의 queued/failed 발송만 취소하고 성공 이력은 남겨요.
공통 작업을 다른 사용자가 기다릴 수 있으므로 한 구독 중지로 공통 작업·보고서를 취소하지 않아요.

인증 토큰·세션의 비교 열에는 hash만 저장해요. #9의 메일 outbox가 필요한 토큰 원문은 서버 키로
암호화하고 발송·만료 뒤 제거해야 해요. outbox·분산 rate limit은 후속 이슈예요. 실행기 lease 저장은 0004에 있어요.

## 로컬 적용과 기존 데이터 보호

```sh
mise run api:db:migrate
mise run api:db:migrate
mise exec -- bun run --cwd apps/api wrangler d1 execute DB --local --command "SELECT name FROM d1_migrations ORDER BY id; PRAGMA foreign_key_check"
mise run api:check
```

적용한 migration 파일과 적용 이력을 수정하지 않아요. 새 DB는 0001·0002·0003·0004를 순서대로 적용해요.
0004는 기존 행을 삭제하지 않고 실행권·호출 의도를 추가해요. 이전 running/started 시도는
미호출을 확인할 수 없어 다음 실행에서 결과 불명으로 처리해요. 종료 시도·보고서는 보존해요.
0003은 기존 channels·channel_videos·summary_requests·summary_attempts·reports·deliveries·
delivery_attempts 중 하나라도 행이 있으면 CHECK 실패로 파일 전체를 중단해요.
**기존 제품 데이터가 있는 DB의 자동 이관은 지원하지 않아요.** 생성 설정을 알 수 없는 본문을
임의로 대표 하나에 합치거나 이력을 버리지 않아요. 실패한 0003은 적용 이력에도 추가되지 않아요.

계정·세션·설정·수신 주소·확인 토큰 행은 그대로 보존해요. 제품 테이블을 비우는 명령은 가이드에
넣지 않아요. 실제 기존 데이터가 발견되면 작업을 중단하고 export·생성 설정·원래 report ID 소비자와
본문 차이를 확인한 별도 이관 설계가 필요해요. 실행 중인 작업을 강제로 합치거나 재호출하지 않아요.

회귀 검사는 실제 workerd·로컬 D1에서 빈 환경 반복 적용, 기존 본문이 있을 때 rollback·이력 보존,
계정·토큰 유지, A/B 공유·권한·댓글·개인 중지·발송과 batch 오류 rollback을 확인해요.
fixture와 공개 규칙 직접 INSERT는 실제 로그인·공개 관리 기능·공급자 성공의 증거가 아니에요.

## 조회 계획·계측

보관함의 정렬·cursor는 개인 권한 행의 `(created_at DESC, report_id DESC)`예요.
댓글·구독 예정·분석 대기·발송 대기에도 해당 조회 인덱스를 둬요.

```sql
EXPLAIN QUERY PLAN
SELECT r.id, r.title
FROM report_permissions p JOIN reports r ON r.id = p.report_id
WHERE p.audience = 'user' AND p.user_id = 'fixture-a'
  AND (p.created_at, p.report_id) < (1800000100, 'fixture-cursor')
ORDER BY p.created_at DESC, p.report_id DESC LIMIT 20;

PRAGMA foreign_key_check;
```

실제 구현은 prepare().bind()를 사용해요. 제목 부분 검색·채널·생성 경로 필터는 후보와 JOIN을
읽을 수 있어요. 일반 제목 인덱스가 `%검색어%`를 해결한다고 하지 않고 #12 실측 뒤 FTS를 비교해요.
소유자 조건이 없는 글로벌 보고서 스캔으로 개인 보관함을 구현하지 않아요.

binding 결과의 meta.rows_read·rows_written·size_after·duration을 기록해요. 읽은 행은 반환 건수와
다르고 인덱스 유지도 비용이에요. 로컬 계측은 원격 과금·운영 성능의 증거가 아니에요.
스키마 버전·SHA/dirty 상태·fixture 크기·필터·반환 건수를 함께 남겨요.
D1 SQL의 PRAGMA page_count는 사용하지 않아요. Wrangler가 종료된 뒤 로컬 SQLite를 mode=ro로
열어 page_count × page_size를 보조 확인할 수 있어요. 같은 persist 경로의 CLI는 순차 실행해요.

2026-10-28 Wrangler 4.152.0의 새 로컬 DB에서 빈 스키마의 보조 할당 크기는
94페이지 × 4,096바이트 = 385,024바이트였어요. workerd binding 검사는 읽기·쓰기·size_after 계측을
검사했고, 별도 CLI의 fixture 1개 보관함 조회는 permissions_library와 보고서 PK 인덱스를 사용했어요.
이 CLI JSON의 meta에는 duration만 있어 rows_read·rows_written 수치를 만들지 않았어요.

## 원격 적용·복구

원격 DB·Worker는 이번 작업에서 변경하지 않아요. [배포 절차](deployment.md)와 별도 승인을 따라요.
승인된 원격 작업에서도 정확한 환경·ID·SHA·pending migration·제품 행 수·백업을 먼저 확인해요.
0003 전환 대상에 기존 개인 제품 행이 있으면 0003은 적용하지 않아요. D1 Time Travel의 복구 범위·보존 기간은
실행 직전 확인하고, 무조건적인 전체 복원·DROP·이력 삭제를 실행하지 않아요.

실패하면 해당 파일의 rollback과 이전 파일의 성공을 구분해요. 수정은 다음 migration으로 하며
현재 데이터를 지우거나 기존 파일을 고쳐 성공으로 위장하지 않아요. DB 적용 후 Worker 배포 실패는
DB rollback이 아니에요. 기존 health Worker는 제품 테이블에 의존하지 않아요.

2026-10-28 확인한 공식 근거는 [외래키](https://developers.cloudflare.com/d1/sql-api/foreign-keys/),
[migration](https://developers.cloudflare.com/d1/reference/migrations/),
[batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)예요.
공통 스키마 검증은 ADR-0020, 실행기 검증은 [ADR-0022](decisions/0022-d1-scheduled-jobs.md)에 남겨요.
