-- 생성 설정이 없는 과거 제품 행은 자동 합치지 않아요. 실패하면 이 파일 전체가 rollback돼요.
CREATE TABLE shared_report_migration_guard (
  legacy_rows INTEGER NOT NULL CHECK (legacy_rows = 0)
) STRICT;
INSERT INTO shared_report_migration_guard
SELECT (SELECT count(*) FROM channels) + (SELECT count(*) FROM channel_videos)
  + (SELECT count(*) FROM summary_requests) + (SELECT count(*) FROM summary_attempts)
  + (SELECT count(*) FROM reports) + (SELECT count(*) FROM deliveries)
  + (SELECT count(*) FROM delivery_attempts);
DROP TABLE shared_report_migration_guard;

-- 계정·세션·설정·수신 주소·확인 토큰은 유지하고 비어 있는 제품 관계만 교체해요.
DROP TRIGGER recipient_stop;
DROP TABLE delivery_attempts;
DROP TABLE deliveries;
DROP TABLE reports;
DROP TABLE summary_attempts;
DROP TABLE summary_requests;
DROP TABLE channel_videos;
DROP TABLE channels;

CREATE TABLE channels (
  id TEXT PRIMARY KEY NOT NULL,
  youtube_channel_id TEXT NOT NULL UNIQUE CHECK (length(trim(youtube_channel_id)) > 0),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;
CREATE TABLE videos (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 11 AND id NOT GLOB '*[^a-zA-Z0-9_-]*'),
  channel_id TEXT REFERENCES channels(id) ON DELETE RESTRICT,
  title TEXT,
  published_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;
CREATE INDEX videos_channel ON videos(channel_id);
CREATE TABLE channel_subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'deleted')),
  baseline_initialized_at INTEGER,
  last_checked_at INTEGER,
  next_check_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (id, user_id)
) STRICT;
CREATE UNIQUE INDEX subscriptions_live_identity ON channel_subscriptions(user_id, channel_id) WHERE status != 'deleted';
CREATE INDEX subscriptions_owner_created ON channel_subscriptions(user_id, created_at DESC, id DESC);
CREATE INDEX subscriptions_due ON channel_subscriptions(next_check_at) WHERE status = 'active';
CREATE TABLE subscription_videos (
  subscription_id TEXT NOT NULL REFERENCES channel_subscriptions(id) ON DELETE RESTRICT,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE RESTRICT,
  is_baseline INTEGER NOT NULL CHECK (is_baseline IN (0, 1)),
  discovered_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (subscription_id, video_id)
) STRICT;
CREATE INDEX subscription_videos_video ON subscription_videos(video_id);
CREATE TABLE analysis_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE RESTRICT,
  generation_key TEXT NOT NULL CHECK (length(trim(generation_key)) > 0),
  generation_config_json TEXT NOT NULL CHECK (json_valid(generation_config_json) AND json_type(generation_config_json) = 'object'),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  failure_code TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK ((status = 'failed') = (failure_code IS NOT NULL)),
  UNIQUE (video_id, generation_key)
) STRICT;
CREATE INDEX analysis_jobs_queued ON analysis_jobs(created_at, id) WHERE status = 'queued';
CREATE TABLE analysis_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  analysis_job_id TEXT NOT NULL REFERENCES analysis_jobs(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed', 'ambiguous')),
  provider_interaction_id TEXT,
  usage_json TEXT CHECK (usage_json IS NULL OR json_valid(usage_json)),
  failure_code TEXT,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER,
  CHECK ((status = 'running' AND finished_at IS NULL) OR (status != 'running' AND finished_at IS NOT NULL AND finished_at >= started_at)),
  CHECK ((status IN ('failed', 'ambiguous')) = (failure_code IS NOT NULL)),
  UNIQUE (analysis_job_id, attempt_number),
  UNIQUE (id, analysis_job_id)
) STRICT;
CREATE UNIQUE INDEX analysis_attempts_one_running ON analysis_attempts(analysis_job_id) WHERE status = 'running';
CREATE TABLE summary_requests (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  analysis_job_id TEXT NOT NULL REFERENCES analysis_jobs(id) ON DELETE RESTRICT,
  subscription_id TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('direct', 'channel')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  failure_code TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK ((origin = 'channel') = (subscription_id IS NOT NULL)),
  CHECK ((status = 'failed') = (failure_code IS NOT NULL)),
  UNIQUE (user_id, analysis_job_id),
  UNIQUE (id, user_id, subscription_id),
  FOREIGN KEY (subscription_id, user_id) REFERENCES channel_subscriptions(id, user_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX summary_requests_owner_created ON summary_requests(user_id, created_at DESC, id DESC);
CREATE INDEX summary_requests_job ON summary_requests(analysis_job_id);
CREATE UNIQUE INDEX summary_requests_one_running ON summary_requests(user_id) WHERE status = 'running';
CREATE TABLE reports (
  id TEXT PRIMARY KEY NOT NULL,
  analysis_job_id TEXT NOT NULL UNIQUE REFERENCES analysis_jobs(id) ON DELETE RESTRICT,
  successful_attempt_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  channel_name TEXT NOT NULL,
  channel_url TEXT,
  body_markdown TEXT NOT NULL CHECK (length(trim(body_markdown)) > 0),
  model TEXT NOT NULL,
  timestamp_verification TEXT NOT NULL DEFAULT 'unverified' CHECK (timestamp_verification IN ('unverified', 'verified')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (successful_attempt_id, analysis_job_id) REFERENCES analysis_attempts(id, analysis_job_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX reports_created ON reports(created_at DESC, id DESC);
CREATE TABLE report_permissions (
  id TEXT PRIMARY KEY NOT NULL,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
  audience TEXT NOT NULL CHECK (audience IN ('user', 'authenticated')),
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  can_read INTEGER NOT NULL CHECK (can_read = 1),
  can_comment INTEGER NOT NULL CHECK (can_comment IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK ((audience = 'user' AND user_id IS NOT NULL AND can_comment = 0) OR
    (audience = 'authenticated' AND user_id IS NULL AND can_comment = 1))
) STRICT;
CREATE UNIQUE INDEX permissions_user_identity ON report_permissions(report_id, user_id) WHERE audience = 'user';
CREATE UNIQUE INDEX permissions_public_identity ON report_permissions(report_id) WHERE audience = 'authenticated';
CREATE INDEX permissions_library ON report_permissions(user_id, created_at DESC, report_id DESC) WHERE audience = 'user';
CREATE INDEX permissions_public_created ON report_permissions(created_at DESC, report_id DESC) WHERE audience = 'authenticated';
CREATE TABLE comments (
  id TEXT PRIMARY KEY NOT NULL,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;
CREATE INDEX comments_report_created ON comments(report_id, created_at DESC, id DESC);
CREATE INDEX comments_author ON comments(user_id);
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
  subscription_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'ambiguous', 'cancelled')),
  failure_code TEXT,
  available_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolution_evidence TEXT CHECK (resolution_evidence IS NULL OR length(trim(resolution_evidence)) > 0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (user_id, report_id, recipient_id),
  UNIQUE (user_id, report_id, recipient_email),
  FOREIGN KEY (request_id, user_id, subscription_id) REFERENCES summary_requests(id, user_id, subscription_id) ON DELETE RESTRICT,
  FOREIGN KEY (subscription_id, user_id) REFERENCES channel_subscriptions(id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (recipient_id, user_id) REFERENCES recipients(id, user_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX deliveries_owner_created ON deliveries(user_id, created_at DESC, id DESC);
CREATE INDEX deliveries_request ON deliveries(request_id);
CREATE INDEX deliveries_report ON deliveries(report_id);
CREATE INDEX deliveries_subscription ON deliveries(subscription_id, status);
CREATE INDEX deliveries_recipient ON deliveries(recipient_id, status);
CREATE INDEX deliveries_due ON deliveries(available_at, id) WHERE status = 'queued';
CREATE TABLE delivery_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'accepted', 'rejected', 'ambiguous')),
  failure_code TEXT,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER,
  CHECK ((status = 'started' AND finished_at IS NULL) OR (status != 'started' AND finished_at IS NOT NULL AND finished_at >= started_at)),
  CHECK ((status IN ('rejected', 'ambiguous')) = (failure_code IS NOT NULL)),
  UNIQUE (delivery_id, attempt_number)
) STRICT;
CREATE UNIQUE INDEX delivery_attempts_one_started ON delivery_attempts(delivery_id) WHERE status = 'started';

-- 공통 식별자·생성 설정·완료 이력을 바꾸어 중복 제거와 권한을 우회하지 못하게 해요.
CREATE TRIGGER channel_identity BEFORE UPDATE OF id, youtube_channel_id ON channels
BEGIN SELECT RAISE(ABORT, 'channel_identity_immutable'); END;
CREATE TRIGGER video_identity BEFORE UPDATE OF id ON videos
BEGIN SELECT RAISE(ABORT, 'video_identity_immutable'); END;
CREATE TRIGGER video_channel_history BEFORE UPDATE OF channel_id ON videos
WHEN OLD.channel_id IS NOT NULL AND NEW.channel_id IS NOT OLD.channel_id
BEGIN SELECT RAISE(ABORT, 'video_channel_immutable'); END;
CREATE TRIGGER subscription_identity BEFORE UPDATE OF id, user_id, channel_id, created_at ON channel_subscriptions
BEGIN SELECT RAISE(ABORT, 'subscription_identity_immutable'); END;
CREATE TRIGGER subscription_baseline_history BEFORE UPDATE OF baseline_initialized_at ON channel_subscriptions
WHEN OLD.baseline_initialized_at IS NOT NULL AND NEW.baseline_initialized_at IS NOT OLD.baseline_initialized_at
BEGIN SELECT RAISE(ABORT, 'subscription_baseline_immutable'); END;
CREATE TRIGGER subscription_tombstone BEFORE UPDATE ON channel_subscriptions WHEN OLD.status = 'deleted'
BEGIN SELECT RAISE(ABORT, 'subscription_deleted'); END;
CREATE TRIGGER observation_channel BEFORE INSERT ON subscription_videos
WHEN NOT EXISTS (SELECT 1 FROM channel_subscriptions s JOIN videos v ON v.channel_id = s.channel_id WHERE s.id = NEW.subscription_id AND v.id = NEW.video_id)
  OR (NEW.is_baseline = 1 AND EXISTS (SELECT 1 FROM channel_subscriptions WHERE id = NEW.subscription_id AND baseline_initialized_at IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'observation_invalid'); END;
CREATE TRIGGER observation_history BEFORE UPDATE ON subscription_videos
BEGIN SELECT RAISE(ABORT, 'observation_immutable'); END;
CREATE TRIGGER analysis_identity BEFORE UPDATE OF id, video_id, generation_key, generation_config_json, created_at ON analysis_jobs
BEGIN SELECT RAISE(ABORT, 'analysis_identity_immutable'); END;
CREATE TRIGGER analysis_initial BEFORE INSERT ON analysis_jobs WHEN NEW.status != 'queued'
BEGIN SELECT RAISE(ABORT, 'analysis_initial_state'); END;
CREATE TRIGGER analysis_transition BEFORE UPDATE OF status ON analysis_jobs
WHEN NEW.status != OLD.status AND NOT (
  (OLD.status = 'queued' AND NEW.status IN ('running', 'failed')) OR
  (OLD.status = 'running' AND NEW.status IN ('completed', 'failed')) OR
  (OLD.status = 'failed' AND NEW.status = 'queued')
)
BEGIN SELECT RAISE(ABORT, 'analysis_invalid_transition'); END;
CREATE TRIGGER analysis_complete BEFORE UPDATE OF status ON analysis_jobs
WHEN NEW.status = 'completed' AND NOT EXISTS (SELECT 1 FROM reports WHERE analysis_job_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'analysis_report_required'); END;
CREATE TRIGGER summary_request_identity BEFORE UPDATE OF id, user_id, analysis_job_id, origin, subscription_id, created_at ON summary_requests
BEGIN SELECT RAISE(ABORT, 'summary_identity_immutable'); END;
CREATE TRIGGER summary_request_initial BEFORE INSERT ON summary_requests WHEN NEW.status != 'queued'
BEGIN SELECT RAISE(ABORT, 'summary_initial_state'); END;
CREATE TRIGGER summary_request_observation BEFORE INSERT ON summary_requests
WHEN NEW.origin = 'channel' AND NOT EXISTS (
  SELECT 1 FROM channel_subscriptions s JOIN subscription_videos o ON o.subscription_id = s.id
    JOIN analysis_jobs j ON j.video_id = o.video_id JOIN videos v ON v.id = o.video_id AND v.channel_id = s.channel_id
  WHERE s.id = NEW.subscription_id AND s.user_id = NEW.user_id AND s.status = 'active'
    AND s.baseline_initialized_at IS NOT NULL AND o.is_baseline = 0 AND j.id = NEW.analysis_job_id
)
BEGIN SELECT RAISE(ABORT, 'summary_new_video_required'); END;
CREATE TRIGGER summary_request_transition BEFORE UPDATE OF status ON summary_requests
WHEN NEW.status != OLD.status AND NOT (
  (OLD.status = 'queued' AND NEW.status IN ('running', 'failed', 'completed')) OR
  (OLD.status = 'running' AND NEW.status IN ('completed', 'failed')) OR
  (OLD.status = 'failed' AND NEW.status IN ('queued', 'completed'))
)
BEGIN SELECT RAISE(ABORT, 'summary_invalid_transition'); END;
CREATE TRIGGER summary_complete BEFORE UPDATE OF status ON summary_requests
WHEN NEW.status = 'completed' AND NOT EXISTS (
  SELECT 1 FROM reports r JOIN analysis_jobs j ON j.id = r.analysis_job_id
    JOIN report_permissions p ON p.report_id = r.id AND p.audience = 'user' AND p.user_id = NEW.user_id
  WHERE j.id = NEW.analysis_job_id AND j.status = 'completed'
)
BEGIN SELECT RAISE(ABORT, 'summary_accessible_report_required'); END;
CREATE TRIGGER analysis_attempt_initial BEFORE INSERT ON analysis_attempts
WHEN NEW.status != 'running'
  OR NOT EXISTS (SELECT 1 FROM analysis_jobs WHERE id = NEW.analysis_job_id AND status = 'running')
  OR NOT EXISTS (
    SELECT 1 FROM summary_requests q WHERE q.analysis_job_id = NEW.analysis_job_id AND q.status = 'running'
      AND (q.origin = 'direct' OR (
        EXISTS (SELECT 1 FROM channel_subscriptions WHERE id = q.subscription_id AND status = 'active') AND
        EXISTS (SELECT 1 FROM recipients WHERE user_id = q.user_id AND verified_at IS NOT NULL AND deleted_at IS NULL)
      ))
  )
  OR NEW.attempt_number != (SELECT coalesce(max(attempt_number), 0) + 1 FROM analysis_attempts WHERE analysis_job_id = NEW.analysis_job_id)
  OR EXISTS (SELECT 1 FROM analysis_attempts WHERE analysis_job_id = NEW.analysis_job_id AND status IN ('succeeded', 'ambiguous'))
BEGIN SELECT RAISE(ABORT, 'analysis_attempt_invalid'); END;
CREATE TRIGGER analysis_attempt_history BEFORE UPDATE ON analysis_attempts
WHEN OLD.status != 'running' OR NEW.id != OLD.id OR NEW.analysis_job_id != OLD.analysis_job_id OR NEW.attempt_number != OLD.attempt_number OR NEW.started_at != OLD.started_at
BEGIN SELECT RAISE(ABORT, 'analysis_attempt_immutable'); END;
CREATE TRIGGER report_requires_success BEFORE INSERT ON reports
WHEN NOT EXISTS (
  SELECT 1 FROM analysis_attempts a JOIN analysis_jobs j ON j.id = a.analysis_job_id
  WHERE a.id = NEW.successful_attempt_id AND a.analysis_job_id = NEW.analysis_job_id AND a.status = 'succeeded' AND j.status = 'running'
)
BEGIN SELECT RAISE(ABORT, 'report_successful_attempt_required'); END;
CREATE TRIGGER report_content_immutable BEFORE UPDATE OF id, analysis_job_id, successful_attempt_id, title, channel_name, channel_url, body_markdown, model, created_at ON reports
BEGIN SELECT RAISE(ABORT, 'report_immutable'); END;
CREATE TRIGGER permission_identity BEFORE UPDATE OF id, report_id, audience, user_id, created_at ON report_permissions
BEGIN SELECT RAISE(ABORT, 'permission_identity_immutable'); END;
CREATE TRIGGER comment_public BEFORE INSERT ON comments
WHEN NOT EXISTS (SELECT 1 FROM report_permissions WHERE report_id = NEW.report_id AND audience = 'authenticated' AND can_comment = 1)
BEGIN SELECT RAISE(ABORT, 'comment_public_rule_required'); END;
CREATE TRIGGER comment_immutable BEFORE UPDATE ON comments
BEGIN SELECT RAISE(ABORT, 'comment_immutable'); END;

-- 공통 보고서를 개인의 원래 자동 요청·현재 수신 설정과 대조해 발송해요.
CREATE TRIGGER delivery_initial BEFORE INSERT ON deliveries
WHEN NEW.status != 'queued'
  OR NOT EXISTS (
    SELECT 1 FROM summary_requests q JOIN reports r ON r.analysis_job_id = q.analysis_job_id
      JOIN report_permissions p ON p.report_id = r.id AND p.audience = 'user' AND p.user_id = q.user_id
    WHERE q.id = NEW.request_id AND q.user_id = NEW.user_id AND q.origin = 'channel' AND q.status = 'completed'
      AND q.subscription_id = NEW.subscription_id AND r.id = NEW.report_id
  )
  OR NOT EXISTS (SELECT 1 FROM channel_subscriptions WHERE id = NEW.subscription_id AND user_id = NEW.user_id AND status = 'active')
  OR NOT EXISTS (SELECT 1 FROM recipients WHERE id = NEW.recipient_id AND user_id = NEW.user_id AND email = NEW.recipient_email AND verified_at IS NOT NULL AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'delivery_ineligible'); END;
CREATE TRIGGER delivery_identity BEFORE UPDATE OF id, user_id, request_id, report_id, subscription_id, recipient_id, recipient_email, created_at ON deliveries
BEGIN SELECT RAISE(ABORT, 'delivery_identity_immutable'); END;
CREATE TRIGGER delivery_final_history BEFORE UPDATE ON deliveries WHEN OLD.status IN ('sent', 'cancelled')
BEGIN SELECT RAISE(ABORT, 'delivery_final_immutable'); END;
CREATE TRIGGER delivery_transition BEFORE UPDATE OF status ON deliveries
WHEN NEW.status != OLD.status AND NOT (
  (OLD.status = 'queued' AND NEW.status IN ('sending', 'cancelled')) OR
  (OLD.status = 'sending' AND NEW.status IN ('sent', 'failed', 'ambiguous')) OR
  (OLD.status = 'failed' AND NEW.status IN ('queued', 'cancelled')) OR
  (OLD.status = 'ambiguous' AND NEW.status IN ('sent', 'cancelled'))
)
BEGIN SELECT RAISE(ABORT, 'delivery_invalid_transition'); END;
CREATE TRIGGER delivery_claim BEFORE UPDATE OF status ON deliveries WHEN NEW.status = 'sending' AND (
  NOT EXISTS (SELECT 1 FROM channel_subscriptions WHERE id = NEW.subscription_id AND status = 'active') OR
  NOT EXISTS (SELECT 1 FROM report_permissions WHERE report_id = NEW.report_id AND user_id = NEW.user_id AND audience = 'user') OR
  NOT EXISTS (SELECT 1 FROM recipients WHERE id = NEW.recipient_id AND email = NEW.recipient_email AND verified_at IS NOT NULL AND deleted_at IS NULL)
)
BEGIN SELECT RAISE(ABORT, 'delivery_ineligible'); END;
CREATE TRIGGER delivery_sent_evidence BEFORE UPDATE OF status ON deliveries WHEN NEW.status = 'sent'
  AND NOT EXISTS (SELECT 1 FROM delivery_attempts WHERE delivery_id = NEW.id AND status = 'accepted')
  AND NOT (OLD.status = 'ambiguous' AND NEW.resolution_evidence IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'delivery_acceptance_required'); END;
CREATE TRIGGER delivery_attempt_initial BEFORE INSERT ON delivery_attempts
WHEN NEW.status != 'started'
  OR NOT EXISTS (SELECT 1 FROM deliveries WHERE id = NEW.delivery_id AND status = 'sending')
  OR NEW.attempt_number != (SELECT coalesce(max(attempt_number), 0) + 1 FROM delivery_attempts WHERE delivery_id = NEW.delivery_id)
BEGIN SELECT RAISE(ABORT, 'delivery_attempt_invalid'); END;
CREATE TRIGGER delivery_attempt_history BEFORE UPDATE ON delivery_attempts
WHEN OLD.status != 'started' OR NEW.id != OLD.id OR NEW.delivery_id != OLD.delivery_id OR NEW.attempt_number != OLD.attempt_number OR NEW.started_at != OLD.started_at
BEGIN SELECT RAISE(ABORT, 'delivery_attempt_immutable'); END;
CREATE TRIGGER subscription_stop AFTER UPDATE OF status ON channel_subscriptions WHEN NEW.status IN ('paused', 'deleted')
BEGIN
  UPDATE deliveries SET status = 'cancelled', failure_code = 'channel_inactive' WHERE subscription_id = NEW.id AND status IN ('queued', 'failed');
  UPDATE summary_requests SET status = 'failed', failure_code = 'channel_inactive' WHERE subscription_id = NEW.id AND status = 'queued';
END;
CREATE TRIGGER permission_remove AFTER DELETE ON report_permissions WHEN OLD.audience = 'user'
BEGIN
  UPDATE deliveries SET status = 'cancelled', failure_code = 'access_revoked' WHERE user_id = OLD.user_id AND report_id = OLD.report_id AND status IN ('queued', 'failed');
END;
CREATE TRIGGER recipient_stop AFTER UPDATE OF deleted_at, verified_at ON recipients
WHEN NEW.deleted_at IS NOT NULL OR NEW.verified_at IS NULL
BEGIN
  UPDATE deliveries SET status = 'cancelled', failure_code = 'recipient_inactive' WHERE recipient_id = NEW.id AND status IN ('queued', 'failed');
  DELETE FROM account_tokens WHERE recipient_id = NEW.id;
END;
