// ===== INDEXEDDB ENGINE =====
// Hierarchy: project → field → well → borehole → scenario
// Each record: { id, parentId, name, type, data:{} }

const DB_NAME    = 'QuackPlanDB';
const DB_VERSION = 1;
let _db = null;

function dbOpen() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    // Stepped schema migrations. e.oldVersion is 0 for a brand-new database and
    // the previously-installed version for an upgrade. Each block runs once, in
    // order, for any DB coming from below that version — so a v0 user runs them
    // all while a v1 user runs only v2+. To change the schema: add a new
    // `if (oldV < N)` block and bump DB_VERSION to N; NEVER edit a shipped block
    // (existing users have already run it). Use e.target.transaction to read or
    // backfill existing records during an upgrade.
    req.onupgradeneeded = e => {
      const db   = e.target.result;
      const oldV = e.oldVersion;

      // v1 — initial schema: hierarchy 'nodes' store keyed by id, indexed by
      // parentId and type.
      if (oldV < 1) {
        const store = db.createObjectStore('nodes', { keyPath: 'id', autoIncrement: true });
        store.createIndex('by_parent', 'parentId', { unique: false });
        store.createIndex('by_type',   'type',     { unique: false });
      }

      // Future migrations go here, e.g.:
      // if (oldV < 2) {
      //   const store = e.target.transaction.objectStore('nodes');
      //   store.createIndex('by_name', 'name', { unique: false });
      // }
    };

    req.onsuccess = e => {
      _db = e.target.result;
      // If another tab opens a newer DB version, close this connection so its
      // upgrade isn't blocked (and drop the cache so the next call reopens).
      _db.onversionchange = () => { _db.close(); _db = null; };
      resolve(_db);
    };
    req.onerror   = e => reject(e.target.error);
    req.onblocked = () => reject(new Error(
      'QuackPlan database upgrade is blocked by another open tab — close it and reload.'));
  });
}

// ── CRUD helpers ─────────────────────────────────────────────────────────────

function dbAdd(node) {
  // node: { parentId, name, type, data }
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction('nodes', 'readwrite');
    const req = tx.objectStore('nodes').add({ ...node, data: node.data || {} });
    req.onsuccess = e => resolve(e.target.result);   // returns new id
    req.onerror   = e => reject(e.target.error);
  }));
}

function dbGet(id) {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction('nodes', 'readonly');
    const req = tx.objectStore('nodes').get(id);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  }));
}

function dbUpdate(node) {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction('nodes', 'readwrite');
    const req = tx.objectStore('nodes').put(node);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  }));
}

function dbDelete(id) {
  // Recursively delete children first
  return dbChildren(id).then(children =>
    Promise.all(children.map(c => dbDelete(c.id)))
  ).then(() => dbOpen()).then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction('nodes', 'readwrite');
    const req = tx.objectStore('nodes').delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  }));
}

function dbChildren(parentId) {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx    = db.transaction('nodes', 'readonly');
    const idx   = tx.objectStore('nodes').index('by_parent');
    const req   = idx.getAll(parentId);
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror   = e => reject(e.target.error);
  }));
}

function dbRoots() {
  // parentId = null is not indexed by IndexedDB, so scan all and filter
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction('nodes', 'readonly');
    const req = tx.objectStore('nodes').getAll();
    req.onsuccess = e => resolve((e.target.result || []).filter(n => !n.parentId));
    req.onerror   = e => reject(e.target.error);
  }));
}

// ── Scenario data helpers ─────────────────────────────────────────────────────

function dbSaveScenarioData(scenarioId, key, value) {
  return dbGet(scenarioId).then(node => {
    if (!node) return;
    node.data = node.data || {};
    node.data[key] = value;
    return dbUpdate(node);
  });
}

function dbLoadScenarioData(scenarioId, key) {
  return dbGet(scenarioId).then(node => (node && node.data) ? node.data[key] : null);
}

// ── Rename ───────────────────────────────────────────────────────────────────

function dbRename(id, newName) {
  return dbGet(id).then(node => {
    if (!node) return;
    node.name = newName;
    return dbUpdate(node);
  });
}
