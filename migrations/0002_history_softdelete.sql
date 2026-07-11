-- Data-safety layer (RULE #1 defense in depth):
--  1. node_history — an undo log. Every mutation (data save, update, rename,
--     delete) records the node's PRIOR state first, so any future bug that
--     writes bad data is recoverable per node without a whole-DB rewind.
--  2. nodes.deleted_at — soft delete. DELETE marks the subtree instead of
--     destroying rows; queries filter it out. Nothing is ever physically erased.
-- Additive only: new table + new nullable column. Existing rows untouched.

CREATE TABLE IF NOT EXISTS node_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id    INTEGER NOT NULL,
  owner_id   INTEGER NOT NULL,
  parent_id  INTEGER,
  name       TEXT,
  type       TEXT,
  data       TEXT,
  op         TEXT    NOT NULL,          -- mutation that triggered the snapshot
  saved_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hist_node  ON node_history(node_id, id);
CREATE INDEX IF NOT EXISTS idx_hist_owner ON node_history(owner_id, saved_at);

ALTER TABLE nodes ADD COLUMN deleted_at INTEGER;
