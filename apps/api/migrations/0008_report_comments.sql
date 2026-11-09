-- 리포트 접근은 개인 권한 행으로만 정해요. 0003의 로그인 사용자 전체 공개 규칙 행은 쓰지 않으므로 정리해요.
DELETE FROM report_permissions WHERE audience = 'authenticated';

-- 댓글 삭제는 표시만 하고 되돌리지 않아요. 본문 등 나머지 열은 계속 바꿀 수 없어요.
ALTER TABLE comments ADD COLUMN deleted_at INTEGER;
DROP TRIGGER comment_immutable;
CREATE TRIGGER comment_immutable BEFORE UPDATE OF id, report_id, user_id, body, created_at ON comments
BEGIN SELECT RAISE(ABORT, 'comment_immutable'); END;
CREATE TRIGGER comment_deleted_final BEFORE UPDATE OF deleted_at ON comments
WHEN OLD.deleted_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'comment_deleted_final'); END;

-- 댓글은 그 리포트의 개인 권한 행이 있는 사용자만 써요.
DROP TRIGGER comment_public;
CREATE TRIGGER comment_reader BEFORE INSERT ON comments
WHEN NOT EXISTS (
  SELECT 1 FROM report_permissions
  WHERE report_id = NEW.report_id AND audience = 'user' AND user_id = NEW.user_id
)
BEGIN SELECT RAISE(ABORT, 'comment_reader_required'); END;
