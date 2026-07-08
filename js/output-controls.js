// ===== OUTPUT CONTROLS PERSISTENCE (per-scenario) =====
// Output-panel control values (FF sliders, WOB, block weight, MW, flow rate,
// casing SFs) are saved per-scenario in IndexedDB so they don't bleed between
// scenarios (a surface-casing scenario at FF≈0.15 vs a horizontal one at
// FF≈0.35). Restored on scenario load; a scenario with none saved falls back to
// the HTML default values.

// All input IDs in the output panels that users can manually change
const _OC_IDS = [
  // Torque
  'torqWOB', 'torqFFlo', 'torqFFmid', 'torqFFhi', 'torqRotary', 'torqMaxTq',
  // Buckling
  'buckWOB', 'buckFFlo', 'buckFFmid',
  // Overpull
  'ovpBlock', 'ovpDPwt', 'ovpMW', 'ovpFFlo', 'ovpFFmid', 'ovpFFhi',
  // Broomstick
  'bsBlock', 'bsDPwt', 'bsMW', 'bsFFlo', 'bsFFmid', 'bsFFhi', 'bsMaxHL',
  // Hydraulics
  'hydMWmin', 'hydMWslider', 'hydMWmax', 'hydFlowMin', 'hydFlowSlider', 'hydFlowMax',
  // Casing design
  'cdSFBurst', 'cdSFCollapse',
];

const _OC_ID_SET = new Set(_OC_IDS);

// Read current control values from the DOM into a plain object
function _readOutputControls() {
  const vals = {};
  _OC_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    vals[id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  return vals;
}

// Persist the current controls to the active scenario (debounced — the sliders
// fire 'input' continuously during a drag).
let _ocSaveTimer = null;
function saveOutputControls() {
  if (typeof qpState === 'undefined' || !qpState.currentScenarioId) return;
  if (typeof dbSaveScenarioData !== 'function') return;
  if (_ocSaveTimer) clearTimeout(_ocSaveTimer);
  _ocSaveTimer = setTimeout(() => {
    _ocSaveTimer = null;
    if (qpState.currentScenarioId) {
      dbSaveScenarioData(qpState.currentScenarioId, 'outputControls', _readOutputControls());
    }
  }, 200);
}

// Apply a saved values object to the controls. Any control not present in
// `vals` is reset to its HTML default (defaultValue / defaultChecked) so a
// previous scenario's values never linger.
function loadOutputControls(vals) {
  vals = vals || {};
  _OC_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') {
      el.checked = (id in vals) ? !!vals[id] : el.defaultChecked;
    } else {
      el.value = (id in vals) ? vals[id] : el.defaultValue;
    }
  });

  // Keep display spans in sync with restored slider values
  const mwSlider   = document.getElementById('hydMWslider');
  const flowSlider = document.getElementById('hydFlowSlider');
  const mwVal      = document.getElementById('hydMWval');
  const flowVal    = document.getElementById('hydFlowVal');
  if (mwSlider   && mwVal)   mwVal.textContent   = mwSlider.value;
  if (flowSlider && flowVal) flowVal.textContent = flowSlider.value;
}

document.addEventListener('DOMContentLoaded', () => {
  // No initial load here — controls are restored per-scenario by _loadScenario
  // (which also runs for the auto-loaded last scenario on startup).

  // Single delegated listener on the body — fires for every change/input
  // inside any output panel, identified by element ID.
  ['change', 'input'].forEach(evt => {
    document.body.addEventListener(evt, e => {
      if (_OC_ID_SET.has(e.target.id)) saveOutputControls();
    });
  });
});
