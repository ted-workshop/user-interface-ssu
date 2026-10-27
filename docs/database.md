# D1 제품 데이터와 마이그레이션

[API 계약](api-contract.md)·[ADR-0019](decisions/0019-d1-product-schema.md)을 구현하는
`apps/api/migrations/0002_product_schema.sql`의 사용 규칙이에요.
제품 HTTP·작업 실행기는 아직 없고 로컬 D1의 저장 제약을 먼저 구현했어요.

## 저장 모델

| 테이블 | 역할과 수명 |
| --- | --- |
| `users` | 정규화한 이메일·닉네임·자기 기술적 비밀번호 hash·이메일 확인 시각 |
| `sessions` | 사용자와 세션 token hash·절대 만료. 로그아웃은 해당 행 삭제 |
| `user_settings` | 사용자별 확인 주기. 가입 시 생성하고 변경 시 검증 |
| `account_tokens` | 목적별 일회용 확인·복구 token hash. 재발급/만료 후 정리 가능 |
| `channels` | 계정별 등록, active/paused/deleted와 최초 확인·다음 확인 시각 |
| `recipients` | 로그인 이메일과 별개인 확인된 수신 주소. 삭제 시 tombstone |
| `channel_videos` | 등록별 관찰 영상 ID와 최초 기준 여부. 영상 발견의 중복 제거 |
| `summary_requests` | 계정·영상별 하나인 요청과 현재 상태, 불변 생성 경로 |
| `summary_attempts` | 요청의 최대 3회 실행 이력. 완료된 시도는 변경 금지 |
| `reports` | 성공한 시도·원본 출처·모델·Markdown 본문·시간 링크 검증 상태 |
| `deliveries` | 채널 리포트와 당시 수신 주소 스냅샷, 주소별 현재 발송 상태 |
| `delivery_attempts` | 발송의 최대 3회 실행·SMTP 접수/거부/결과 불명 이력 |

ID는 애플리케이션에서 UUID로 만들어요. 테스트의 짧은 ID는 fixture예요.
시간은 UTC Unix 초 `INTEGER`, 누락은 SQL `NULL`이고 테이블은 SQLite `STRICT`예요.
`usage_json`의 누락 토큰·할당량은 `null`로 보존하며 추정값을 쓰지 않아요.
이메일 형식·닉네임 NFC·비밀번호 정책·URL 출처는 API에서 검증해요. DB의 길이·정규화 검사가
그 검증 전체를 대신하지 않아요. 비밀값·본문·주소를 공개 계측 로그에 넣지 않아요.
현재 공급자 메타데이터 함수에 없는 채널 URL은 `NULL`로 저장하고 #11에서 실제 출처로 보완해요.
채널명에서 주소를 꾸며내거나 빈 문자열로 미확인을 감추지 않아요.

`(id, user_id)` 복합 외래키는 다른 소유자의 채널·수신 주소·요청·리포트를 연결하지 못하게 해요.
조회 권한을 자동으로 제한하는 row-level security는 아니에요.
모든 개인 SELECT/UPDATE/DELETE의 조건에 세션에서 얻은 `user_id = ?`를 넣고 bind해야 해요.
body의 user ID나 ID만으로 조회하면 안 돼요. 다른 계정의 ID는 일반 404로 처리해요.

## 변경·실행 경계

- 새 요청은 `queued`로만 만들어요. `(user_id, video_id)` unique 충돌 시 기존 본인 요청을 읽어요.
  새 ID·새 원본 경로로 우회하지 않아요. 계정당 `running` 요청은 하나예요.
- 공급자 호출 전에 조건부 claim과 시작 시도 행을 같은 `DB.batch()`에 저장해요.
  UPDATE 0건은 SQL 오류가 아니므로 batch 자동 rollback을 기대하면 안 돼요.
  이어지는 INSERT도 claim 결과·상태·시도 번호를 조건으로 삼고 결과의 변경 행 수를 확인해요.
  이미 있는 running 시도를 인수한 것으로 착각해 외부 호출하지 않아요.
- 공급자 성공 후 시도 `succeeded` → 리포트 INSERT → 요청 `completed`를 한 batch에 넣어요.
  실패하면 모두 되돌아가요. 리포트 없이 완료하거나 성공 시도 없이 리포트를 넣을 수 없어요.
  채널 결과의 주소별 발송 INSERT는 리포트·완료 저장과 같은 batch에서 확정해요.
  중지·수신 설정과 경합하면 발송 적격 조건을 확인하는 `INSERT … SELECT`로 대상만 선택해요.
  메일 부적격 때문에 이미 얻은 리포트까지 잃지 않게 해요.
- 재시도는 기존 요청에 새 시도 행을 추가해요. 끝난 시도·본문·소유자·생성 경로는 덮어쓰지 않아요.
  현재 시도 번호·상태·총 3회 한도와 실패의 재시도 가능성을 조건으로 갱신해요.
  lease 만료·프로세스 종료만으로 공급자 미실행을 단정하지 않아요. 결과 유실은 #10이
  `ambiguous` 시도와 `provider_outcome_unknown` 실패로 보존하고 자동 재호출하지 않아요.
- 발송은 `(report_id, recipient_id)`와 `(report_id, recipient_email)` 모두 unique예요.
  주소 삭제 후 재추가한 새 ID로도 같은 리포트를 중복 발송하지 못해요.
  `sending` claim 때 현재 채널·수신 주소의 유효성을 DB에서 다시 검사해요.
  실제 SMTP 바로 전에도 상태를 확인하지만 이미 전송 중인 메일의 회수까지 보장하지 않아요.
- SMTP 접수 시 시도 `accepted`와 발송 `sent`를 한 batch로 기록해요. 실패/결과 불명도 시도 종료와
  발송 상태를 함께 기록해요. 성공한 발송·끝난 시도는 변경할 수 없어요.
  `ambiguous`에서 `sent`로 수동 정정할 때는 보낸편지함/수신함에서 확인한 증거의 비밀값 없는
  참조를 `resolution_evidence`에 남겨요. 문자열의 진위를 DB가 확인하는 것은 아니에요.
  새 발송 시도로 위장하지 않아요.
- 채널 삭제 API는 `status=deleted`예요. 중지·삭제 trigger는 `queued|failed` 발송만 취소해요.
  리포트·시도·기존 연결을 지우거나 완료 발송을 취소하지 않아요. 삭제한 등록 ID는 부활하지 않아요.
  재등록은 새 ID·새 관찰 기준이에요. recipient 삭제도 대기 발송과 확인 토큰을 정리해요.
- 비밀번호 복구는 유효한 미소비 토큰을 조건으로 비밀번호 변경·세션 폐기·토큰 폐기를 한 batch에
  묶어요. 토큰 UPDATE가 0건이어도 나머지 작업이 실행되지 않도록 각 문장에도 같은 유효성 조건이
  필요해요. 토큰 소비를 먼저 별도 commit한 뒤 비밀번호를 바꾸지 않아요.
- 토큰 메일 outbox·분산 rate limit 저장은 #9, 확인 작업·실행 수단별 claim은 #10·#14가 필요한
  최소 migration으로 추가해요. 공개·댓글 #23과 모음 #24 테이블은 이번에 만들지 않아요.

확인/복구 토큰과 세션 원문을 인증 열에 저장하지 않아요. 비동기 인증 메일의 재전송에 필요한
토큰은 #9의 outbox에서 별도 서버 키로 암호화해 저장하고 발송·만료 뒤 제거해야 해요.
원문 토큰을 작업 로그나 payload JSON에 평문으로 남기는 구현은 이 계약에 맞지 않아요.

## 로컬 적용·재현

작업 디렉터리의 DB만 사용해요. 원격 ID를 로컬 설정에 복사하지 않아요.

```sh
mise run api:db:migrate
mise run api:db:migrate
mise exec -- bun run --cwd apps/api wrangler d1 execute DB --local --command "SELECT name FROM d1_migrations ORDER BY id; PRAGMA foreign_key_check"
mise run api:check
```

`0001_initialize.sql`은 이전 이력을 보존하고, 새 `0002_product_schema.sql`이 제품 테이블을 추가해요.
적용한 migration 파일을 수정하지 않고 다음 번호를 추가해요. 새 환경에서 두 파일을 모두 적용하며
재실행은 이미 적용한 파일을 건너뛰어요. 테스트는 Cloudflare Vitest plugin의 실제 workerd·로컬 D1을
사용해요. SQLite의 외래키 검사를 끄지 않아요.

최초 실패 검사는 제품 migration이 없는 상태에서 17개가 `no such table`로 실패했어요.
구현 후 중복·교차 소유·직접 결과 발송·상태 전이·불변 이력·중지/삭제 보존·원자적 rollback과
실행 계획을 검사해요. 이는 seeded 로컬 자료이며 실제 계정·공급자·원격 운영 증거가 아니에요.

## 조회 계획·읽기·쓰기·용량

사용자 목록의 정렬과 cursor는 `(created_at DESC, id DESC)`예요.
리포트 전체·채널·생성 경로별 인덱스와 작업/발송 대기 인덱스를 두고, 나머지는 외래키·중복 방지에
필요한 인덱스예요. 인덱스도 쓰기·용량 비용이 있어 근거 없이 추가하지 않아요.

```sql
EXPLAIN QUERY PLAN
SELECT id, title FROM reports
WHERE user_id = 'fixture-owner' AND (created_at, id) < (1800000100, 'fixture-cursor')
ORDER BY created_at DESC, id DESC LIMIT 20;

EXPLAIN QUERY PLAN
SELECT id FROM reports WHERE user_id = 'fixture-owner' AND channel_url = 'https://www.youtube.com/@fixture'
ORDER BY created_at DESC, id DESC LIMIT 20;

PRAGMA foreign_key_check;
```

위 SQL의 값은 예시예요. 실제 구현은 `prepare().bind()`를 써요.
workerd 검사에서 keyset 조회가 `SEARCH reports USING INDEX`를 사용하고 같은 계정 결과만 반환하는지
확인해요. 제목 부분 검색은 해당 계정의 후보 행을 스캔할 수 있어요. `%검색어%`에 일반 제목
인덱스를 추가해서 해결됐다고 보지 않아요. 사용량 측정 후 필요하면 #12에서 FTS를 비교해요.

binding 결과의 `meta.rows_read`, `meta.rows_written`, `meta.size_after`, `meta.duration`을 기록해요.
읽은 행 수는 반환 건수와 다르고 index 갱신도 비용에 영향을 줘요.
로컬 Miniflare의 계측은 원격 과금 실측이 아니므로 실제 운영량·무료 가용량으로 외삽하지 않아요.
D1 SQL 경로의 `PRAGMA page_count`는 이번 Wrangler 4.152.0에서 `SQLITE_AUTH`로 거부됐어요.
해당 SQL을 용량 계측 명령으로 쓰지 않아요. 보조 확인은 Wrangler가 종료된 뒤 로컬 `.sqlite`를
Python SQLite의 `mode=ro` 연결로 열어 `page_count × page_size`를 읽었어요.
빈 제품 DB는 74페이지 × 4,096바이트 = 303,104바이트였어요. 별도 `metadata.sqlite`는 제외했어요.
이는 로컬 할당 크기이며 원격 전체 사용량은 승인된 환경의 D1 analytics·DB 정보와 비교해야 해요.
같은 persist 경로에 여러 Wrangler를 동시에 띄우면 `SQLITE_BUSY_RECOVERY`가 생길 수 있어 CLI 검사는
순차 실행해요. 순차 실행에서 migration 이력·외래키·keyset 실행 계획을 다시 확인했어요.

재현 시 DB 스키마 버전·커밋/dirty 상태·로컬/원격·fixture 크기·필터·반환 건수를 함께 남겨요.
원격 용량·행 한도 수치와 실제 처리 시간을 이번 테스트 결과로 만들지 않아요.

## 원격 적용과 실패 복구

실제 원격 적용은 [기존 수동 배포](deployment.md) 절차와 별도 승인을 따라요. 이번 작업에서 원격
state·DB·Worker를 변경하지 않아요. 적용 전 정확한 환경·DB ID·SHA·pending migration과 백업을 확인해요.
현재 migration은 새 테이블만 추가하므로 기존 health Worker는 계속 동작할 수 있어요.

1. 로컬의 빈 DB와 현재 스키마 사본에서 migration·원래 사용자 경로를 검사해요.
2. 승인된 원격 적용 직전에 복구 시점과 export/Time Travel의 이용 가능 범위·보존 기간을 확인해요.
3. migration 실패 시 오류·적용 이력을 읽어요. 해당 파일 실패의 rollback과 이미 성공한 이전 파일을
   구분해요. `d1_migrations` 행을 지우거나 파일을 고쳐 성공으로 위장하지 않아요.
4. 데이터가 남아 있다면 기존 호환 Worker를 유지하고 다음 migration으로 수정해요.
   파괴적 DROP·자동 down·원격 전체 복원은 실행하지 않아요.
5. DB 적용 후 Worker 배포 실패는 DB rollback이 아니에요. 같은 스키마와 호환되는 SHA를 재배포해요.
   전체 DB 복원은 이후 정상 쓰기도 잃을 수 있으므로 영향·복구점·추가 승인을 확인해요.

실패 검사에서는 후속 DDL 오류가 앞선 테이블 생성과 migration 이력까지 되돌리는지 확인해요.
원격 실패·복구를 실행한 증거는 아니에요.

2026-10-27 확인한 공식 근거는 [외래키](https://developers.cloudflare.com/d1/sql-api/foreign-keys/),
[batch 트랜잭션](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch),
[migration](https://developers.cloudflare.com/d1/reference/migrations/),
[결과 계측](https://developers.cloudflare.com/d1/worker-api/return-object/),
[지원 SQL·PRAGMA](https://developers.cloudflare.com/d1/sql-api/sql-statements/),
[SQLite partial unique index](https://www.sqlite.org/partialindex.html)예요.
