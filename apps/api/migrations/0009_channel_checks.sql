-- 지금 확인·예약 확인의 완료와 채널별 실패를 나눠 남겨요. 영상·요약 결과는 기존 표를 그대로 사용해요.
CREATE TABLE channel_checks (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  manual INTEGER NOT NULL DEFAULT 0 CHECK (manual IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  failure_code TEXT CHECK (failure_code IN ('configuration', 'interrupted')),
  lease_token TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at INTEGER,
  finished_at INTEGER,
  CHECK ((status = 'failed') = (failure_code IS NOT NULL)),
  CHECK (
    (status = 'queued' AND started_at IS NULL AND finished_at IS NULL AND lease_token IS NULL) OR
    (status = 'running' AND started_at IS NOT NULL AND finished_at IS NULL AND lease_token IS NOT NULL) OR
    (status IN ('completed', 'failed') AND started_at IS NOT NULL AND finished_at IS NOT NULL AND finished_at >= started_at)
  ),
  UNIQUE (id, user_id)
) STRICT;
CREATE INDEX channel_checks_owner_created ON channel_checks(user_id, created_at DESC, id DESC);
CREATE INDEX channel_checks_queued ON channel_checks(created_at, id) WHERE status = 'queued';
-- 같은 계정의 확인은 한 번에 하나만 대기·실행해요.
CREATE UNIQUE INDEX channel_checks_one_active ON channel_checks(user_id) WHERE status IN ('queued', 'running');

-- 확인을 시도한 채널별 결과예요. 확인 완료와 개별 영상 분석 완료는 다른 상태예요.
CREATE TABLE channel_check_results (
  check_id TEXT NOT NULL REFERENCES channel_checks(id) ON DELETE RESTRICT,
  subscription_id TEXT NOT NULL REFERENCES channel_subscriptions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  failure_code TEXT CHECK (failure_code IN ('provider_unavailable', 'invalid_response', 'processing_failed')),
  last_checked_at INTEGER,
  CHECK ((status = 'failed') = (failure_code IS NOT NULL)),
  PRIMARY KEY (check_id, subscription_id)
) STRICT;

CREATE TRIGGER channel_check_identity BEFORE UPDATE OF id, user_id, manual, created_at ON channel_checks
BEGIN SELECT RAISE(ABORT, 'channel_check_identity_immutable'); END;
CREATE TRIGGER channel_check_transition BEFORE UPDATE OF status ON channel_checks
WHEN NEW.status != OLD.status AND NOT (
  (OLD.status = 'queued' AND NEW.status IN ('running', 'failed')) OR
  (OLD.status = 'running' AND NEW.status IN ('completed', 'failed'))
)
BEGIN SELECT RAISE(ABORT, 'channel_check_invalid_transition'); END;
CREATE TRIGGER channel_check_result_history BEFORE UPDATE ON channel_check_results
BEGIN SELECT RAISE(ABORT, 'channel_check_result_immutable'); END;
