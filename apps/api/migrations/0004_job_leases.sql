-- 접수 행 자체를 대기열로 사용하고 실행권과 외부 호출 시작을 구분해요.
ALTER TABLE analysis_jobs ADD COLUMN lease_token TEXT;
ALTER TABLE analysis_jobs ADD COLUMN lease_expires_at INTEGER;
ALTER TABLE analysis_attempts ADD COLUMN dispatched_at INTEGER;
ALTER TABLE deliveries ADD COLUMN lease_token TEXT;
ALTER TABLE deliveries ADD COLUMN lease_expires_at INTEGER;
ALTER TABLE delivery_attempts ADD COLUMN dispatched_at INTEGER;
CREATE INDEX analysis_jobs_running ON analysis_jobs(lease_expires_at, id) WHERE status = 'running';
CREATE INDEX deliveries_sending ON deliveries(lease_expires_at, id) WHERE status = 'sending';

-- 이전 실행의 호출 여부는 알 수 없으므로 미호출로 추정해 재실행하지 않아요.
UPDATE analysis_attempts SET dispatched_at = started_at WHERE status = 'running';
UPDATE delivery_attempts SET dispatched_at = started_at WHERE status = 'started';

CREATE TRIGGER analysis_dispatch_history BEFORE UPDATE OF dispatched_at ON analysis_attempts
WHEN OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS NOT OLD.dispatched_at
BEGIN SELECT RAISE(ABORT, 'analysis_dispatch_immutable'); END;
CREATE TRIGGER delivery_dispatch_history BEFORE UPDATE OF dispatched_at ON delivery_attempts
WHEN OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS NOT OLD.dispatched_at
BEGIN SELECT RAISE(ABORT, 'delivery_dispatch_immutable'); END;
