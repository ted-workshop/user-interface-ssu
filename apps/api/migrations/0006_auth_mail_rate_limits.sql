-- 인증 메일의 원문 토큰은 암호문으로만 보관하고 발송·만료 뒤 행을 지워요.
CREATE TABLE auth_mail_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  token_id TEXT NOT NULL UNIQUE REFERENCES account_tokens(id) ON DELETE RESTRICT,
  token_ciphertext TEXT NOT NULL CHECK (length(token_ciphertext) > 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  available_at INTEGER NOT NULL,
  lease_token TEXT,
  lease_expires_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
) STRICT;
CREATE INDEX auth_mail_outbox_due ON auth_mail_outbox(available_at, id) WHERE lease_token IS NULL;
CREATE INDEX auth_mail_outbox_expiry ON auth_mail_outbox(expires_at);

-- IP·이메일 원문 대신 서버 키로 만든 HMAC을 키로 저장해요.
CREATE TABLE auth_rate_limits (
  key TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 1)
) STRICT;
CREATE INDEX auth_rate_limits_expiry ON auth_rate_limits(window_end);
