// ===== AUTH UI =====
// Gates the app behind email/password login. On load it checks for a valid
// session; if none, it shows the login overlay. After login/signup it boots the
// app (loads the user's hierarchy from the server). Data lives server-side, so
// a lost token just means "log in again" — nothing is lost.

let _qpBooted = false;

function _authOverlay() { return document.getElementById('authOverlay'); }

function _authShow(show) {
  const ov = _authOverlay();
  if (ov) ov.style.display = show ? 'flex' : 'none';
}

function _authError(msg) {
  const el = document.getElementById('authError');
  if (el) { el.textContent = msg || ''; el.style.display = msg ? 'block' : 'none'; }
}

function _authSetMode(mode) {           // 'login' | 'signup'
  document.getElementById('authTitle').textContent   = mode === 'signup' ? 'Create your account' : 'Sign in to QuackPlan';
  document.getElementById('authSubmit').textContent  = mode === 'signup' ? 'Create account' : 'Sign in';
  document.getElementById('authToggle').innerHTML    = mode === 'signup'
    ? 'Already have an account? <a href="#" onclick="authSetMode(\'login\');return false">Sign in</a>'
    : 'No account yet? <a href="#" onclick="authSetMode(\'signup\');return false">Create one</a>';
  _authOverlay().dataset.mode = mode;
  _authError('');
}
function authSetMode(mode) { _authSetMode(mode); }

async function authSubmit() {
  const email = document.getElementById('authEmail').value.trim();
  const pw    = document.getElementById('authPassword').value;
  const mode  = _authOverlay().dataset.mode || 'login';
  const btn   = document.getElementById('authSubmit');
  if (!email || !pw) { _authError('Enter your email and password.'); return; }

  btn.disabled = true; _authError('');
  try {
    const res = mode === 'signup' ? await dbSignup(email, pw) : await dbLogin(email, pw);
    qpSetToken(res.token);
    _setAccountLabel(res.email);
    _authShow(false);
    _bootApp();
  } catch (e) {
    _authError(e && e.message ? e.message : 'Something went wrong. Try again.');
  } finally {
    btn.disabled = false;
  }
}

function _setAccountLabel(email) {
  const el = document.getElementById('authAccount');
  if (el) el.textContent = email || '';
}

function qpLogout() {
  qpSetToken(null);
  location.reload();
}

// Called by db-engine on a 401 (session expired/invalid).
function qpAuthExpired() {
  if (!_qpBooted) return;               // during initial check we handle it inline
  qpSetToken(null);
  _authSetMode('login');
  _authError('Your session expired — please sign in again.');
  _authShow(true);
}

function _bootApp() {
  if (_qpBooted) { if (typeof hierarchyBoot === 'function') hierarchyBoot(); return; }
  _qpBooted = true;
  if (typeof hierarchyBoot === 'function') hierarchyBoot();
}

// On load: if we have a token, verify it; else show login.
document.addEventListener('DOMContentLoaded', async () => {
  _authSetMode('login');
  document.getElementById('authPassword').addEventListener('keydown', e => { if (e.key === 'Enter') authSubmit(); });
  document.getElementById('authEmail').addEventListener('keydown', e => { if (e.key === 'Enter') authSubmit(); });

  if (!qpToken()) { _authShow(true); return; }
  try {
    const me = await dbMe();
    _setAccountLabel(me.email);
    _authShow(false);
    _bootApp();
  } catch (_) {
    qpSetToken(null);
    _authShow(true);
  }
});
