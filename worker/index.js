// ===== QuackPlan Worker: auth + node API + static assets =====
// Routes:
//   POST /api/auth/signup   {email,password} -> {token,email}
//   POST /api/auth/login    {email,password} -> {token,email}
//   GET  /api/auth/me                        -> {email}
//   GET  /api/nodes[?roots=1|?parent=ID]     -> [ {id,parentId,name,type,data} ]
//   POST /api/nodes         {parentId,name,type,data} -> {id}
//   GET  /api/nodes/:id                      -> node | 404
//   PUT  /api/nodes/:id     {name,type,parentId,data} -> {ok}
//   PATCH /api/nodes/:id/data {key,value}    -> {ok}   (atomic json_set)
//   PATCH /api/nodes/:id/name {name}         -> {ok}
//   DELETE /api/nodes/:id                    -> {ok}   (cascades to descendants)
// Everything else -> static assets (the SPA) via env.ASSETS.
//
// Secrets/bindings (wrangler.toml + `wrangler secret put`):
//   DB          D1 database binding
//   AUTH_SECRET HMAC signing secret for session tokens
//   ASSETS      static assets binding

const JSON_HDR = { 'Content-Type': 'application/json' };
const TOKEN_TTL = 60 * 60 * 24 * 30;        // 30 days
const PBKDF2_ITER = 100000;

// ── small helpers ─────────────────────────────────────────────────────────────
const enc = new TextEncoder();
const dec = new TextDecoder();
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSON_HDR });
const err  = (msg, status = 400) => json({ error: msg }, status);

function b64uEncode(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(str + '==='.slice((str.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── password hashing (PBKDF2-SHA256) ──────────────────────────────────────────
async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' }, key, 256);
  return b64uEncode(bits);
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: await pbkdf2(password, salt), salt: b64uEncode(salt) };
}
async function verifyPassword(password, hash, saltB64) {
  const cand = await pbkdf2(password, b64uDecode(saltB64));
  return timingSafeEq(cand, hash);
}
function timingSafeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ── session tokens (compact HMAC-signed, JWT-like) ────────────────────────────
async function hmac(data, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64uEncode(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
async function signToken(payload, secret) {
  const body = b64uEncode(enc.encode(JSON.stringify(payload)));
  return body + '.' + await hmac(body, secret);
}
async function verifyToken(token, secret) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  if (!timingSafeEq(await hmac(body, secret), sig)) return null;
  let payload; try { payload = JSON.parse(dec.decode(b64uDecode(body))); } catch { return null; }
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}

// map a DB row to the client node shape
const rowToNode = r => ({
  id: r.id, parentId: r.parent_id, name: r.name, type: r.type,
  data: r.data ? JSON.parse(r.data) : {},
});

async function requireUser(req, env) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = await verifyToken(token, env.AUTH_SECRET);
  return payload && payload.uid ? payload : null;
}

// ── API ───────────────────────────────────────────────────────────────────────
async function handleApi(req, env, url) {
  const path = url.pathname;
  const method = req.method;

  // --- auth ---
  if (path === '/api/auth/signup' && method === 'POST') {
    const { email, password } = await req.json().catch(() => ({}));
    const em = (email || '').trim().toLowerCase();
    if (!em || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return err('Valid email required');
    if (!password || password.length < 8) return err('Password must be at least 8 characters');
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(em).first();
    if (existing) return err('An account with that email already exists', 409);
    const { hash, salt } = await hashPassword(password);
    const res = await env.DB.prepare(
      'INSERT INTO users (email,pw_hash,pw_salt,created_at) VALUES (?,?,?,?)')
      .bind(em, hash, salt, Date.now()).run();
    const uid = res.meta.last_row_id;
    const token = await signToken({ uid, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL }, env.AUTH_SECRET);
    return json({ token, email: em });
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const { email, password } = await req.json().catch(() => ({}));
    const em = (email || '').trim().toLowerCase();
    const u = await env.DB.prepare('SELECT id,pw_hash,pw_salt FROM users WHERE email=?').bind(em).first();
    if (!u || !(await verifyPassword(password || '', u.pw_hash, u.pw_salt))) {
      return err('Invalid email or password', 401);
    }
    const token = await signToken({ uid: u.id, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL }, env.AUTH_SECRET);
    return json({ token, email: em });
  }

  // --- everything below requires a valid session ---
  const user = await requireUser(req, env);
  if (!user) return err('Not authenticated', 401);

  if (path === '/api/auth/me' && method === 'GET') {
    const u = await env.DB.prepare('SELECT email FROM users WHERE id=?').bind(user.uid).first();
    return u ? json({ email: u.email }) : err('Not authenticated', 401);
  }

  // --- nodes ---
  // RULE #1 defense in depth: every mutation snapshots the node's PRIOR state
  // into node_history first (same atomic batch), deletes are soft (deleted_at),
  // and history can be listed/restored — so no future bug can make data
  // unrecoverable.
  const HIST_KEEP = 20;
  const snapStmt = (nodeId, op) => env.DB.prepare(
    `INSERT INTO node_history (node_id,owner_id,parent_id,name,type,data,op,saved_at)
     SELECT id,owner_id,parent_id,name,type,data,?,? FROM nodes WHERE id=? AND owner_id=?`)
    .bind(op, Date.now(), nodeId, user.uid);
  const pruneStmt = nodeId => env.DB.prepare(
    `DELETE FROM node_history WHERE node_id=?1 AND id NOT IN (
       SELECT id FROM node_history WHERE node_id=?1 ORDER BY id DESC LIMIT ${HIST_KEEP})`)
    .bind(nodeId);

  const listMatch = path === '/api/nodes';
  if (listMatch && method === 'GET') {
    let rows;
    if (url.searchParams.get('roots') === '1') {
      rows = await env.DB.prepare('SELECT * FROM nodes WHERE owner_id=? AND parent_id IS NULL AND deleted_at IS NULL').bind(user.uid).all();
    } else if (url.searchParams.has('parent')) {
      rows = await env.DB.prepare('SELECT * FROM nodes WHERE owner_id=? AND parent_id=? AND deleted_at IS NULL')
        .bind(user.uid, +url.searchParams.get('parent')).all();
    } else {
      rows = await env.DB.prepare('SELECT * FROM nodes WHERE owner_id=? AND deleted_at IS NULL').bind(user.uid).all();
    }
    return json((rows.results || []).map(rowToNode));
  }

  if (listMatch && method === 'POST') {
    const b = await req.json().catch(() => ({}));
    const res = await env.DB.prepare(
      'INSERT INTO nodes (owner_id,parent_id,name,type,data,updated_at) VALUES (?,?,?,?,?,?)')
      .bind(user.uid, b.parentId ?? null, b.name ?? null, b.type ?? null,
            JSON.stringify(b.data || {}), Date.now()).run();
    return json({ id: res.meta.last_row_id });
  }

  const m = path.match(/^\/api\/nodes\/(\d+)(\/data|\/name|\/history(?:\/\d+\/restore)?)?$/);
  if (m) {
    const id = +m[1], sub = m[2];

    if (!sub && method === 'GET') {
      const r = await env.DB.prepare('SELECT * FROM nodes WHERE id=? AND owner_id=? AND deleted_at IS NULL').bind(id, user.uid).first();
      return r ? json(rowToNode(r)) : err('Not found', 404);
    }
    if (!sub && method === 'PUT') {
      const b = await req.json().catch(() => ({}));
      const [, , r] = await env.DB.batch([
        snapStmt(id, 'update'), pruneStmt(id),
        env.DB.prepare(
          'UPDATE nodes SET name=?,type=?,parent_id=?,data=?,updated_at=? WHERE id=? AND owner_id=? AND deleted_at IS NULL')
          .bind(b.name ?? null, b.type ?? null, b.parentId ?? null,
                JSON.stringify(b.data || {}), Date.now(), id, user.uid),
      ]);
      return r.meta.changes ? json({ ok: true }) : err('Not found', 404);
    }
    if (sub === '/data' && method === 'PATCH') {
      const { key, value } = await req.json().catch(() => ({}));
      if (!key) return err('key required');
      // Snapshot prior state + atomic per-key json_set, in one transaction.
      const [, , r] = await env.DB.batch([
        snapStmt(id, 'data:' + key), pruneStmt(id),
        env.DB.prepare(
          "UPDATE nodes SET data=json_set(COALESCE(data,'{}'), '$.'||?, json(?)), updated_at=? WHERE id=? AND owner_id=? AND deleted_at IS NULL")
          .bind(key, JSON.stringify(value ?? null), Date.now(), id, user.uid),
      ]);
      return r.meta.changes ? json({ ok: true }) : err('Not found', 404);
    }
    if (sub === '/name' && method === 'PATCH') {
      const { name } = await req.json().catch(() => ({}));
      const [, , r] = await env.DB.batch([
        snapStmt(id, 'rename'), pruneStmt(id),
        env.DB.prepare('UPDATE nodes SET name=?,updated_at=? WHERE id=? AND owner_id=? AND deleted_at IS NULL')
          .bind(name ?? null, Date.now(), id, user.uid),
      ]);
      return r.meta.changes ? json({ ok: true }) : err('Not found', 404);
    }
    if (!sub && method === 'DELETE') {
      // SOFT delete the node + descendants (recoverable); snapshot them first.
      const subtree = `WITH RECURSIVE sub(id) AS (
             SELECT ?2
             UNION SELECT n.id FROM nodes n JOIN sub ON n.parent_id=sub.id WHERE n.owner_id=?1
           ) SELECT id FROM sub`;
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO node_history (node_id,owner_id,parent_id,name,type,data,op,saved_at)
           SELECT id,owner_id,parent_id,name,type,data,'delete',?3 FROM nodes
           WHERE owner_id=?1 AND deleted_at IS NULL AND id IN (${subtree})`)
          .bind(user.uid, id, Date.now()),
        env.DB.prepare(
          `UPDATE nodes SET deleted_at=?3 WHERE owner_id=?1 AND deleted_at IS NULL AND id IN (${subtree})`)
          .bind(user.uid, id, Date.now()),
      ]);
      return json({ ok: true });
    }

    // --- history: list prior versions / restore one ---
    if (sub === '/history' && method === 'GET') {
      const rows = await env.DB.prepare(
        'SELECT id,op,saved_at,parent_id,name,type,data FROM node_history WHERE node_id=? AND owner_id=? ORDER BY id DESC LIMIT ?')
        .bind(id, user.uid, HIST_KEEP).all();
      return json((rows.results || []).map(h => ({
        histId: h.id, op: h.op, savedAt: h.saved_at,
        parentId: h.parent_id, name: h.name, type: h.type,
        data: h.data ? JSON.parse(h.data) : {},
      })));
    }
    const rm = sub && sub.match(/^\/history\/(\d+)\/restore$/);
    if (rm && method === 'POST') {
      const hid = +rm[1];
      const h = await env.DB.prepare('SELECT * FROM node_history WHERE id=? AND node_id=? AND owner_id=?')
        .bind(hid, id, user.uid).first();
      if (!h) return err('History version not found', 404);
      // Snapshot the current state too, then restore (also revives soft-deleted).
      const [, , r] = await env.DB.batch([
        snapStmt(id, 'pre-restore'), pruneStmt(id),
        env.DB.prepare(
          'UPDATE nodes SET name=?,type=?,parent_id=?,data=?,deleted_at=NULL,updated_at=? WHERE id=? AND owner_id=?')
          .bind(h.name, h.type, h.parent_id, h.data, Date.now(), id, user.uid),
      ]);
      return r.meta.changes ? json({ ok: true, restored: hid }) : err('Not found', 404);
    }
  }

  return err('Not found', 404);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        if (!env.AUTH_SECRET) return err('Server not configured (AUTH_SECRET missing)', 500);
        return await handleApi(req, env, url);
      } catch (e) {
        return err('Server error: ' + (e && e.message ? e.message : String(e)), 500);
      }
    }
    // Static SPA assets
    return env.ASSETS.fetch(req);
  },
};
