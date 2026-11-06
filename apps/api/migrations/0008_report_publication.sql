-- 공개를 누른 사용자는 자신의 개인 규칙 행에 시각을 남겨요. 가장 먼저 누른 사람이 현재 공개한 사람이고 나머지는 순번이에요.
ALTER TABLE report_permissions ADD COLUMN publish_requested_at INTEGER;
CREATE INDEX permissions_publish_queue ON report_permissions(report_id, publish_requested_at, id) WHERE publish_requested_at IS NOT NULL;
CREATE TRIGGER permission_publish_user BEFORE UPDATE OF publish_requested_at ON report_permissions
WHEN NEW.publish_requested_at IS NOT NULL AND NEW.audience != 'user'
BEGIN SELECT RAISE(ABORT, 'publish_request_user_rule_required'); END;

-- 댓글 삭제는 표시만 하고, 순번 없이 공개가 사라지면 그때까지의 댓글을 보관 처리해 다시 공개해도 보이지 않게 해요.
ALTER TABLE comments ADD COLUMN deleted_at INTEGER;
ALTER TABLE comments ADD COLUMN archived_at INTEGER;
DROP TRIGGER comment_immutable;
CREATE TRIGGER comment_immutable BEFORE UPDATE OF id, report_id, user_id, body, created_at ON comments
BEGIN SELECT RAISE(ABORT, 'comment_immutable'); END;
CREATE TRIGGER comment_hidden_final BEFORE UPDATE OF deleted_at, archived_at ON comments
WHEN (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NOT OLD.deleted_at)
  OR (OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT OLD.archived_at)
BEGIN SELECT RAISE(ABORT, 'comment_hidden_final'); END;

-- 공개한 사람이 보관 관계를 지우면 다음 순번이 이어받아요. 순번이 남지 않으면 공개 규칙을 지우고 댓글을 보관해요.
CREATE TRIGGER publisher_leave AFTER DELETE ON report_permissions
WHEN OLD.audience = 'user' AND OLD.publish_requested_at IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM report_permissions WHERE report_id = OLD.report_id AND audience = 'user' AND publish_requested_at IS NOT NULL
)
BEGIN
  UPDATE comments SET archived_at = unixepoch() WHERE report_id = OLD.report_id AND archived_at IS NULL;
  DELETE FROM report_permissions WHERE report_id = OLD.report_id AND audience = 'authenticated';
END;
