// ===== FULL-HIERARCHY BACKUP / RESTORE =====
// One file for the ENTIRE project tree (every project → field → well → borehole
// → scenario, with all scenario data). Complements the per-scenario JSON in
// scenario-io.js. Primary use: move all wells to a new origin in one step (e.g.
// after a Cloudflare deploy URL change — see the canonical-origin note in
// index.html), or as a periodic safety backup.

const QP_BACKUP_SCHEMA  = 'qp-backup';
const QP_BACKUP_VERSION = '1';

// ── Backup (export everything) ────────────────────────────────────────────────
async function backupAll() {
  let nodes;
  try {
    nodes = await dbAllNodes();
  } catch (err) {
    alert('Backup failed reading the database: ' + err.message);
    return;
  }
  if (!nodes.length) { alert('Nothing to back up — no projects yet.'); return; }

  const doc = {
    schema:     QP_BACKUP_SCHEMA,
    version:    QP_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    nodeCount:  nodes.length,
    // Each node exactly as stored: { id, parentId, name, type, data }
    nodes,
  };

  const stamp = new Date().toISOString().slice(0, 10);
  _downloadJSON(doc, `quackplan_backup_${stamp}.json`);

  const counts = _backupCounts(nodes);
  setStatus(`Backed up ${counts.project} project(s), ${counts.well} well(s), ${counts.scenario} scenario(s)`);
}

// ── Restore (import everything) ───────────────────────────────────────────────
function restoreBackupFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    let doc;
    try { doc = JSON.parse(e.target.result); }
    catch (err) { alert('Cannot parse backup file: ' + err.message); return; }
    _restoreBackupDoc(doc);
  };
  reader.readAsText(file);
  input.value = '';
}

async function _restoreBackupDoc(doc) {
  if (!doc || doc.schema !== QP_BACKUP_SCHEMA || !Array.isArray(doc.nodes)) {
    alert('Not a QuackPlan backup file (expected a full-hierarchy backup, not a single-scenario export).');
    return;
  }
  const nodes = doc.nodes;
  if (!nodes.length) { alert('Backup contains no records.'); return; }

  const c = _backupCounts(nodes);
  const ok = confirm(
    `Restore ${c.project} project(s), ${c.well} well(s) and ${c.scenario} scenario(s) from this backup?\n\n` +
    `They are ADDED to your current hierarchy — existing wells are kept (a duplicate tree is created if you restore data you already have).`
  );
  if (!ok) return;

  setStatus('Restoring backup…');

  // Insert parents before children, remapping old ids → freshly-assigned ids so
  // nothing collides with existing records. Process in waves: a node is insertable
  // once its parent has already been inserted (root nodes first).
  const idMap = new Map();                 // oldId → newId
  const byId  = new Map(nodes.map(n => [n.id, n]));
  const pending = nodes.slice();
  let inserted = 0, guard = 0;

  try {
    while (pending.length) {
      if (guard++ > nodes.length + 5) {
        // Any remaining nodes reference a parent not in the file (orphans) — attach
        // them at the root so no data is silently dropped.
        for (const n of pending) idMap.set(n.id, await _restoreInsert(n, null, idMap));
        inserted += pending.length;
        break;
      }
      for (let i = pending.length - 1; i >= 0; i--) {
        const n = pending[i];
        const parentKnown = n.parentId == null || !byId.has(n.parentId) || idMap.has(n.parentId);
        if (!parentKnown) continue;        // parent not inserted yet — wait for a later wave
        const newParent = (n.parentId != null && idMap.has(n.parentId)) ? idMap.get(n.parentId) : null;
        idMap.set(n.id, await _restoreInsert(n, newParent, idMap));
        inserted++;
        pending.splice(i, 1);
      }
    }
  } catch (err) {
    setStatus('Restore failed — ' + err.message, true);
    alert('Restore failed after ' + inserted + ' record(s): ' + err.message);
    return;
  }

  if (typeof hierarchyRefresh === 'function') hierarchyRefresh();
  setStatus(`Restored ${inserted} record(s) — ${c.well} well(s), ${c.scenario} scenario(s)`);
}

// Insert one node with a remapped parent, preserving name/type/data.
function _restoreInsert(node, newParentId, _idMap) {
  return dbAdd({
    parentId: newParentId,
    name:     node.name,
    type:     node.type,
    data:     node.data || {},
  });
}

function _backupCounts(nodes) {
  const c = { project: 0, field: 0, well: 0, borehole: 0, scenario: 0 };
  nodes.forEach(n => { if (n.type in c) c[n.type]++; });
  return c;
}
