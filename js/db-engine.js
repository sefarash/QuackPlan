// ===== DATA ENGINE (server-backed) =====
// Hierarchy: project → field → well → borehole → scenario
// Each record: { id, parentId, name, type, data:{} }
//
// Data now lives in a Cloudflare D1 database behind the Worker API (see
// worker/index.js), scoped to the logged-in user — so it survives a browser
// wipe, eviction, or switching devices. This module keeps the SAME function
// names and promise contracts the rest of the app already used against
// IndexedDB, so no caller needed to change; only the storage backend moved.

const QP_API = '/api';

// Session token (set by auth-ui.js on login). Stored in localStorage so a
// reload stays logged in; if it's evicted the user just logs in again — the
// DATA is safe on the server regardless.
function qpToken()        { try { return localStorage.getItem('qp_token') || ''; } catch (_) { return ''; } }
function qpSetToken(t)    { try { t ? localStorage.setItem('qp_token', t) : localStorage.removeItem('qp_token'); } catch (_) {} }

// Core request helper. Resolves parsed JSON (or null); rejects on failure.
// A 401 means the session is gone — hand off to auth-ui to show the login.
async function _api(method, path, body) {
  let res;
  try {
    res = await fetch(QP_API + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + qpToken() },
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch (netErr) {
    if (typeof setStatus === 'function') setStatus('Network error — could not reach the server', true);
    try { netErr.isNetwork = true; } catch (_) {}
    throw netErr;
  }
  if (res.status === 401) {
    if (typeof qpAuthExpired === 'function') qpAuthExpired();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    let msg = 'Server error ' + res.status;
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) {}
    if (typeof setStatus === 'function') setStatus(msg, true);
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

// ── Auth (used by auth-ui.js) ─────────────────────────────────────────────────
function dbSignup(email, password) { return _api('POST', '/auth/signup', { email, password }); }
function dbLogin(email, password)  { return _api('POST', '/auth/login',  { email, password }); }
function dbMe()                    { return _api('GET',  '/auth/me'); }

// ── CRUD (same contracts as the old IndexedDB engine) ─────────────────────────
// Kept so existing callers work unchanged. dbOpen is now a no-op (the server is
// the database); it resolves so any `dbOpen().then(...)` still works.
function dbOpen() { return Promise.resolve(true); }

function dbAdd(node) {
  return _api('POST', '/nodes', {
    parentId: node.parentId ?? null, name: node.name, type: node.type, data: node.data || {},
  }).then(r => r.id);
}

function dbGet(id)        { return _api('GET', '/nodes/' + id).then(r => r || null); }
function dbUpdate(node)   { return _api('PUT', '/nodes/' + node.id, node).then(() => node.id); }
function dbDelete(id)     { return _api('DELETE', '/nodes/' + id); }   // cascades on the server
function dbChildren(pid)  { return _api('GET', '/nodes?parent=' + encodeURIComponent(pid)); }
function dbRoots()        { return _api('GET', '/nodes?roots=1'); }
function dbAllNodes()     { return _api('GET', '/nodes'); }

// Per-key scenario save — atomic on the server (json_set), so a single PATCH
// can't do a read-modify-write race. Protections (RULE #1):
//
// 1. LOAD GUARD — while a scenario is being loaded into the UI
//    (qpState.loadingScenario, set by _loadScenario), all scenario-data saves
//    are DROPPED. The table loaders rebuild rows via the same AddRow helpers
//    users click, and those fire per-row saves — so merely OPENING a scenario
//    used to emit a burst of partial saves over the stored data; out-of-order
//    arrival truncated arrays. Loads must never write.
//
// 2. WRITE-AHEAD LOG — every save is appended to localStorage
//    ('qp_pending_saves') BEFORE the network attempt and removed only after
//    the server confirms it. A laptop shut mid-save (or offline edits) can't
//    lose work: the entry survives the power-off and replays on the next
//    boot / reconnect, in original order.
//
// 3. SINGLE ORDERED FLUSHER — one sequential worker drains the log
//    (next PATCH starts only after the previous resolved), so saves can never
//    be reordered by the network.
const _WAL_KEY = 'qp_pending_saves';
let _walSeq = 0, _walFlushing = false, _walTimer = null;

function _walRead()  { try { return JSON.parse(localStorage.getItem(_WAL_KEY) || '[]'); } catch (_) { return []; } }
function _walWrite(a){ try { localStorage.setItem(_WAL_KEY, JSON.stringify(a)); } catch (_) {} _qpSaveIndicator(); }
function _walAdd(e)  { const a = _walRead(); a.push(e); _walWrite(a); }
function _walRemove(id) { _walWrite(_walRead().filter(x => x.id !== id)); }

// Footer indicator: ✓ Saved · ● Saving… · ⚠ N unsaved (kept locally, retrying)
function _qpSaveIndicator() {
  const el = document.getElementById('saveIndicator');
  if (!el) return;
  const n = _walRead().length;
  if (n === 0)              { el.textContent = '✓ All changes saved'; el.style.color = ''; }
  else if (_walFlushing)    { el.textContent = '● Saving…';           el.style.color = ''; }
  else if (navigator.onLine === false)
                            { el.textContent = `⚠ Offline — ${n} change(s) stored locally`; el.style.color = '#b07800'; }
  else                      { el.textContent = `⚠ ${n} unsaved change(s) — retrying`;       el.style.color = '#b07800'; }
}

function dbSaveScenarioData(scenarioId, key, value) {
  if (typeof qpState !== 'undefined' && qpState.loadingScenario) {
    return Promise.resolve();            // load paths never write (RULE #1)
  }
  _walAdd({ id: Date.now() + '-' + (++_walSeq), s: scenarioId, k: key, v: value });
  return qpFlushPendingSaves();          // resolves when this flush pass finishes
}

// Drain the log sequentially. Stops at the first failure (entries stay queued,
// order preserved) and schedules a retry; also triggered on 'online' and boot.
async function qpFlushPendingSaves() {
  if (_walFlushing) return;
  _walFlushing = true;
  _qpSaveIndicator();
  try {
    let entry;
    while ((entry = _walRead()[0])) {
      try {
        await _api('PATCH', '/nodes/' + entry.s + '/data', { key: entry.k, value: entry.v });
        _walRemove(entry.id);
      } catch (e) {
        if (e && e.message === 'unauthorized') return;   // replay after next login
        _walScheduleRetry();                             // network/server — retry later
        return;
      }
    }
  } finally {
    _walFlushing = false;
    _qpSaveIndicator();
  }
}

function _walScheduleRetry() {
  if (_walTimer) return;
  _walTimer = setTimeout(() => { _walTimer = null; qpFlushPendingSaves(); }, 8000);
}

window.addEventListener('online', () => qpFlushPendingSaves());
document.addEventListener('DOMContentLoaded', _qpSaveIndicator);
function dbLoadScenarioData(scenarioId, key) {
  return dbGet(scenarioId).then(node => (node && node.data) ? node.data[key] : null);
}

function dbRename(id, newName) { return _api('PATCH', '/nodes/' + id + '/name', { name: newName }); }

// ── Recovery (RULE #1 undo log) ───────────────────────────────────────────────
// The server snapshots a node's prior state before every mutation and soft-
// deletes instead of erasing. List a node's versions / restore one:
//   dbHistory(id).then(console.table)          — last 20 prior versions
//   dbRestoreVersion(id, histId)               — roll the node back (also
//                                                 revives a soft-deleted node)
function dbHistory(id)               { return _api('GET',  '/nodes/' + id + '/history'); }
function dbRestoreVersion(id, histId){ return _api('POST', '/nodes/' + id + '/history/' + histId + '/restore'); }
