-- Per-key undo-log retention (worker/index.js pruneStmt) deletes by
-- (node_id, op): index it so the prune stays cheap as history grows.
-- Additive only: a new index, no table or row is touched.
CREATE INDEX IF NOT EXISTS idx_hist_node_op ON node_history(node_id, op, id);
