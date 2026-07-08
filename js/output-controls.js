// ===== OUTPUT CONTROLS PERSISTENCE (per-scenario) =====
// Output-panel control values (FF sliders, WOB, block weight, MW, flow rate,
// casing SFs) are saved per-scenario in IndexedDB so they don't bleed between
// scenarios. Restored on scenario load; a scenario with none saved falls back to
// the HTML default values.
//
// Unit-typed controls (the hydraulics MW/flow sliders + their min/max inputs)
// are stored in imperial (canonical) via _OC_UNITS and shown in display units,
// so the DB stays canonical regardless of the active unit system.

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
  // Kick tolerance (real-gas model)
  'ktSafety', 'ktSurfTemp', 'ktGeoGrad', 'ktInflux', 'ktInfluxGrad',
];

const _OC_ID_SET = new Set(_OC_IDS);

// Controls whose DOM value is a display-unit quantity (canonical = imperial).
const _OC_UNITS = {
  hydMWmin: 'mw',   hydMWslider: 'mw',   hydMWmax: 'mw',
  hydFlowMin: 'flow', hydFlowSlider: 'flow', hydFlowMax: 'flow',
};

// The range sliders and the min/max inputs that drive their range + a metric step.
const _OC_SLIDERS = [
  { slider: 'hydMWslider',   min: 'hydMWmin',   max: 'hydMWmax',   qty: 'mw',   stepImp: 0.5, stepMet: 5  },
  { slider: 'hydFlowSlider', min: 'hydFlowMin', max: 'hydFlowMax', qty: 'flow', stepImp: 10,  stepMet: 25 },
];

let _ocLoaded = false;

// Read current control values from the DOM into a plain object (canonical units)
function _readOutputControls() {
  const vals = {};
  _OC_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox')      vals[id] = el.checked;
    else if (_OC_UNITS[id])          vals[id] = +QP_UNITS.fromDisplay(_OC_UNITS[id], +el.value).toFixed(4);
    else                             vals[id] = el.value;
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

// Display value for a control given the saved (canonical) vals object.
function _ocDisplayValue(id, vals) {
  const el = document.getElementById(id);
  const q  = _OC_UNITS[id];
  if (q) {
    const canonical = (id in vals) ? +vals[id] : (el ? +el.defaultValue : 0);
    return +QP_UNITS.toDisplay(q, canonical).toFixed(4);
  }
  return (id in vals) ? vals[id] : (el ? el.defaultValue : '');
}

// Set each range slider's min/max from its (display) number inputs, then the step
// for the active system. Must run BEFORE the slider value is set, or the browser
// clamps the value to the stale range.
function _ocSyncSliderRanges() {
  const metric = QP_UNITS.isMetric();
  _OC_SLIDERS.forEach(s => {
    const sl = document.getElementById(s.slider);
    if (!sl) return;
    const a = document.getElementById(s.min), b = document.getElementById(s.max);
    if (a) sl.min = a.value;
    if (b) sl.max = b.value;
    sl.step = metric ? s.stepMet : s.stepImp;
  });
}

// Sync the value-display spans and the unit labels next to the sliders.
function _ocSyncSliderLabels() {
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const mwSl = document.getElementById('hydMWslider');
  const fSl  = document.getElementById('hydFlowSlider');
  if (mwSl) set('hydMWval', mwSl.value);
  if (fSl)  set('hydFlowVal', fSl.value);
  set('uHydMW',   QP_UNITS.label('mw'));
  set('uHydFlow', QP_UNITS.label('flow'));
}

function _ocConvertField(id, fromSys, toSys) {
  const el = document.getElementById(id), q = _OC_UNITS[id];
  if (el && q && el.value !== '') el.value = +QP_UNITS.convert(q, +el.value, fromSys, toSys).toFixed(4);
}

// Re-express the slider controls in a new unit system. The slider value must be
// captured BEFORE the range changes (setting a new min/max clamps the current
// value), then re-applied from the captured value after the range is set.
function _ocRetuneSliders(fromSys, toSys) {
  const captured = {};
  _OC_SLIDERS.forEach(s => { const el = document.getElementById(s.slider); if (el) captured[s.slider] = +el.value; });
  _OC_SLIDERS.forEach(s => { _ocConvertField(s.min, fromSys, toSys); _ocConvertField(s.max, fromSys, toSys); });
  _ocSyncSliderRanges();
  _OC_SLIDERS.forEach(s => {
    const el = document.getElementById(s.slider);
    if (el && captured[s.slider] != null) el.value = +QP_UNITS.convert(s.qty, captured[s.slider], fromSys, toSys).toFixed(4);
  });
  _ocSyncSliderLabels();
}

// Apply a saved values object to the controls. Any control not present in
// `vals` is reset to its HTML default. Sliders are set AFTER their ranges.
function loadOutputControls(vals) {
  vals = vals || {};

  _OC_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') { el.checked = (id in vals) ? !!vals[id] : el.defaultChecked; return; }
    if (id === 'hydMWslider' || id === 'hydFlowSlider') return;   // deferred until range is set
    el.value = _ocDisplayValue(id, vals);
  });

  // Range must be set from the min/max inputs before the slider value
  _ocSyncSliderRanges();
  ['hydMWslider', 'hydFlowSlider'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = _ocDisplayValue(id, vals);
  });
  _ocSyncSliderLabels();

  _ocLoaded = true;
}

document.addEventListener('DOMContentLoaded', () => {
  // Sync labels/ranges to the current system on startup. If starting in metric
  // with no scenario loaded yet, convert the static HTML default slider fields
  // (scenario load, when it happens, sets absolute display values anyway).
  if (!_ocLoaded && QP_UNITS.isMetric()) {
    _ocRetuneSliders('imperial', 'metric');
  } else {
    _ocSyncSliderRanges();
    _ocSyncSliderLabels();
  }

  // Single delegated listener on the body — fires for every change/input
  // inside any output panel, identified by element ID.
  ['change', 'input'].forEach(evt => {
    document.body.addEventListener(evt, e => {
      if (_OC_ID_SET.has(e.target.id)) saveOutputControls();
    });
  });
});

// On unit change, re-express the hydraulics sliders (range-then-value) + relabel.
QP_UNITS.onChange((newSys, oldSys) => {
  _ocRetuneSliders(oldSys, newSys);
});
