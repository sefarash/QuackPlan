// ===== DRILLING FLUID INPUT =====
// Fields are shown in display units; fluidGet() returns imperial (canonical) so
// the compute engines are unaffected. Converting quantities:
//   mudWeight → mw · yp/gels/tauY → yieldstress · flowRate → flow · SPP → press
//   pv → visc (cP ≡ mPa·s, no numeric change). kHB/kPL/nHB/nPL/pumpEff: not converted.
//
// ONE form, MANY fluids. The form edits whichever target is selected in the
// "Editing fluid for" dropdown / the Fluid Program table (fluidProgSelect):
//   'default' → the well default, stored under the 'fluid' key (unchanged shape)
//   a section key → that hole section's own fluid, stored as a row under the
//                   additive 'fluidProgram' key. A section without its own row
//                   inherits the well default. Each section can have its own
//                   rheology model.
// The Fluid Program table is a read-only summary + selector; there is only one
// place to edit. The engines get a section's fluid through fluidForSection(key)
// (phase.js → qpPhaseFluid) and the well default through fluidBase().
//
// The form shows only the SELECTED rheology model's parameters (Bingham PV/YP,
// Power Law n/K, Herschel-Bulkley τ₀/n/K — _fluidModelChanged); hidden fields
// keep their values and are saved whichever model is active. The Fann readings
// block fits the selected model's parameters (rheoFit* in rheology-engine.js).
//
// Stored keys (RULE #1): 'fluid' = { model, mudType, mudWeight, pv, yp, gel10s,
// gel10m, tauY, nHB, kHB, flowRate, pumpEff, rigSppLimit } unchanged; nPL, kPL,
// fann additive. 'fluidProgram' rows = { key, mw, pv, yp, flow, tauY, n, K }
// unchanged; model, mudType, gel10s, gel10m, nHB, kHB, nPL, kPL, fann additive.
// Loads never write.

let _fluidLoaded  = false;
let _fpSel        = 'default';   // 'default' | section key currently shown in the form
let _fluidDefault = null;        // imperial mirror of the 'fluid' key (well default)
let _fluidDefaultFor = null;     // scenario id _fluidDefault belongs to
let _fpRows       = {};          // section key → imperial row record (own fluid)

const _FLUID_DEFAULTS = {
  mudType: 'WBM', model: 'HB', mudWeight: 10, pv: 16, yp: 13, gel10s: 5, gel10m: 10,
  tauY: 8, nHB: 0.7, kHB: 120, flowRate: 280, pumpEff: 90, rigSppLimit: 3500, nPL: 0, kPL: 0,
};

function fluidChanged() {
  fluidSave();             // route to the well default or the selected section
  _fluidModelChanged();    // then refresh visibility, notes and the summary table
}

// Route the form to its target: the well default ('fluid') or a section row.
function fluidSave() {
  if (!qpState.currentScenarioId) return;
  const f = fluidGet();
  if (_fpSel === 'default') {
    _fluidDefault = f; _fluidDefaultFor = qpState.currentScenarioId;
    dbSaveScenarioData(qpState.currentScenarioId, 'fluid', f);
  } else {
    _fpRows[_fpSel] = _fpRowFromFluid(f);
    dbSaveScenarioData(qpState.currentScenarioId, 'fluidProgram', fluidProgramGet());
  }
  if (typeof qpComputeDebounced === 'function') qpComputeDebounced(150);
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

// The well default as the engines should see it (imperial).
function fluidBase() {
  if (_fluidDefault && _fluidDefaultFor === (qpState.currentScenarioId ?? null)) return _fluidDefault;
  return _fpSel === 'default' ? fluidGet() : { ..._FLUID_DEFAULTS, ...(_fluidDefault || {}) };
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

// Fill the form from an imperial fluid-shaped record (no save).
function _fluidFillForm(data) {
  if (!data) return;
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
}

// Scenario load: the stored 'fluid' key is the well default.
function fluidLoadState(data) {
  if (!data) return;
  _fluidDefault = { ..._FLUID_DEFAULTS, ...data };
  _fluidDefaultFor = qpState.currentScenarioId ?? null;
  _fpSel = 'default';
  _fluidFillForm(_fluidDefault);
  _fluidLoaded = true;
  _fluidUpdateLabels();
  _fluidModelChanged();
}

// ── Section records ↔ fluid records ──────────────────────────────────────────
// Row: { mw, pv, yp, flow, tauY, n, K } (original columns; n/K = the row model's
// effective values) + model, mudType, gel10s, gel10m, nHB, kHB, nPL, kPL, fann.
const _FP_NUM = ['mw', 'pv', 'yp', 'flow', 'tauY', 'n', 'K', 'gel10s', 'gel10m', 'nHB', 'kHB', 'nPL', 'kPL'];

function _fpRowFromFluid(f) {
  const isHB = f.model === 'HB', isPL = f.model === 'PL';
  const row = {
    mw: f.mudWeight, pv: f.pv, yp: f.yp, flow: f.flowRate, tauY: f.tauY,
    n: isHB ? f.nHB : (isPL ? f.nPL : 0),
    K: isHB ? f.kHB : (isPL ? f.kPL : 0),
    model: f.model, mudType: f.mudType, gel10s: f.gel10s, gel10m: f.gel10m,
    nHB: f.nHB, kHB: f.kHB, nPL: f.nPL, kPL: f.kPL,
  };
  if (f.fann) row.fann = f.fann;
  return row;
}

// A section's fluid: its own row over the well default (0 / absent = inherit).
function _fluidFromRow(row, base) {
  const pick = (v, b) => (v > 0 ? +v : b);
  const model = row.model || base.model || 'HB';
  const out = {
    ...base,
    model,
    mudType:   row.mudType || base.mudType,
    mudWeight: pick(row.mw,     base.mudWeight),
    pv:        pick(row.pv,     base.pv),
    yp:        pick(row.yp,     base.yp),
    gel10s:    pick(row.gel10s, base.gel10s),
    gel10m:    pick(row.gel10m, base.gel10m),
    tauY:      pick(row.tauY,   base.tauY),
    flowRate:  pick(row.flow,   base.flowRate),
    nHB: pick(row.nHB, model === 'HB' && row.n > 0 ? row.n : base.nHB),
    kHB: pick(row.kHB, model === 'HB' && row.K > 0 ? row.K : base.kHB),
    nPL: pick(row.nPL, model === 'PL' && row.n > 0 ? row.n : base.nPL),
    kPL: pick(row.kPL, model === 'PL' && row.K > 0 ? row.K : base.kPL),
  };
  if (row.fann) out.fann = row.fann; else delete out.fann;
  return out;
}

function fluidForSection(key) {
  return _fluidFromRow(_fpRows[String(key)] || {}, fluidBase());
}

// ── Target selection ──────────────────────────────────────────────────────────
function fluidProgSelect(key) {
  key = String(key ?? 'default');
  const phases = (typeof qpPhaseList === 'function') ? qpPhaseList() : [];
  if (key !== 'default' && !phases.some(p => p.key === key)) key = 'default';
  _fpSel = key;
  _fluidFillForm(key === 'default' ? fluidBase() : fluidForSection(key));
  _fluidModelChanged();
}

function _fpSelLabel() {
  if (_fpSel === 'default') return 'Well default';
  const p = (typeof qpPhaseList === 'function') ? qpPhaseList().find(x => x.key === _fpSel) : null;
  return p ? p.label : 'Section ' + _fpSel;
}

// ── Model-dependent form ───────────────────────────────────────────────────────
// Shows the selected model's parameter block, refreshes the K hints / derived
// Power-Law placeholders / summary line, and rebuilds the fluid-program table.
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

  // Target indication: form heading, dropdown, well-wide fields
  const sec = _fpSel !== 'default';
  const pl  = document.getElementById('fluidPropsLabel');
  if (pl) pl.textContent = 'Fluid Properties — ' + _fpSelLabel();
  const note = document.getElementById('fluidTargetNote');
  if (note) note.textContent = sec
    ? (_fpRows[_fpSel] ? 'this section has its own fluid' : 'inheriting the well default — edit any field to give this section its own fluid')
    : 'used by every section without its own fluid, and by the "Full well" analysis';
  ['pumpEff', 'rigSppLimit'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = sec; });

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
  set('uFpMW',      QP_UNITS.label('mw'));
  set('uFpFlow',    QP_UNITS.label('flow'));
  fluidProgramSync();              // table cells are rendered from imperial records
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
}

// ── Per-section fluid program (summary table + selector) ─────────────────────
// One row per hole section (sections derive from the Well Schematic via
// qpPhaseList) plus the well default. Rendered from the imperial records; not
// editable in place — select a row and use the form.

function _fpRheoSummary(f) {
  const r = rheoParams(f);
  const ys = v => `${(+QP_UNITS.toDisplay('yieldstress', v)).toFixed(1)}`;
  if (r.model === 'BP') return `PV ${r.pv} cP · YP ${ys(r.yp)} ${QP_UNITS.label('yieldstress')}`;
  if (r.model === 'PL') return `n ${r.n.toFixed(2)} · K ${Math.round(r.kEq)} eq.cP${r.derived ? ' (from PV/YP)' : ''}`;
  return `τ₀ ${ys(r.tauY)} ${QP_UNITS.label('yieldstress')} · n ${r.n.toFixed(2)} · K ${Math.round(r.kEq)} eq.cP`;
}
const _FP_MODEL_NAME = { HB: 'Herschel-Bulkley', BP: 'Bingham', PL: 'Power law' };

function fluidProgramSync() {
  const body = document.getElementById('fluidProgBody');
  if (!body || typeof qpPhaseList !== 'function' || typeof rheoParams !== 'function') return;
  const phases = qpPhaseList();
  if (_fpSel !== 'default' && !phases.some(p => p.key === _fpSel)) _fpSel = 'default';

  // Dropdown mirrors the table
  const sel = document.getElementById('fluidTarget');
  if (sel) {
    sel.innerHTML = '<option value="default">Well default</option>' +
      phases.map(p => `<option value="${p.key}">${p.label}${_fpRows[p.key] ? '' : ' (inherits default)'}</option>`).join('');
    sel.value = _fpSel;
  }

  const base = fluidBase();
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rowHTML = (key, label, f, own) => {
    const inh = own ? '' : ' fp-inherit';
    const mw = (+QP_UNITS.toDisplay('mw', f.mudWeight)).toFixed(2);
    const fl = Math.round(QP_UNITS.toDisplay('flow', f.flowRate));
    return `<tr class="fp-row${_fpSel === key ? ' fp-selected' : ''}" data-key="${key}" onclick="fluidProgSelect('${key}')" title="${own ? 'Own fluid — click to edit' : 'Inherits the well default — click to edit'}">
      <td><input type="radio" name="fpSel" value="${key}" ${_fpSel === key ? 'checked' : ''} onclick="event.stopPropagation(); fluidProgSelect('${key}')"></td>
      <td style="text-align:left">${esc(label)}</td>
      <td class="${inh}">${_FP_MODEL_NAME[f.model] || esc(f.model)}</td>
      <td class="${inh}">${mw}</td>
      <td style="text-align:left" class="${inh}">${esc(_fpRheoSummary(f))}</td>
      <td class="${inh}">${fl}</td>
    </tr>`;
  };
  body.innerHTML =
    rowHTML('default', 'Well default', base, true) +
    phases.map(p => rowHTML(p.key, p.label, fluidForSection(p.key), !!_fpRows[p.key])).join('');
}

// Stored rows: only sections with their own fluid, full record each.
function fluidProgramGet() {
  const phases = (typeof qpPhaseList === 'function') ? qpPhaseList() : [];
  const keys = phases.length ? phases.map(p => p.key) : Object.keys(_fpRows);
  const out = [];
  for (const key of keys) {
    const rec = _fpRows[key];
    if (!rec) continue;
    const row = { key };
    for (const f of _FP_NUM) row[f] = +(rec[f] || 0);
    row.model = rec.model || 'HB';
    row.mudType = rec.mudType || 'WBM';
    if (rec.fann) row.fann = rec.fann;
    out.push(row);
  }
  return out;
}

function fluidProgSave() {          // kept for older callers
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
      for (const f of _FP_NUM) if (row[f] > 0) rec[f] = +row[f];
      if (row.model)   rec.model   = row.model;
      if (row.mudType) rec.mudType = row.mudType;
      if (row.fann)    rec.fann    = row.fann;
      _fpRows[String(row.key)] = rec;
    }
  }
  // A scenario without a stored 'fluid' key keeps whatever the form shows (as
  // before); snapshot that as the well default so section rows resolve against it.
  if (_fluidDefaultFor !== (qpState.currentScenarioId ?? null)) {
    _fluidDefault = fluidGet(); _fluidDefaultFor = qpState.currentScenarioId ?? null;
  }
  _fpSel = 'default';
  _fluidFillForm(fluidBase());
  _fluidModelChanged();             // renders the table from the stored records, never writes
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
