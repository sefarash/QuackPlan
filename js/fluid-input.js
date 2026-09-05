// ===== DRILLING FLUID INPUT =====
// Fields are shown in display units; fluidGet() returns imperial (canonical) so
// the compute engines are unaffected. Converting quantities:
//   mudWeight → mw · yp/gels/tauY → yieldstress · flowRate → flow · SPP → press
//   pv → visc (cP ≡ mPa·s, no numeric change). kHB/kPL/nHB/nPL/pumpEff: not converted.
//
// The form shows only the SELECTED rheology model's parameters (Bingham PV/YP,
// Power Law n/K, Herschel-Bulkley τ₀/n/K — see _fluidModelChanged); every field
// keeps its value and is saved whichever model is active. The Fann readings
// block fits the selected model's parameters from dial readings (rheoFit* in
// rheology-engine.js). rheoParams(fluid) is the single place the engines
// resolve the record.
//
// Stored keys (RULE #1): model, mudType, mudWeight, pv, yp, gel10s, gel10m, tauY,
// nHB, kHB, flowRate, pumpEff, rigSppLimit are unchanged. nPL, kPL and fann are
// NEW additive keys (absent on old scenarios → Power Law derives n/K from PV/YP).

let _fluidLoaded = false;

function fluidChanged() {
  _fluidModelChanged();
  fluidSave();
}

function fluidSave() {
  if (!qpState.currentScenarioId) return;
  dbSaveScenarioData(qpState.currentScenarioId, 'fluid', fluidGet());
}

function fluidGet() {
  // Read a display field back into imperial (canonical)
  const fd = (q, id, def) =>
    QP_UNITS.fromDisplay(q, +(document.getElementById(id)?.value ?? def));
  const raw = (id, def) => +(document.getElementById(id)?.value || def);

  return {
    mudType:     document.getElementById('mudType')?.value        || 'WBM',
    model:       document.getElementById('rheologyModel')?.value  || 'HB',
    mudWeight:   fd('mw',          'mudWeight',   10),
    pv:          raw('pv', 16),                     // cP ≡ mPa·s — no numeric change
    yp:          fd('yieldstress', 'yp',          13),
    gel10s:      fd('yieldstress', 'gel10s',       5),
    gel10m:      fd('yieldstress', 'gel10m',      10),
    tauY:        fd('yieldstress', 'tauY',         8),
    nHB:         raw('nHB', 0.7),
    kHB:         raw('kHB', 120),
    flowRate:    fd('flow',        'flowRate',    280),
    pumpEff:     raw('pumpEff', 90),
    rigSppLimit: fd('press',       'rigSppLimit', 3500),
    // Power-Law parameters — NEW additive keys (0 = not entered → derived from PV/YP)
    nPL:         raw('nPL', 0),
    kPL:         raw('kPL', 0),                     // eq.cP, same unit as kHB
    // Fann dial readings behind the "fit" button — NEW additive key (omitted until entered)
    fann:        _fluidFannGet(),
  };
}

const _FLUID_FANN_IDS = { t600: 'fann600', t300: 'fann300', t200: 'fann200', t100: 'fann100', t6: 'fann6', t3: 'fann3' };
function _fluidFannGet() {          // undefined (key omitted) until a reading is entered
  const out = {};
  let any = false;
  for (const [k, id] of Object.entries(_FLUID_FANN_IDS)) {
    out[k] = +(document.getElementById(id)?.value || 0);
    if (out[k] > 0) any = true;
  }
  return any ? out : undefined;
}
function _fluidFannSet(f) {
  for (const [k, id] of Object.entries(_FLUID_FANN_IDS)) {
    const el = document.getElementById(id);
    if (el) el.value = (f && f[k] > 0) ? f[k] : '';
  }
}

function fluidLoadState(data) {
  if (!data) return;
  // Set a field from imperial (canonical) data, converting to display units
  const setD = (q, id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined) el.value = +QP_UNITS.toDisplay(q, +val).toFixed(4);
  };
  const setRaw = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined) el.value = val;
  };

  setRaw('mudType',       data.mudType);
  setRaw('rheologyModel', data.model);
  setD('mw',          'mudWeight',   data.mudWeight);
  setRaw('pv',        data.pv);
  setD('yieldstress', 'yp',          data.yp);
  setD('yieldstress', 'gel10s',      data.gel10s);
  setD('yieldstress', 'gel10m',      data.gel10m);
  setD('yieldstress', 'tauY',        data.tauY);
  setRaw('nHB',       data.nHB);
  setRaw('kHB',       data.kHB);
  setRaw('nPL',       data.nPL > 0 ? data.nPL : '');    // blank = derive from PV/YP
  setRaw('kPL',       data.kPL > 0 ? data.kPL : '');
  _fluidFannSet(data.fann);
  setD('flow',        'flowRate',    data.flowRate);
  setRaw('pumpEff',   data.pumpEff);
  setD('press',       'rigSppLimit', data.rigSppLimit);

  _fluidLoaded = true;
  _fluidUpdateLabels();
  _fluidModelChanged();
}

// ── Model-dependent form ───────────────────────────────────────────────────────
// Shows the selected model's parameter block, refreshes the K hints / derived
// Power-Law placeholders / summary line, and rebuilds the fluid-program columns.
const _RHEO_BLOCK_LABEL = { BP: 'Bingham Plastic Parameters', PL: 'Power Law Parameters', HB: 'Herschel-Bulkley Parameters' };

function _fluidModel() {
  return document.getElementById('rheologyModel')?.value || 'HB';
}

function _fluidModelChanged() {
  const model = _fluidModel();
  document.querySelectorAll('.rheo-model').forEach(el => { el.hidden = el.dataset.rheo !== model; });
  const lbl = document.getElementById('rheoBlockLabel');
  if (lbl) lbl.textContent = _RHEO_BLOCK_LABEL[model] || 'Rheology Parameters';

  const hint = (id, kEq) => {
    const el = document.getElementById(id);
    if (el) el.textContent = kEq > 0 ? `= ${(kEq / 478.8).toFixed(3)} lb·sⁿ/100ft²` : '';
  };
  hint('kHBHint', +(document.getElementById('kHB')?.value || 0));

  const r = (typeof rheoParams === 'function') ? rheoParams(fluidGet()) : null;
  // Power Law: blank n / K fall back to the PV/YP fit — show that as the placeholder
  const nPL = document.getElementById('nPL'), kPL = document.getElementById('kPL');
  if (r && model === 'PL') {
    if (nPL) nPL.placeholder = r.derived ? r.n.toFixed(3) : '';
    if (kPL) kPL.placeholder = r.derived ? String(Math.round(r.kEq)) : '';
    hint('kPLHint', r.kEq);
    const h = document.getElementById('kPLHint');
    if (h && r.derived) h.textContent += ' · from PV/YP (enter values to override)';
  }
  const sum = document.getElementById('rheoSummary');
  if (sum && r) sum.textContent = 'Hydraulics and Surge/Swab use: ' + rheoLabel(r);

  fluidProgramSync();
}

// Fit the selected model's parameters from the Fann readings block.
function fluidFitFann() {
  const f = _fluidFannGet() || {};
  const note = document.getElementById('fannFitNote');
  const say = t => { if (note) note.textContent = t; };
  if (!(f.t600 > 0 && f.t300 > 0 && f.t600 > f.t300)) { say('Enter at least θ600 and θ300 (θ600 > θ300).'); return; }
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const ysD = v => +QP_UNITS.toDisplay('yieldstress', v).toFixed(3);
  const model = _fluidModel();
  if (model === 'BP') {
    const b = rheoFitBingham(f.t600, f.t300);
    set('pv', b.pv); set('yp', ysD(b.yp));
    say(`Bingham: PV ${b.pv} cP, YP ${ysD(b.yp)} ${QP_UNITS.label('yieldstress')}`);
  } else if (model === 'PL') {
    const p = rheoFitPowerLaw(f.t600, f.t300);
    set('nPL', +p.n.toFixed(3)); set('kPL', Math.round(p.kEq));
    say(`Power law: n ${p.n.toFixed(3)}, K ${Math.round(p.kEq)} eq.cP`);
  } else {
    const h = rheoFitHB(f.t600, f.t300, f.t6, f.t3);
    set('tauY', ysD(h.tauY)); set('nHB', +h.n.toFixed(3)); set('kHB', Math.round(h.kEq));
    say(`Herschel-Bulkley: τ₀ ${ysD(h.tauY)} ${QP_UNITS.label('yieldstress')}, n ${h.n.toFixed(3)}, K ${Math.round(h.kEq)} eq.cP` +
        ((f.t6 > 0 && f.t3 > 0) ? '' : ' — no θ6/θ3, so τ₀ = 0'));
  }
  fluidChanged();
}

// ── Unit-system wiring ─────────────────────────────────────────────────────────

function _fluidUpdateLabels() {
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('uMudWeight', QP_UNITS.label('mw'));
  set('uPV',        QP_UNITS.label('visc'));
  set('uYP',        QP_UNITS.label('yieldstress'));
  set('uGel10s',    QP_UNITS.label('yieldstress'));
  set('uGel10m',    QP_UNITS.label('yieldstress'));
  set('uTauY',      QP_UNITS.label('yieldstress'));
  set('uFlow',      QP_UNITS.label('flow'));
  set('uSPP',       QP_UNITS.label('press'));
  _fpHeader();                     // fluid-program table header carries its own unit spans
}

function _fluidConvertFields(fromSys, toSys) {
  const conv = (q, id) => {
    const el = document.getElementById(id);
    if (el && el.value !== '') el.value = +QP_UNITS.convert(q, +el.value, fromSys, toSys).toFixed(4);
  };
  conv('mw',          'mudWeight');
  conv('yieldstress', 'yp');
  conv('yieldstress', 'gel10s');
  conv('yieldstress', 'gel10m');
  conv('yieldstress', 'tauY');
  conv('flow',        'flowRate');
  conv('press',       'rigSppLimit');
  // pv (visc), n, K (eq.cP) have factor 1 → no change

  // Fluid-program rows: convert by column quantity (cells are display units)
  const body = document.getElementById('fluidProgBody');
  if (body) {
    for (const tr of body.rows) {
      for (const inp of tr.querySelectorAll('input')) {
        const q = _FP_QTY[inp.dataset.col];
        if (q && inp.value !== '') inp.value = +QP_UNITS.convert(q, +inp.value, fromSys, toSys).toFixed(4);
      }
    }
  }
}

// ── Per-section fluid program ─────────────────────────────────────────────────
// One row per hole section (sections derive from the Well Schematic via
// qpPhaseList). Columns follow the rheology model: MW · (PV, YP | n, K | τ₀, n, K)
// · Flow. Values are shown in display units; fluidProgramGet() returns imperial
// (canonical). Stored under the additive key 'fluidProgram' — the existing
// 'fluid' key is untouched (RULE #1) and remains the well default. Row records
// carry every column (mw, pv, yp, flow, tauY, n, K); a column that is not shown
// for the current model keeps whatever it held, so switching models back loses
// nothing. 0 / absent = inherit the form value (qpPhaseFluid).

const _FP_QTY  = { mw: 'mw', pv: null, yp: 'yieldstress', tauY: 'yieldstress', n: null, K: null, flow: 'flow' };
const _FP_COLS = {
  BP: ['pv', 'yp'],
  PL: ['n', 'K'],
  HB: ['tauY', 'n', 'K'],
};
const _FP_HDR  = { mw: 'MW', pv: 'PV', yp: 'YP', tauY: 'τ₀', n: 'n', K: 'K', flow: 'Flow' };
const _FP_UNIT = col => {
  if (_FP_QTY[col]) return QP_UNITS.label(_FP_QTY[col]);
  return { pv: 'cP', K: 'eq.cP' }[col] || '';
};
const _FP_FIELDS = ['mw', 'pv', 'yp', 'flow', 'tauY', 'n', 'K'];
let _fpRows = {};                 // section key → { mw, pv, yp, flow, tauY, n, K } (imperial)

function _fpColumns() { return ['mw', ...(_FP_COLS[_fluidModel()] || _FP_COLS.HB), 'flow']; }

function _fpHeader() {
  const head = document.getElementById('fluidProgHead');
  if (!head) return;
  head.innerHTML = '<tr><th style="text-align:left">Section</th>' +
    _fpColumns().map(c => `<th>${_FP_HDR[c]} <span>${_FP_UNIT(c)}</span></th>`).join('') + '</tr>';
}

// Pull the visible cells (display units) back into the imperial cache.
function _fpHarvest() {
  const body = document.getElementById('fluidProgBody');
  if (!body) return;
  for (const tr of body.rows) {
    const rec = _fpRows[tr.dataset.key] || (_fpRows[tr.dataset.key] = {});
    for (const inp of tr.querySelectorAll('input')) {
      const col = inp.dataset.col, q = _FP_QTY[col];
      const v = inp.value === '' ? 0 : +inp.value;
      rec[col] = q ? QP_UNITS.fromDisplay(q, v) : v;
    }
  }
}

// Default (display) value for a column when the row has none: the form's value
// for the selected model (derived n/K for a Power Law without explicit values).
function _fpDefault(col) {
  const g = id => document.getElementById(id)?.value ?? '';
  const model = _fluidModel();
  switch (col) {
    case 'mw':   return g('mudWeight');
    case 'pv':   return g('pv');
    case 'yp':   return g('yp');
    case 'flow': return g('flowRate');
    case 'tauY': return g('tauY');
    case 'n':    return model === 'HB' ? g('nHB') : (g('nPL') || _fpDerived('n'));
    case 'K':    return model === 'HB' ? g('kHB') : (g('kPL') || _fpDerived('K'));
  }
  return '';
}
function _fpDerived(which) {
  if (typeof rheoParams !== 'function') return '';
  const r = rheoParams(fluidGet());
  return which === 'n' ? +r.n.toFixed(3) : Math.round(r.kEq);
}

function fluidProgramSync(harvest = true) {
  const body = document.getElementById('fluidProgBody');
  if (!body || typeof qpPhaseList !== 'function') return;
  if (harvest) _fpHarvest();
  _fpHeader();
  const cols = _fpColumns();
  body.innerHTML = '';
  qpPhaseList().forEach(p => {
    const rec = _fpRows[p.key] || {};
    const tr = document.createElement('tr');
    tr.dataset.key = p.key;
    tr.innerHTML =
      `<td style="text-align:left">${p.label}</td>` +
      cols.map(c => {
        const q = _FP_QTY[c];
        const v = rec[c] > 0 ? (q ? +QP_UNITS.toDisplay(q, rec[c]).toFixed(3) : rec[c]) : _fpDefault(c);
        return `<td class="editable"><input type="number" step="${c === 'n' ? '0.01' : '0.1'}" data-col="${c}" value="${v}" onchange="fluidProgSave()"></td>`;
      }).join('');
    body.appendChild(tr);
  });
}

function fluidProgramGet() {
  _fpHarvest();
  const body = document.getElementById('fluidProgBody');
  const out = [];
  if (!body) return out;
  for (const tr of body.rows) {
    const rec = _fpRows[tr.dataset.key] || {};
    const row = { key: tr.dataset.key };
    for (const f of _FP_FIELDS) row[f] = +(rec[f] || 0);
    out.push(row);
  }
  return out;
}

function fluidProgSave() {
  if (!qpState.currentScenarioId) return;
  dbSaveScenarioData(qpState.currentScenarioId, 'fluidProgram', fluidProgramGet());
  if (typeof qpCompute === 'function') qpCompute();
}

function fluidProgramLoadState(data) {
  _fpRows = {};
  if (Array.isArray(data)) {
    for (const row of data) {
      if (!row || row.key == null) continue;
      const rec = {};
      for (const f of _FP_FIELDS) if (row[f] > 0) rec[f] = +row[f];
      _fpRows[String(row.key)] = rec;
    }
  }
  fluidProgramSync(false);          // render from the stored records, never from stale rows
}

QP_UNITS.onChange((newSys, oldSys) => {
  _fluidConvertFields(oldSys, newSys);
  _fluidUpdateLabels();
});

document.addEventListener('DOMContentLoaded', () => {
  _fluidUpdateLabels();
  // Convert the static HTML default fields to display units on a metric startup,
  // unless a scenario has already populated them (fluidLoadState sets absolute
  // display values, so either order is correct).
  if (!_fluidLoaded && QP_UNITS.isMetric()) _fluidConvertFields('imperial', 'metric');
  document.querySelectorAll('.fann-grid input').forEach(i => i.addEventListener('change', fluidChanged));
  _fluidModelChanged();
});
