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
  // Fluid-program table headers
  set('uFpMW',   QP_UNITS.label('mw'));
  set('uFpPV',   QP_UNITS.label('visc'));
  set('uFpYP',   QP_UNITS.label('yieldstress'));
  set('uFpFlow', QP_UNITS.label('flow'));
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

  // Fluid-program rows: [MW, PV, YP, Flow] per section
  const body = document.getElementById('fluidProgBody');
  if (body) {
    const Q = ['mw', null, 'yieldstress', 'flow'];   // null = PV, factor 1
    for (const tr of body.rows) {
      [...tr.querySelectorAll('input')].forEach((inp, i) => {
        if (Q[i] && inp.value !== '') {
          inp.value = +QP_UNITS.convert(Q[i], +inp.value, fromSys, toSys).toFixed(4);
        }
      });
    }
  }
}

// ── Per-section fluid program ─────────────────────────────────────────────────
// One row per hole section (sections derive from the Well Schematic via
// qpPhaseList). Values are shown in display units; fluidProgramGet() returns
// imperial (canonical). Stored under the NEW additive key 'fluidProgram' —
// the existing 'fluid' key is untouched (RULE #1) and remains the well default.

function fluidProgramSync() {
  const body = document.getElementById('fluidProgBody');
  if (!body || typeof qpPhaseList !== 'function') return;
  const phases = qpPhaseList();

  // Preserve current display values by section key across rebuilds
  const cur = {};
  for (const tr of body.rows) cur[tr.dataset.key] = [...tr.querySelectorAll('input')].map(i => i.value);

  const g = id => document.getElementById(id)?.value ?? '';
  body.innerHTML = '';
  phases.forEach(p => {
    const vals = cur[p.key] || [g('mudWeight'), g('pv'), g('yp'), g('flowRate')];
    const tr = document.createElement('tr');
    tr.dataset.key = p.key;
    tr.innerHTML =
      `<td style="text-align:left">${p.label}</td>` +
      vals.map(v => `<td class="editable"><input type="number" step="0.1" value="${v}" onchange="fluidProgSave()"></td>`).join('');
    body.appendChild(tr);
  });
}

function fluidProgramGet() {
  const body = document.getElementById('fluidProgBody');
  const out = [];
  if (!body) return out;
  for (const tr of body.rows) {
    const i = [...tr.querySelectorAll('input')];
    out.push({
      key:  tr.dataset.key,
      mw:   QP_UNITS.fromDisplay('mw',          +(i[0]?.value || 0)),
      pv:   +(i[1]?.value || 0),
      yp:   QP_UNITS.fromDisplay('yieldstress', +(i[2]?.value || 0)),
      flow: QP_UNITS.fromDisplay('flow',        +(i[3]?.value || 0)),
    });
  }
  return out;
}

function fluidProgSave() {
  if (!qpState.currentScenarioId) return;
  dbSaveScenarioData(qpState.currentScenarioId, 'fluidProgram', fluidProgramGet());
  if (typeof qpCompute === 'function') qpCompute();
}

function fluidProgramLoadState(data) {
  fluidProgramSync();                                  // rows from current schematic
  const body = document.getElementById('fluidProgBody');
  if (!body || !Array.isArray(data)) return;
  for (const tr of body.rows) {
    const row = data.find(r => String(r.key) === tr.dataset.key);
    if (!row) continue;
    const i = [...tr.querySelectorAll('input')];
    if (row.mw   > 0 && i[0]) i[0].value = +QP_UNITS.toDisplay('mw',          row.mw).toFixed(3);
    if (row.pv   > 0 && i[1]) i[1].value = row.pv;
    if (row.yp   > 0 && i[2]) i[2].value = +QP_UNITS.toDisplay('yieldstress', row.yp).toFixed(3);
    if (row.flow > 0 && i[3]) i[3].value = +QP_UNITS.toDisplay('flow',        row.flow).toFixed(1);
  }
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
