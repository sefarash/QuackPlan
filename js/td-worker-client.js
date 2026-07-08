// ===== T&D WORKER CLIENT =====
// Promise-based wrapper around the T&D Web Worker. tdComputeAsync() offloads a
// tdCompute() run to the worker thread; if the worker is unavailable (file://
// origin, older browser, or a runtime failure) it transparently falls back to
// the synchronous main-thread tdCompute(). It therefore NEVER rejects — callers
// always get a valid result (or null, exactly as sync tdCompute would return).
//
// The synchronous tdCompute() stays on the main thread too (td-engine.js is
// still loaded via <script>) for the fallback path and for the chart draw
// functions that compute FF-sensitivity curves inline.

let _tdWorker            = null;
let _tdWorkerUnavailable = false;         // set once construction is known to fail
let _tdWorkerSeq         = 0;
const _tdWorkerPending   = new Map();     // id → { resolve, args, timeout }

function _tdFallback(pending) {
  // Resolve a pending request by computing synchronously on the main thread.
  clearTimeout(pending.timeout);
  const a = pending.args;
  let res = null;
  try { res = tdCompute(a[0], a[1], a[2], a[3], a[4]); } catch (_) { res = null; }
  pending.resolve(res);
}

function _tdGetWorker() {
  if (_tdWorker || _tdWorkerUnavailable) return _tdWorker;
  try {
    _tdWorker = new Worker('js/td-worker.js');
    _tdWorker.onmessage = e => {
      const { id, result, error } = e.data || {};
      const pending = _tdWorkerPending.get(id);
      if (!pending) return;
      _tdWorkerPending.delete(id);
      clearTimeout(pending.timeout);
      if (error) {
        // Engine threw inside the worker — surface via sync path (identical code).
        _tdFallback(pending);
      } else {
        pending.resolve(result);
      }
    };
    _tdWorker.onerror = () => {
      // Hard worker failure (e.g. importScripts blocked). Abandon the worker and
      // resolve every outstanding request synchronously; future calls go direct.
      _tdWorkerUnavailable = true;
      _tdWorker = null;
      _tdWorkerPending.forEach(p => _tdFallback(p));
      _tdWorkerPending.clear();
    };
  } catch (_) {
    // Construction threw synchronously (typical for file:// origins).
    _tdWorkerUnavailable = true;
    _tdWorker = null;
  }
  return _tdWorker;
}

// Public entry: same signature as tdCompute, returns a Promise<result>.
function tdComputeAsync(survey, bha, casingDesign, mudWeight, inputs) {
  const args = [survey, bha, casingDesign, mudWeight, inputs];
  return new Promise(resolve => {
    const w = _tdGetWorker();
    if (!w) { resolve(_syncTd(args)); return; }

    const id = ++_tdWorkerSeq;
    const timeout = setTimeout(() => {
      // Worker took too long / never answered — don't hang the UI.
      const pending = _tdWorkerPending.get(id);
      if (pending) { _tdWorkerPending.delete(id); resolve(_syncTd(args)); }
    }, 5000);

    _tdWorkerPending.set(id, { resolve, args, timeout });
    try {
      w.postMessage({ id, survey, bha, casingDesign, mudWeight, inputs });
    } catch (_) {
      _tdWorkerPending.delete(id);
      clearTimeout(timeout);
      resolve(_syncTd(args));
    }
  });
}

function _syncTd(a) {
  try { return tdCompute(a[0], a[1], a[2], a[3], a[4]); } catch (_) { return null; }
}
