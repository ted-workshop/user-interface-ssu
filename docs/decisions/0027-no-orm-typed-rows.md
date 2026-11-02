# ADR-0027: ORM을 도입하지 않고 행 타입을 한 곳에서 관리해요

- 상태: 확정
- 작성·확정일: 2026-11-02
- 확정 근거: 사용자가 "SQL을 직접 쓰는 부분 개선" 질문에서 제시한 선택지 중 타입 보강안을
  직접 선택했어요("그럼 그냥 A 선택지로 하자"). ORM·쿼리 빌더 도입은 이 선택으로 기각해요.
- 관련 기록: [ADR-0019](0019-d1-product-schema.md)의 "별도 ORM·repository 계층을 추가하지 않아요"와
  [ADR-0023](0023-background-runner-readability.md)의 "SQL은 기존 바인딩 방식을 유지하고
  쿼리·타입 불일치가 반복되면 별도 도구를 비교해요"를 그대로 적용해요.
- 구현·검증 상태: `apps/api/src/rows.ts`와 SQL alias 변경을 구현하고 로컬 검사를 실행했어요.
  배포·원격 DB·실제 공급자 검증은 이 기록의 범위가 아니에요.

## 문제와 현재 상태

`apps/api/src`의 D1 접근은 `statement()` 헬퍼(`apps/api/src/jobs/shared.ts:27-33`)를 거친 직접 SQL이에요.
2026-11-02 확인한 호출은 38곳(`jobs/analysis.ts` 19, `jobs/delivery.ts` 18, `auth.ts` 1)이고,
그중 13개 `db.batch()` 안에 약 30곳이 들어 있어요.

문제는 SQL 문법이 아니라 **행 타입이 컴파일러 검사 밖에 있다는 점**이었어요.
`.first<{...}>()`처럼 인라인 타입을 단언하는 자리가 8곳 있었고, 같은 테이블의 타입이
파일마다 흩어져 스키마 변경 시 고칠 곳이 여러 곳이에요. snake_case 컬럼명이 그대로
호출부까지 흘러나와 `session.user_id` 같은 이름이 응답 조립 코드에 섞여 있어요.

## 결정

- ORM·쿼리 빌더(Drizzle, Kysely)를 도입하지 않아요. SQL과 `db.batch()` 전이는 그대로 둬요.
- 행 타입은 `apps/api/src/rows.ts` 한 파일에 모아요. repository 계층이나 매핑 함수는 만들지 않아요.
- SQL은 snake_case 컬럼을 camelCase alias로 돌려주고(`s.user_id AS userId`), 그 이름을
  `rows.ts`의 타입과 맞춰요. 다음처럼 alias와 타입 이름이 어긋나면 컴파일이 먼저 실패해요.

  ```
  src/jobs/runner.ts(64,11): error TS2551: Property 'generation_config_json' does not exist on type 'AnalysisJobRow'.
  ```

- 이미 올바른 형태였던 `RequestRow`·`DeliveryRow`(alias + 단일 타입)를 `rows.ts`로 옮겨
  기준을 하나로 맞췄어요.
- 원자성 검증은 계속 workerd 테스트가 맡아요. 타입은 컴파일 시점 보조이고,
  SQL 동작의 증거가 아니에요.

## 근거와 대안

확인한 사실(2026-11-02, npm registry·Cloudflare 문서):

- `kysely` 0.29.8(2026-11-01 배포)과 달리 D1 dialect인 `kysely-d1`은 **0.4.0, 2025-04-19 마지막 배포**예요.
  peer 의존성이 `kysely: "*"`라 버전 호환 보장이 없어요.
- Cloudflare [D1 community projects](https://developers.cloudflare.com/d1/reference/community-projects/)는
  kysely-d1과 Drizzle을 모두 커뮤니티 목록에 두고 "not maintained by the Cloudflare D1 team"이라고 밝혀요.
  둘 다 공식 지원으로 볼 근거가 없어요.
- `kysely-d1`은 `transaction()`을 구현하지 않아요([issue #2](https://github.com/aidenwallis/kysely-d1/issues/2),
  2022 개설, 2025-10-17 갱신, open). D1 `batch()`가 트랜잭션이므로
  `.compile()` → `prepare().bind()` → `db.batch()` → `D1Result[]`를 `QueryResult`로 변환하는
  자체 헬퍼를 유지해야 해요.

| 대안 | 장점 | 채택하지 않은 이유 |
| --- | --- | --- |
| 직접 SQL 유지 + 행 타입 단일화 | 새 의존성 0, batch 전이 그대로, 이득이 나는 8곳을 바로 해결 | 쿼리 빌더의 자동 완성·오타 방지는 없어요 |
| Drizzle(쿼리만) | D1 드라이버와 `db.batch()` 지원, 스키마→타입 | 손수 쓴 마이그레이션 SQL(`STRICT`·`CHECK`·guard 전환·`DROP TRIGGER`)과 스키마가 이중 관리돼요. 드리프트 감지 검사 없이는 조용히 어긋나요 |
| Drizzle + drizzle-kit 마이그레이션 | 스키마 단일 소스 | `migrations/0003_shared_reports.sql` 같은 전환·트리거를 생성기가 만들지 못해 손편집이 필요하고, `wrangler d1 migrations apply`(로컬·원격·Terraform D1) 절차를 통째로 교체해야 해요 |
| Kysely | 마이그레이션 소유권을 wrangler에 그대로 두고 SQL에 가까운 타입을 얻어요 | 이득이 나는 호출은 8곳인데 손실은 약 30곳(batch 내부 SQL이 raw에 가깝게 남고 결과를 인덱스로 꺼내야 함)이에요. 자체 batch 헬퍼와 18개월 정체된 dialect를 함께 유지해야 해요 |

Kysely가 Drizzle보다 이 저장소 제약에 맞는 도구라는 판단은 유지해요. 다만 그 이득이
"쿼리 수·조인이 늘어 SQL이 병목이 될 때" 생기므로, 지금 도입은 ADR-0023의 재검토 조건보다
앞서 있어요.

## 가정·한계와 영향

- alias 이름은 SQLite가 쓴 대소문자를 보존한다는 동작에 기대요. 이 동작은 workerd D1 테스트가
  응답 필드(`videoId` 등)를 검사하면서 간접적으로 확인돼요.
- 바뀌는 계약은 없어요. HTTP 응답·DB 스키마·마이그레이션·`db.batch()` 문장은 그대로예요.
- `rows.ts`는 손으로 유지해요. 컬럼이 늘면 SQL과 타입을 함께 고쳐야 하고, 이 비용은
  ORM을 도입해도(스키마를 손으로 쓴다면) 같아요.
- 2026-11-02 현재 열린 PR #39가 만드는 `apps/api/src/reports.ts`도 같은 방식(alias + `rows.ts`)을
  따르면 이 결정이 유지돼요. 합치지 않으면 그 파일에 인라인 타입이 하나 더 생겨요.

## 검증과 재검토 조건

로컬에서 확인한 내용(worktree `feature/db-row-types`, 기준 커밋 `2b84d23`):

- `tsc --noEmit`이 alias를 따라가지 않는 호출부 5곳(`src/jobs/runner.ts:64`, `:65`, `:70`, `:136`, `:139`)을
  먼저 잡아냈고, 그 호출부를 고친 뒤 앱·`test`·`tools` 타입 검사가 모두 통과했어요.
- workerd 테스트 226개가 통과했어요. 세션 사용자 조회, 작업 조회, 발송 본문, 만료 회수 경로가
  바뀐 alias를 실제 SQL로 통과했다는 증거예요.
- 이 검사는 컴파일·로컬 실행 증거이며 원격 배포·실제 Gemini·SMTP 성공의 증거가 아니에요.

다음 중 하나가 나타나면 이 결정을 다시 검토해요.

- 행 타입과 스키마 불일치가 실제 버그나 리뷰 지적으로 2회 이상 반복될 때 → Kysely PoC를 3개 호출
  (`auth.ts` 세션 조회, `getAnalysisJob`, `getDeliveryMessage`)에서 시작해 diff와 가독성으로 판정해요.
- 조회 쿼리 수가 지금보다 크게 늘거나 조인이 복잡해져 `rows.ts` 손유지 비용이 커질 때.
- `kysely-d1`이 `kysely` 새 버전과 맞물려 유지보수를 재개하거나 공식 D1 지원이 생길 때.

## 반론과 변경 이력

- 2026-11-02: 사용자가 ORM 도입 가능성을 먼저 물었고, 검토 결과 직접 SQL 유지 + 행 타입 단일화를
  선택했어요. Drizzle의 이중 스키마 관리와 Kysely의 batch 공백을 채택하지 않은 이유로 남겨요.
- 2026-11-02: 구현 후 위 검증 결과를 기록했어요. 배포·원격 검증은 실행하지 않았어요.
