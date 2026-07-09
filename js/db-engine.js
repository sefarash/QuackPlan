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

// Per-key scenario save — atomic on the server (json_set), so the old
// read-modify-write lost-update race is gone entirely.
function dbSaveScenarioData(scenarioId, key, value) {
  return _api('PATCH', '/nodes/' + scenarioId + '/data', { key, value });
}
function dbLoadScenarioData(scenarioId, key) {
  return dbGet(scenarioId).then(node => (node && node.data) ? node.data[key] : null);
}

function dbRename(id, newName) { return _api('PATCH', '/nodes/' + id + '/name', { name: newName }); }
