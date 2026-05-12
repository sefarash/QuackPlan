// ===== OUTPUT CONTROLS PERSISTENCE =====
// Saves all output-panel control values to localStorage so they survive
// page refresh and scenario switches.

const _OC_KEY = 'qp_output_controls';

// All input IDs in the output panels that users can manually change
const _OC_IDS = [
  // Torque
  'torqWOB', 'torqFFlo', 'torqFFmid', 'torqFFhi', 'torqRotary',
  // Buckling
  'buckWOB', 'buckFFlo', 'buckFFmid',
  // Overpull
  'ovpBlock', 'ovpDPwt', 'ovpMW', 'ovpFFlo', 'ovpFFmid', 'ovpFFhi',
  // Broomstick
  'bsBlock', 'bsDPwt', 'bsMW', 'bsFFlo', 'bsFFmid', 'bsFFhi',
  // Hydraulics
  'hydMWmin', 'hydMWslider', 'hydMWmax', 'hydFlowMin', 'hydFlowSlider', 'hydFlowMax',
  // Casing design
  'cdSFBurst', 'cdSFCollapse',
];

const _OC_ID_SET = new Set(_OC_IDS);

function saveOutputControls() {
  const vals = {};
  _OC_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    vals[id] = el.type === 'checkbox' ? el.checked : el.value;
  });
  localStorage.setItem(_OC_KEY, JSON.stringify(vals));
}

function loadOutputControls() {
  let vals = {};
  try { vals = JSON.parse(localStorage.getItem(_OC_KEY) || '{}'); } catch (_) {}

  _OC_IDS.forEach(id => {
    if (!(id in vals)) return;
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') {
      el.checked = !!vals[id];
    } else {
      el.value = vals[id];
    }
  });

  // Keep display spans in sync with restored slider values
  const mwSlider   = document.getElementById('hydMWslider');
  const flowSlider  = document.getElementById('hydFlowSlider');
  const mwVal       = document.getElementById('hydMWval');
  const flowVal     = document.getElementById('hydFlowVal');
  if (mwSlider   && mwVal)   mwVal.textContent   = mwSlider.value;
  if (flowSlider && flowVal) flowVal.textContent  = flowSlider.value;
}

document.addEventListener('DOMContentLoaded', () => {
  loadOutputControls();

  // Single delegated listener on the body — fires for every change/input
  // inside any output panel, identified by element ID.
  ['change', 'input'].forEach(evt => {
    document.body.addEventListener(evt, e => {
      if (_OC_ID_SET.has(e.target.id)) saveOutputControls();
    });
  });
});
