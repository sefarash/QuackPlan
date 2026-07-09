-- QuackPlan multi-user schema (Cloudflare D1 / SQLite)
-- users own a tree of nodes (project → field → well → borehole → scenario).
-- A node's scenario inputs live in the JSON `data` column, mirroring the old
-- IndexedDB record shape { id, parentId, name, type, data }.

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT    NOT NULL UNIQUE,
  pw_hash     TEXT    NOT NULL,
  pw_salt     TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id    INTEGER NOT NULL,
  parent_id   INTEGER,
  name        TEXT,
  type        TEXT,
  data        TEXT,                 -- JSON object of scenario inputs
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_nodes_owner  ON nodes(owner_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(owner_id, parent_id);
