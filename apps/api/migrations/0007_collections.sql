-- 사용자가 직접 만든 리포트 모음이에요. 이름은 같은 사용자 안에서 겹치지 않아요.
CREATE TABLE collections (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 30 AND name = trim(name)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;
CREATE UNIQUE INDEX collections_owner_name ON collections(user_id, name);
CREATE INDEX collections_owner_created ON collections(user_id, created_at DESC, id DESC);

-- 항목은 공통 보고서가 아니라 본인의 보관 권한 행을 가리켜요.
-- 보관 관계가 지워지면 모음에서도 빠지고, 모음을 지워도 보관함의 리포트는 남아요.
CREATE TABLE collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES report_permissions(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (collection_id, permission_id)
) STRICT;
CREATE INDEX collection_items_collection_created ON collection_items(collection_id, created_at DESC);
CREATE INDEX collection_items_permission ON collection_items(permission_id);

CREATE TRIGGER collection_item_owner BEFORE INSERT ON collection_items
WHEN NOT EXISTS (
  SELECT 1 FROM collections c JOIN report_permissions p ON p.user_id = c.user_id AND p.audience = 'user'
  WHERE c.id = NEW.collection_id AND p.id = NEW.permission_id
)
BEGIN SELECT RAISE(ABORT, 'collection_item_owner_required'); END;
CREATE TRIGGER collection_item_identity BEFORE UPDATE OF collection_id, permission_id ON collection_items
BEGIN SELECT RAISE(ABORT, 'collection_item_identity_immutable'); END;
CREATE TRIGGER collection_owner_immutable BEFORE UPDATE OF id, user_id, created_at ON collections
BEGIN SELECT RAISE(ABORT, 'collection_owner_immutable'); END;
