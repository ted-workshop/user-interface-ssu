-- 외부에 반환하는 ID는 애플리케이션에서 UUID로 만들고 시간은 Unix 초로 저장해요.
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email)) AND length(email) BETWEEN 3 AND 254),
  nickname TEXT NOT NULL CHECK (length(trim(nickname)) BETWEEN 2 AND 20),
  password_hash TEXT NOT NULL CHECK (length(password_hash) > 0),
  email_verified_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
) STRICT;
CREATE INDEX sessions_owner ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  check_interval_minutes INTEGER NOT NULL DEFAULT 360 CHECK (check_interval_minutes IN (60, 360, 1440))
) STRICT;

CREATE TABLE channels (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  youtube_channel_id TEXT NOT NULL CHECK (length(youtube_channel_id) > 0),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'deleted')),
  baseline_initialized_at INTEGER,
  last_checked_at INTEGER,
  next_check_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (id, user_id)
) STRICT;
CREATE UNIQUE INDEX channels_live_identity ON channels(user_id, youtube_channel_id) WHERE status != 'deleted';
CREATE INDEX channels_owner_created ON channels(user_id, created_at DESC, id DESC);
CREATE INDEX channels_due ON channels(next_check_at) WHERE status = 'active';

CREATE TABLE recipients (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  email TEXT NOT NULL CHECK (email = lower(trim(email)) AND length(email) BETWEEN 3 AND 254),
  verified_at INTEGER,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (id, user_id)
) STRICT;
CREATE UNIQUE INDEX recipients_live_identity ON recipients(user_id, email) WHERE deleted_at IS NULL;
CREATE INDEX recipients_owner_created ON recipients(user_id, created_at DESC, id DESC);

CREATE TABLE account_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password', 'verify_recipient')),
  recipient_id TEXT,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  consumed_at INTEGER CHECK (consumed_at IS NULL OR (consumed_at >= created_at AND consumed_at < expires_at)),
  CHECK ((purpose = 'verify_recipient') = (recipient_id IS NOT NULL)),
  FOREIGN KEY (recipient_id, user_id) REFERENCES recipients(id, user_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX account_tokens_owner ON account_tokens(user_id, purpose, recipient_id);
CREATE INDEX account_tokens_expiry ON account_tokens(expires_at);

CREATE TABLE channel_videos (
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  video_id TEXT NOT NULL CHECK (length(video_id) = 11 AND video_id NOT GLOB '*[^a-zA-Z0-9_-]*'),
  is_baseline INTEGER NOT NULL CHECK (is_baseline IN (0, 1)),
  discovered_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (channel_id, video_id),
  FOREIGN KEY (channel_id, user_id) REFERENCES channels(id, user_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE summary_requests (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  video_id TEXT NOT NULL CHECK (length(video_id) = 11 AND video_id NOT GLOB '*[^a-zA-Z0-9_-]*'),
  origin TEXT NOT NULL CHECK (origin IN ('direct', 'channel')),
  channel_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  failure_code TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK ((origin = 'channel') = (channel_id IS NOT NULL)),
  CHECK ((status = 'failed') = (failure_code IS NOT NULL)),
  UNIQUE (user_id, video_id),
  UNIQUE (id, user_id),
  UNIQUE (id, user_id, video_id, origin),
  FOREIGN KEY (channel_id, user_id) REFERENCES channels(id, user_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX summary_requests_owner_created ON summary_requests(user_id, created_at DESC, id DESC);
CREATE INDEX summary_requests_queued ON summary_requests(created_at, id) WHERE status = 'queued';
CREATE UNIQUE INDEX summary_requests_one_running ON summary_requests(user_id) WHERE status = 'running';

CREATE TABLE summary_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed', 'ambiguous')),
  provider_interaction_id TEXT,
  usage_json TEXT CHECK (usage_json IS NULL OR json_valid(usage_json)),
  failure_code TEXT,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER,
  CHECK ((status = 'running' AND finished_at IS NULL) OR (status != 'running' AND finished_at IS NOT NULL AND finished_at >= started_at)),
  CHECK ((status IN ('failed', 'ambiguous')) = (failure_code IS NOT NULL)),
  UNIQUE (request_id, attempt_number),
  UNIQUE (id, request_id, user_id),
  FOREIGN KEY (request_id, user_id) REFERENCES summary_requests(id, user_id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX summary_attempts_one_running ON summary_attempts(request_id) WHERE status = 'running';

CREATE TABLE reports (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  attempt_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  channel_name TEXT NOT NULL,
  channel_url TEXT,
  body_markdown TEXT NOT NULL CHECK (length(trim(body_markdown)) > 0),
  model TEXT NOT NULL,
  timestamp_verification TEXT NOT NULL DEFAULT 'unverified' CHECK (timestamp_verification IN ('unverified', 'verified')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (id, user_id),
  UNIQUE (user_id, video_id),
  FOREIGN KEY (request_id, user_id, video_id, origin) REFERENCES summary_requests(id, user_id, video_id, origin) ON DELETE RESTRICT,
  FOREIGN KEY (attempt_id, request_id, user_id) REFERENCES summary_attempts(id, request_id, user_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX reports_owner_created ON reports(user_id, created_at DESC, id DESC);
CREATE INDEX reports_owner_channel ON reports(user_id, channel_url, created_at DESC, id DESC);
CREATE INDEX reports_owner_origin ON reports(user_id, origin, created_at DESC, id DESC);

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'ambiguous', 'cancelled')),
  failure_code TEXT,
  available_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolution_evidence TEXT CHECK (resolution_evidence IS NULL OR length(trim(resolution_evidence)) > 0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (id, user_id),
  UNIQUE (report_id, recipient_id),
  UNIQUE (report_id, recipient_email),
  FOREIGN KEY (report_id, user_id) REFERENCES reports(id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (channel_id, user_id) REFERENCES channels(id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (recipient_id, user_id) REFERENCES recipients(id, user_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX deliveries_owner_created ON deliveries(user_id, created_at DESC, id DESC);
CREATE INDEX deliveries_channel ON deliveries(channel_id, status);
CREATE INDEX deliveries_recipient ON deliveries(recipient_id, status);
CREATE INDEX deliveries_due ON deliveries(available_at, id) WHERE status = 'queued';

CREATE TABLE delivery_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  delivery_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'accepted', 'rejected', 'ambiguous')),
  failure_code TEXT,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER,
  CHECK ((status = 'started' AND finished_at IS NULL) OR (status != 'started' AND finished_at IS NOT NULL AND finished_at >= started_at)),
  CHECK ((status IN ('rejected', 'ambiguous')) = (failure_code IS NOT NULL)),
  UNIQUE (delivery_id, attempt_number),
  FOREIGN KEY (delivery_id, user_id) REFERENCES deliveries(id, user_id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX delivery_attempts_one_started ON delivery_attempts(delivery_id) WHERE status = 'started';

-- 요청의 소유자·영상·생성 경로를 고정하고, 성공 시도와 저장된 리포트가 있어야 완료해요.
CREATE TRIGGER account_token_history BEFORE UPDATE ON account_tokens
WHEN OLD.consumed_at IS NOT NULL OR NEW.id != OLD.id OR NEW.user_id != OLD.user_id
  OR NEW.purpose != OLD.purpose OR NEW.recipient_id IS NOT OLD.recipient_id
  OR NEW.token_hash != OLD.token_hash OR NEW.created_at != OLD.created_at OR NEW.expires_at != OLD.expires_at
BEGIN
  SELECT RAISE(ABORT, 'account_token_immutable');
END;
CREATE TRIGGER channel_identity BEFORE UPDATE OF id, user_id, youtube_channel_id ON channels
BEGIN
  SELECT RAISE(ABORT, 'channel_identity_immutable');
END;
CREATE TRIGGER channel_baseline_history BEFORE UPDATE OF baseline_initialized_at ON channels
WHEN OLD.baseline_initialized_at IS NOT NULL AND NEW.baseline_initialized_at IS NOT OLD.baseline_initialized_at
BEGIN
  SELECT RAISE(ABORT, 'channel_baseline_immutable');
END;
CREATE TRIGGER summary_request_identity BEFORE UPDATE OF id, user_id, video_id, origin, channel_id ON summary_requests
BEGIN
  SELECT RAISE(ABORT, 'summary_identity_immutable');
END;
CREATE TRIGGER summary_request_initial BEFORE INSERT ON summary_requests WHEN NEW.status != 'queued'
BEGIN
  SELECT RAISE(ABORT, 'summary_initial_state');
END;
CREATE TRIGGER summary_request_transition BEFORE UPDATE OF status ON summary_requests
WHEN NEW.status != OLD.status AND NOT (
  (OLD.status = 'queued' AND NEW.status IN ('running', 'failed')) OR
  (OLD.status = 'running' AND NEW.status IN ('completed', 'failed')) OR
  (OLD.status = 'failed' AND NEW.status = 'queued')
)
BEGIN
  SELECT RAISE(ABORT, 'summary_invalid_transition');
END;
CREATE TRIGGER summary_complete_requires_report BEFORE UPDATE OF status ON summary_requests
WHEN NEW.status = 'completed' AND NOT EXISTS (SELECT 1 FROM reports WHERE request_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'summary_report_required');
END;
CREATE TRIGGER summary_attempt_initial BEFORE INSERT ON summary_attempts
WHEN NEW.status != 'running'
  OR NOT EXISTS (
    SELECT 1 FROM summary_requests q WHERE q.id = NEW.request_id AND q.user_id = NEW.user_id AND q.status = 'running'
      AND (q.origin = 'direct' OR (
        EXISTS (SELECT 1 FROM channels WHERE id = q.channel_id AND status = 'active') AND
        EXISTS (SELECT 1 FROM recipients WHERE user_id = q.user_id AND verified_at IS NOT NULL AND deleted_at IS NULL)
      ))
  )
  OR NEW.attempt_number != (SELECT coalesce(max(attempt_number), 0) + 1 FROM summary_attempts WHERE request_id = NEW.request_id)
BEGIN
  SELECT RAISE(ABORT, 'summary_attempt_invalid');
END;
CREATE TRIGGER summary_attempt_history BEFORE UPDATE ON summary_attempts
WHEN OLD.status != 'running' OR NEW.id != OLD.id OR NEW.request_id != OLD.request_id OR NEW.user_id != OLD.user_id OR NEW.attempt_number != OLD.attempt_number
BEGIN
  SELECT RAISE(ABORT, 'summary_attempt_immutable');
END;
CREATE TRIGGER report_requires_success BEFORE INSERT ON reports
WHEN NOT EXISTS (
  SELECT 1 FROM summary_attempts a JOIN summary_requests q ON q.id = a.request_id
  WHERE a.id = NEW.attempt_id AND a.request_id = NEW.request_id AND a.user_id = NEW.user_id AND a.status = 'succeeded' AND q.status = 'running'
)
BEGIN
  SELECT RAISE(ABORT, 'report_successful_attempt_required');
END;
CREATE TRIGGER report_content_immutable BEFORE UPDATE OF id, request_id, attempt_id, user_id, video_id, origin, title, channel_name, channel_url, body_markdown, model, created_at ON reports
BEGIN
  SELECT RAISE(ABORT, 'report_immutable');
END;

-- 직접 결과의 소급 발송을 막고 채널·확인된 수신 주소의 스냅샷을 검사해요.
CREATE TRIGGER delivery_initial BEFORE INSERT ON deliveries
WHEN NEW.status != 'queued'
  OR NOT EXISTS (
    SELECT 1 FROM reports r JOIN summary_requests q ON q.id = r.request_id
    WHERE r.id = NEW.report_id AND r.user_id = NEW.user_id AND r.origin = 'channel' AND q.channel_id = NEW.channel_id AND q.status = 'completed'
  )
  OR NOT EXISTS (SELECT 1 FROM channels WHERE id = NEW.channel_id AND user_id = NEW.user_id AND status = 'active')
  OR NOT EXISTS (SELECT 1 FROM recipients WHERE id = NEW.recipient_id AND user_id = NEW.user_id AND email = NEW.recipient_email AND verified_at IS NOT NULL AND deleted_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'delivery_ineligible');
END;
CREATE TRIGGER delivery_identity BEFORE UPDATE OF id, user_id, report_id, channel_id, recipient_id, recipient_email, created_at ON deliveries
BEGIN
  SELECT RAISE(ABORT, 'delivery_identity_immutable');
END;
CREATE TRIGGER delivery_final_history BEFORE UPDATE ON deliveries WHEN OLD.status IN ('sent', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'delivery_final_immutable');
END;
CREATE TRIGGER delivery_transition BEFORE UPDATE OF status ON deliveries
WHEN NEW.status != OLD.status AND NOT (
  (OLD.status = 'queued' AND NEW.status IN ('sending', 'cancelled')) OR
  (OLD.status = 'sending' AND NEW.status IN ('sent', 'failed', 'ambiguous')) OR
  (OLD.status = 'failed' AND NEW.status IN ('queued', 'cancelled')) OR
  (OLD.status = 'ambiguous' AND NEW.status IN ('sent', 'cancelled'))
)
BEGIN
  SELECT RAISE(ABORT, 'delivery_invalid_transition');
END;
CREATE TRIGGER delivery_claim BEFORE UPDATE OF status ON deliveries WHEN NEW.status = 'sending' AND (
  NOT EXISTS (SELECT 1 FROM channels WHERE id = NEW.channel_id AND status = 'active') OR
  NOT EXISTS (SELECT 1 FROM recipients WHERE id = NEW.recipient_id AND email = NEW.recipient_email AND verified_at IS NOT NULL AND deleted_at IS NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'delivery_ineligible');
END;
CREATE TRIGGER delivery_sent_evidence BEFORE UPDATE OF status ON deliveries WHEN NEW.status = 'sent'
  AND NOT EXISTS (SELECT 1 FROM delivery_attempts WHERE delivery_id = NEW.id AND status = 'accepted')
  AND NOT (OLD.status = 'ambiguous' AND NEW.resolution_evidence IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'delivery_acceptance_required');
END;
CREATE TRIGGER delivery_attempt_initial BEFORE INSERT ON delivery_attempts
WHEN NEW.status != 'started'
  OR NOT EXISTS (SELECT 1 FROM deliveries WHERE id = NEW.delivery_id AND user_id = NEW.user_id AND status = 'sending')
  OR NEW.attempt_number != (SELECT coalesce(max(attempt_number), 0) + 1 FROM delivery_attempts WHERE delivery_id = NEW.delivery_id)
BEGIN
  SELECT RAISE(ABORT, 'delivery_attempt_invalid');
END;
CREATE TRIGGER delivery_attempt_history BEFORE UPDATE ON delivery_attempts
WHEN OLD.status != 'started' OR NEW.id != OLD.id OR NEW.delivery_id != OLD.delivery_id OR NEW.user_id != OLD.user_id OR NEW.attempt_number != OLD.attempt_number
BEGIN
  SELECT RAISE(ABORT, 'delivery_attempt_immutable');
END;

-- 중지·삭제는 미발송만 취소하고 성공 이력과 리포트 본문은 보존해요.
CREATE TRIGGER channel_tombstone BEFORE UPDATE ON channels WHEN OLD.status = 'deleted'
BEGIN
  SELECT RAISE(ABORT, 'channel_deleted');
END;
CREATE TRIGGER channel_stop AFTER UPDATE OF status ON channels WHEN NEW.status IN ('paused', 'deleted')
BEGIN
  UPDATE deliveries SET status = 'cancelled', failure_code = 'channel_inactive' WHERE channel_id = NEW.id AND status IN ('queued', 'failed');
END;
CREATE TRIGGER recipient_identity BEFORE UPDATE OF id, user_id, email ON recipients
BEGIN
  SELECT RAISE(ABORT, 'recipient_identity_immutable');
END;
CREATE TRIGGER recipient_tombstone BEFORE UPDATE ON recipients WHEN OLD.deleted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'recipient_deleted');
END;
CREATE TRIGGER recipient_stop AFTER UPDATE OF deleted_at, verified_at ON recipients
WHEN NEW.deleted_at IS NOT NULL OR NEW.verified_at IS NULL
BEGIN
  UPDATE deliveries SET status = 'cancelled', failure_code = 'recipient_inactive' WHERE recipient_id = NEW.id AND status IN ('queued', 'failed');
  DELETE FROM account_tokens WHERE recipient_id = NEW.id;
END;
