# ADR-0019: D1 제약과 불변 시도로 계정별 제품 이력을 보존해요

- 상태: 대체
- 작성·확정일: 2026-10-27
- 대체일: 2026-10-28, [ADR-0020](0020-shared-analysis-and-report-permissions.md)의 공통 보고서 모델과 0003이 대체해요. 아래 구현·검증은 당시 0002의 이력으로 보존해요.
- 확정 근거: #7·#8 진행 요청 범위 안에서 API 계약과 기존 제품 명세를 구현한 판단이에요.
- 관련 기록: [ADR-0001](0001-workers-d1-free-tier.md), [ADR-0003](0003-shared-modules-sync-async.md),
  [ADR-0009](0009-manual-deployment-ownership.md), [ADR-0018](0018-api-contract-and-policies.md)
- 구현·검증 상태: 제품 migration·로컬 D1 회귀 검사·[운영 가이드](../database.md)를 추가했어요.
  실제 검사의 범위는 아래에 남겨요. 제품 HTTP·실행기·원격 migration·배포는 이번 범위가 아니에요.

## 문제와 현재 상태

초기 `0001_initialize.sql`은 `SELECT 1`뿐이에요. #8의 제품 저장 규칙을 제약 없이 각 기능에서
따로 구현하면 타인 소유 연결, 중복 분석·발송, 채널 삭제로 인한 리포트 유실이 생길 수 있어요.
[API 계약](../api-contract.md)은 같은 계정·영상 재사용, 최초 생성 경로, 저장 후 발송과 재시도 이력을
요구해요. 소비자·제품 데이터는 아직 없고 기존 health Worker는 제품 테이블을 읽지 않아요.

## 결정

- SQLite STRICT·정수 Unix 초·애플리케이션 UUID를 사용해요. 기존 migration을 유지하고
  `0002_product_schema.sql`로 필요한 12개 제품 테이블을 추가해요.
- 개인 관계는 `(id, user_id)` 복합 FK로 연결하고, 모든 개인 조회는 별도로 소유자 조건을 bind해요.
  FK가 SELECT 접근 제어나 row-level security를 제공한다고 보지 않아요.
- 현재 메타데이터 모듈이 반환하지 않는 채널 URL은 nullable로 저장해요. #11에서 검증한 출처를
  보완하고, 미확인 값을 이름으로 추측하거나 빈 문자열로 대체하지 않아요.
- 요청·리포트는 계정·영상당 하나예요. 현재 상태와 실행 시도를 분리해 최대 3개의 시도를 보존하고
  끝난 시도·생성 경로·저장 본문은 바꾸지 않아요. 동일 계정에서 running 분석은 하나예요.
- 보고서 INSERT에는 같은 계정·영상·생성 경로의 성공 시도가 필요하고 요청 완료에는 저장된
  리포트가 필요해요. 상태 전이·일회용 토큰 재사용·완료 이력 변경은 trigger로도 막아요.
- 채널·수신 주소는 논리 삭제해요. 이력을 유지하면서 재등록은 새 ID로 분리해요.
  활성 등록·주소만 partial unique로 제한해요. 채널 초기 관찰은 영상 ID 집합과 빈 성공 시각을 저장해요.
- 발송은 리포트·당시 주소의 스냅샷이에요. 주소 ID와 실제 이메일 모두 중복을 막아요.
  직접 결과는 발송 대상이 아니고 현재 채널·수신 설정이 유효해야 시작해요.
  중지·삭제 trigger는 미발송만 취소해요. 성공 발송과 결과 본문은 남겨요.
- 메일 결과 불명은 재발송하지 않아요. 수동 접수 확인은 기존 행의 증거 참조로 기록하고
  성공한 SMTP 시도를 새로 꾸며내지 않아요. DB가 그 증거의 실제 진위를 보장하지는 않아요.
- 다중 변경은 D1 `batch()`와 조건부 변경을 사용해요. 0행 변경은 오류가 아니라는 점을 계약에
  명시해 토큰·claim 경합을 무조건 성공으로 처리하지 않아요.
- 저장·조회 구현의 경계와 인덱스·계측·migration 실패 절차는 D1 가이드에 적어요.
  별도 ORM·DB 서비스·진단용 HTTP·사용하지 않는 repository 계층은 추가하지 않아요.

## 근거와 대안

2026-10-27 다음 공식 자료·설치된 타입을 확인했어요.

- [D1 외래키](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)와 실제 로컬 D1은
  외래키를 강제해요. PostgreSQL RLS·트랜잭션 클라이언트의 동작을 가져오지 않아요.
- [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)는 순서대로 실행하는
  트랜잭션이에요. 개별 SQL 오류의 전체 rollback을 검사하고 애플리케이션의 조건 검사와 구분해요.
- [SQLite partial index](https://www.sqlite.org/partialindex.html)는 활성 등록과 동시 실행 중복을
  데이터 계층에서 제한할 수 있어요. 앱에서 SELECT 후 INSERT만 하면 경합에 취약해 채택하지 않아요.
- 물리적 CASCADE 삭제는 정리하기 쉽지만 채널 삭제 후 보고서 보존과 재시도 증거를 깨요.
  복합 FK의 SET NULL은 소유자도 비우게 될 위험이 있어 논리 삭제·RESTRICT를 선택해요.
- 모든 관계를 trigger로만 만들면 스키마가 복잡해져 FK·CHECK·unique로 표현할 수 있는 것은 먼저
  그 제약을 사용해요. trigger는 테이블 간 완료 증거·불변 이력·취소와 상태 전이에 한정해요.
- 현재 상태 하나만 저장하면 단순하지만 과거 성공·실패·응답 불명과 재시도 횟수를 잃어요.
  요청/시도를 분리하고 본문은 한 번만 저장해요. 분석 결과의 계정 간 전역 캐시는 채택하지 않아요.
- 제목 부분 검색용 FTS는 규모가 커지면 유효해요. 아직 데이터·측정 근거가 없어 지금은 사용자·채널·
  생성 경로별 keyset 인덱스로 시작하고 #12의 실측에서 재검토해요.

## 가정·한계와 영향

상태 제약·소유 FK는 잘못된 저장을 막지만 실제 인증·명시적 retry 권한·공급자 정확히 한 번 호출을
완성하지 않아요. #9의 mail outbox·분산 제한, #10·#14 실행 수단의 저장은 해당 구현 때 추가해요.
TTL 정리·계정 탈퇴·리포트 삭제 정책을 임의로 실행하지 않아요. 개인정보의 장기 보관 요구가
생기면 이력 보존과 함께 삭제·익명화 정책을 결정해야 해요.
#5의 길이·할당량을 가정한 열이나 수치를 만들지 않아요. SDK 기본 재시도와 제품 시도 수는 달라요.
로컬 fixture의 계측은 원격 사용량·과금·실제 성능의 증거가 아니에요.
원격 적용은 기존 수동 배포와 별도 승인을 따라요. 자동 down·파괴적 정리는 추가하지 않아요.

## 검증과 재검토 조건

제품 migration 없이 먼저 실행한 17개 검사는 `no such table`로 실패했어요.
추가한 workerd 검사는 migration 반복/실패 rollback, 이메일·토큰·계정 간 FK, 중복 분석,
완료 증거·불변 시도·리포트, 직접 결과 소급 발송 금지, 채널/주소 중지·삭제 보존,
주소별 중복·성공/결과 불명 이력, DB batch rollback과 keyset 실행 계획·계측을 확인해요.
2026-10-27 macOS arm64에서 아래를 확인했어요. 검증 HEAD는
`5f23287a977fb2fe02bd21c064833a9662322224`에 이 작업의 미커밋 변경을 더한 상태예요.

- `mise run api:check`와 `mise run check` 통과: workerd 113개 중 신규 DB 검사 23개,
  Bun 공급자 도구 16개·공통 도구 49개, Android 포맷·Lint·단위 테스트·debug 빌드,
  두 Terraform root의 backend 없는 init·validate를 포함해요.
  전체 검사 뒤 마지막 채널 URL의 NULL 보존 변경에 대해 `api:check`를 다시 통과했어요.
- 다른 작업의 버전 고정 파일은 가져오지 않고 환경 변수로 Bun 1.4.4·Node.js 24.22.1·
  Temurin 25.0.5+8을 선택했어요. `MISE_BUN_VERSION=1.4.4 MISE_NODE_VERSION=24.22.1
  MISE_JAVA_VERSION=temurin-25.0.5+8.0.LTS`와 개인 `ANDROID_HOME`을 사용했어요.
  실제 Gradle daemon도 Temurin 경로에서 실행된 것을 확인했어요.
- 최종 스키마의 새 `.wrangler/schema-verify-current` DB에 Wrangler 4.152.0으로 두 migration을 적용하고
  재실행이 `No migrations to apply`인지 확인했어요. 외래키 위반은 0개,
  keyset 계획은 `SEARCH reports USING INDEX reports_owner_created`였어요.
- 동시 Wrangler 검증은 같은 DB의 잠금 오류를 일으켜 순차 실행으로 수정했어요.
  D1 SQL의 `PRAGMA page_count`는 `SQLITE_AUTH`여서 가이드에서 제거하고 binding 계측과
  로컬 SQLite 읽기 전용 크기 확인으로 구분했어요. 빈 제품 DB 보조 할당 크기는 303,104바이트예요.
- 실제 Gemini·SMTP·기기 UI·원격 DB·배포는 실행하지 않았어요. #7의 공급자·담당자 검토 gate는 남아요.

SQL 제약이 실제 유효한 사용자 경로를 막거나 처리량·조회 비용이 요구를 충족하지 못하면 해당
트랜잭션·인덱스를 재검토해요. 새 기능은 이력을 훼손하지 않는 후속 migration을 사용해요.
실제 공급자·원격 복구·UI 검증 없이 저장 기반 전체 제품 완료로 보고하지 않아요.

## 반론과 변경 이력

- 2026-10-27: 앱 계층만으로 중복·소유권을 검사하는 대안을 검토했어요. 동시 실행과 후속 구현의
  실수를 DB에서 거부할 수 있도록 unique·복합 FK·완료/불변 trigger를 함께 사용해요.
