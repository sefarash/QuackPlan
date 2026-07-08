// ===== DRILLING FLUID INPUT =====
// Fields are shown in display units; fluidGet() returns imperial (canonical) so
// the compute engines are unaffected. Converting quantities:
//   mudWeight → mw · yp/gels/tauY → yieldstress · flowRate → flow · SPP → press
//   pv → visc (cP ≡ mPa·s, no numeric change). kHB/nHB/pumpEff: not converted.

let _fluidLoaded = false;

function fluidChanged() {
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
  };
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
  setD('flow',        'flowRate',    data.flowRate);
  setRaw('pumpEff',   data.pumpEff);
  setD('press',       'rigSppLimit', data.rigSppLimit);

  _fluidLoaded = true;
  _fluidUpdateLabels();
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
  // pv (visc) has factor 1 → no change
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
});
