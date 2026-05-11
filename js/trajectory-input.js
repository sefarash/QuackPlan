// ===== TRAJECTORY INPUT =====
// Option 1 (MD/Inc/Azi), Option 2 (mixed), Tortuosity tables
// DLS display: °/100ft

const _T1_DEFAULTS = { md: 0, inc: 0, azi: 0 };

// ── Option 1 ─────────────────────────────────────────────────────────────────

function traj1AddRow(vals) {
  const body = document.getElementById('traj1Body');
  const idx  = body.rows.length;
  const v    = vals || { md: idx === 0 ? 0 : '', inc: '', azi: '' };

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="drag-handle">⠿</td>
    <td class="editable"><input type="number" value="${v.md}" step="1" onchange="traj1Recalc()"></td>
    <td class="editable"><input type="number" value="${v.inc}" step="0.01" onchange="traj1Recalc()"></td>
    <td class="editable"><input type="number" value="${v.azi}" step="0.1" onchange="traj1Recalc()"></td>
    <td class="calc-cell" data-col="tvd">—</td>
    <td class="calc-cell" data-col="tvdss">—</td>
    <td class="calc-cell" data-col="dls">—</td>
    <td class="row-act"><button onclick="traj1DeleteRow(this)">✕</button></td>`;
  body.appendChild(tr);
  traj1Recalc();
}

function traj1DeleteRow(btn) {
  btn.closest('tr').remove();
  traj1Recalc();
}

function traj1Recalc() {
  const body     = document.getElementById('traj1Body');
  const stations = _traj1ReadStations();
  if (stations.length < 1) return;

  const survey = computeSurvey(stations);
  qpState.survey = survey;

  survey.forEach((pt, i) => {
    const row = body.rows[i];
    if (!row) return;
    const dls100 = (pt.dls * DLS_SCALE).toFixed(2);
    _setCell(row, 'tvd',   pt.tvd.toFixed(1));
    _setCell(row, 'tvdss', pt.tvd.toFixed(1));   // TVDss ≈ TVD (no KB offset input yet)
    _setCell(row, 'dls',   dls100);
  });

  _traj1Save();
  if (typeof drawSchematic === 'function') drawSchematic(survey);
}

function _traj1ReadStations() {
  const rows = document.getElementById('traj1Body').rows;
  const stations = [];
  for (const row of rows) {
    const inputs = row.querySelectorAll('input[type=number]');
    const md  = +(inputs[0]?.value || 0);
    const inc = +(inputs[1]?.value || 0);
    const az  = +(inputs[2]?.value || 0);
    if (inputs[0]?.value === '' && stations.length > 0) continue;
    stations.push({ md, inc, az });
  }
  return stations;
}

function _setCell(row, col, val) {
  const cell = row.querySelector(`[data-col="${col}"]`);
  if (cell) cell.textContent = val;
}

function _traj1Save() {
  if (!qpState.currentScenarioId) {
    setStatus('Select a scenario to save data');
    return;
  }
  const rows = document.getElementById('traj1Body').rows;
  const data = [];
  let prevMD = 0;
  for (const row of rows) {
    const inputs = row.querySelectorAll('input[type=number]');
    const md  = inputs[0]?.value !== '' ? inputs[0]?.value : String(prevMD);
    const inc = inputs[1]?.value || '0';
    const azi = inputs[2]?.value || '0';
    data.push({ md, inc, azi });
    prevMD = +md;
  }
  dbSaveScenarioData(qpState.currentScenarioId, 'traj1', data);
}

function trajLoadRows(data) {
  const body = document.getElementById('traj1Body');
  body.innerHTML = '';
  (data || []).forEach(v => traj1AddRow(v));
}

// ── Excel paste handler ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const t1 = document.getElementById('traj1Table');
  if (!t1) return;

  t1.addEventListener('paste', e => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text');
    const lines = text.trim().split(/\r?\n/);
    const body  = document.getElementById('traj1Body');
    body.innerHTML = '';   // replace on paste
    lines.forEach(line => {
      const cols = line.split(/\t/);
      traj1AddRow({ md: cols[0] || 0, inc: cols[1] || 0, azi: cols[2] || 0 });
    });
  });

  // Seed two empty rows so the user sees something
  if (!document.getElementById('traj1Body').rows.length) {
    traj1AddRow({ md: 0,    inc: 0, azi: 0 });
    traj1AddRow({ md: 5000, inc: 0, azi: 0 });
  }
});

// ── Option 2 ─────────────────────────────────────────────────────────────────

function traj2AddRow() {
  const body = document.getElementById('traj2Body');
  const tr   = document.createElement('tr');
  tr.innerHTML = `
    <td class="drag-handle">⠿</td>
    <td class="editable">
      <select onchange="traj2ModeChange(this)">
        <option value="md_inc_azi">MD / Inc / Azi</option>
        <option value="inc_azi_tvd">Inc / Azi / TVD</option>
        <option value="inc_azi_dls">Inc / Azi / DLS</option>
      </select>
    </td>
    <td data-field="md"  class="editable"><input type="number" step="1"    onchange="traj2Recalc()"></td>
    <td data-field="inc" class="editable"><input type="number" step="0.01" onchange="traj2Recalc()"></td>
    <td data-field="azi" class="editable"><input type="number" step="0.1"  onchange="traj2Recalc()"></td>
    <td data-field="tvd" class="calc-cell" data-col="tvd2">—</td>
    <td data-field="dls" class="calc-cell" data-col="dls2">—</td>
    <td class="row-act"><button onclick="this.closest('tr').remove();traj2Recalc()">✕</button></td>`;
  body.appendChild(tr);
  traj2Recalc();
}

// Called when the Define dropdown changes — toggles which cells are editable
function traj2ModeChange(sel) {
  _traj2UpdateCells(sel.closest('tr'), sel.value);
  traj2Recalc();
}

function _traj2UpdateCells(tr, mode) {
  const editableFields = {
    'md_inc_azi':  ['md', 'inc', 'azi'],
    'inc_azi_tvd': ['inc', 'azi', 'tvd'],
    'inc_azi_dls': ['inc', 'azi', 'dls'],
  }[mode] || ['md', 'inc', 'azi'];

  const steps = { md: '1', inc: '0.01', azi: '0.1', tvd: '1', dls: '0.01' };

  ['md', 'inc', 'azi', 'tvd', 'dls'].forEach(field => {
    const td = tr.querySelector(`[data-field="${field}"]`);
    if (!td) return;
    const isInput = editableFields.includes(field);

    if (isInput && !td.querySelector('input')) {
      td.className = 'editable';
      td.removeAttribute('data-col');
      td.innerHTML = `<input type="number" step="${steps[field]}" onchange="traj2Recalc()">`;
    } else if (!isInput && td.querySelector('input')) {
      td.className = 'calc-cell';
      const colMap = { md: 'md2', tvd: 'tvd2', dls: 'dls2' };
      td.setAttribute('data-col', colMap[field] || field + '2');
      td.textContent = '—';
    }
  });
}

function _traj2ReadField(tr, field) {
  const td = tr.querySelector(`[data-field="${field}"]`);
  if (!td) return '';
  const input = td.querySelector('input');
  return input ? input.value : td.textContent;
}

function traj2Recalc() {
  const body = document.getElementById('traj2Body');
  const rows = [];
  for (const tr of body.rows) {
    const sel = tr.querySelector('select');
    rows.push({
      define: sel?.value || 'md_inc_azi',
      md:  _traj2ReadField(tr, 'md'),
      inc: _traj2ReadField(tr, 'inc'),
      azi: _traj2ReadField(tr, 'azi'),
      tvd: _traj2ReadField(tr, 'tvd'),
      dls: _traj2ReadField(tr, 'dls'),
    });
  }

  const stations = traj2BuildStations(rows);
  if (stations.length < 2) return;

  const survey = computeSurvey(stations);
  qpState.survey = survey;

  survey.forEach((pt, i) => {
    const tr = body.rows[i];
    if (!tr) return;
    _setCell(tr, 'md2',  pt.md.toFixed(1));
    _setCell(tr, 'tvd2', pt.tvd.toFixed(1));
    _setCell(tr, 'dls2', (pt.dls * DLS_SCALE).toFixed(2));
  });

  if (typeof drawSchematic === 'function') drawSchematic(survey);
}

// ── Tortuosity ────────────────────────────────────────────────────────────────

function tortAddRow() {
  const body = document.getElementById('tortBody');
  const tr   = document.createElement('tr');
  tr.innerHTML = `
    <td class="drag-handle">⠿</td>
    <td class="editable"><input type="number" step="100" value="0" onchange="tortRecalc()"></td>
    <td class="editable"><input type="number" step="100" value="5000" onchange="tortRecalc()"></td>
    <td class="editable"><input type="number" step="0.1" value="0.5" onchange="tortRecalc()"></td>
    <td class="editable">
      <select onchange="tortRecalc()">
        <option value="random">Random</option>
        <option value="sinusoidal">Sinusoidal</option>
      </select>
    </td>
    <td class="row-act"><button onclick="this.closest('tr').remove();tortRecalc()">✕</button></td>`;
  body.appendChild(tr);
}

function tortRecalc() {
  const body      = document.getElementById('tortBody');
  const intervals = [];
  for (const tr of body.rows) {
    const inputs = tr.querySelectorAll('input[type=number]');
    const sel    = tr.querySelector('select');
    intervals.push({
      startMD: inputs[0]?.value, endMD: inputs[1]?.value,
      tort: inputs[2]?.value, mode: sel?.value || 'random',
    });
  }
  if (!qpState.survey.length) return;
  const base    = qpState.survey.map(s => ({ md: s.md, inc: s.inc, az: s.az || s.azimuth || 0 }));
  const applied = applyTortuosity(base, intervals);
  const survey  = computeSurvey(applied);
  if (typeof drawSchematic === 'function') drawSchematic(survey);
}

// ── Well Schematic table ──────────────────────────────────────────────────────

function _schOdOptions() {
  return CATALOGUE_ODS.map(od =>
    `<option value="${od}">${od}"</option>`
  ).join('');
}

function _schGradeOptions(od) {
  if (!od) return '<option value="">— pick OD first —</option>';
  return catalogueByOD(od).map(r =>
    `<option value="${r[1]}_${r[2]}">${r[1]} lb/ft — ${r[2]}</option>`
  ).join('');
}

function schematicAddRow(preset) {
  const body = document.getElementById('schematicBody');
  const tr   = document.createElement('tr');

  const defaultOD = preset?.od || '';
  const gradeOpts = _schGradeOptions(defaultOD);

  tr.innerHTML = `
    <td class="drag-handle">⠿</td>
    <td class="editable">
      <select onchange="schematicSave()">
        <option>Conductor</option>
        <option>Surface Casing</option>
        <option>Intermediate Casing</option>
        <option>Production Casing</option>
        <option>Liner</option>
        <option>Open Hole</option>
        <option>Tubing</option>
      </select>
    </td>
    <td class="editable" style="min-width:90px">
      <select class="sch-od" onchange="_schOdChanged(this)" style="width:100%">
        <option value="">— OD —</option>
        ${_schOdOptions()}
      </select>
    </td>
    <td class="editable" style="min-width:140px">
      <select class="sch-grade" onchange="_schGradeChanged(this)" style="width:100%">
        <option value="">— Wt / Grade —</option>
        ${gradeOpts}
      </select>
    </td>
    <td class="editable" style="min-width:60px">
      <input type="number" class="sch-size" step="0.125" value="${preset?.size ?? 13.375}"
        style="width:58px" onchange="schematicSave()">
    </td>
    <td class="editable"><input type="number" step="1" value="${preset?.top ?? 0}" onchange="schematicSave()"></td>
    <td class="editable"><input type="number" step="1" value="${preset?.bot ?? 5000}" onchange="schematicSave()"></td>
    <td class="row-act"><button onclick="this.closest('tr').remove();schematicSave()">✕</button></td>`;
  body.appendChild(tr);
  schematicSave();
}

function _schOdChanged(odSel) {
  const tr       = odSel.closest('tr');
  const gradeSel = tr.querySelector('.sch-grade');
  const sizeIn   = tr.querySelector('.sch-size');
  const od       = odSel.value;

  // Repopulate grade dropdown
  gradeSel.innerHTML = `<option value="">— Wt / Grade —</option>${_schGradeOptions(od)}`;
  gradeSel.value = '';

  // Auto-fill size from OD decimal
  if (od) sizeIn.value = _odToDecimal(od);
  _schStoreCatalogueSpec(tr, null);
  schematicSave();
}

function _schGradeChanged(gradeSel) {
  const tr  = gradeSel.closest('tr');
  const od  = tr.querySelector('.sch-od').value;
  const val = gradeSel.value;           // "nomWt_grade" e.g. "15_L-80"

  if (!val || !od) { _schStoreCatalogueSpec(tr, null); schematicSave(); return; }

  const [wStr, grade] = val.split('_');
  const nomWt = parseFloat(wStr);
  const spec  = catalogueByOD(od).find(r => r[1] === nomWt && r[2] === grade);
  _schStoreCatalogueSpec(tr, spec ? catalogueSpec(spec) : null);
  schematicSave();
}

function _schStoreCatalogueSpec(tr, spec) {
  // Store as data attribute for use by casing design and export
  tr.dataset.casingSpec = spec ? JSON.stringify(spec) : '';
}

function schematicLoadRows(data) {
  const body = document.getElementById('schematicBody');
  body.innerHTML = '';
  (data || []).forEach(row => {
    schematicAddRow({ size: row.size, top: row.top, bot: row.bot, od: row.od || '' });
    const tr     = body.rows[body.rows.length - 1];
    const selDef = tr.querySelector('select');
    const odSel  = tr.querySelector('.sch-od');
    const gradSel= tr.querySelector('.sch-grade');
    const sizeIn = tr.querySelector('.sch-size');

    if (selDef)  selDef.value  = row.def  ?? 'Open Hole';
    if (sizeIn)  sizeIn.value  = row.size ?? 9.625;

    // Restore catalogue selections
    if (row.od && odSel) {
      odSel.value = row.od;
      gradSel.innerHTML = `<option value="">— Wt / Grade —</option>${_schGradeOptions(row.od)}`;
      if (row.grade) gradSel.value = row.grade;
    }
    if (row.casingSpec) {
      try { _schStoreCatalogueSpec(tr, JSON.parse(row.casingSpec)); } catch (_) {}
    }
  });
  if (qpState.survey?.length > 1) drawSchematic(qpState.survey);
}

function schematicSave() {
  if (!qpState.currentScenarioId) return;
  const rows = [];
  for (const tr of document.getElementById('schematicBody').rows) {
    const selDef  = tr.querySelector('select');
    const odSel   = tr.querySelector('.sch-od');
    const gradSel = tr.querySelector('.sch-grade');
    const sizeIn  = tr.querySelector('.sch-size');
    // inputs[type=number]: [0]=size, [1]=top, [2]=bot
    const inputs  = tr.querySelectorAll('input[type=number]');
    rows.push({
      def:        selDef?.value,
      size:       sizeIn?.value ?? inputs[0]?.value,
      top:        inputs[1]?.value,
      bot:        inputs[2]?.value,
      od:         odSel?.value   || '',
      grade:      gradSel?.value || '',
      casingSpec: tr.dataset.casingSpec || '',
    });
  }
  dbSaveScenarioData(qpState.currentScenarioId, 'schematic', rows);
  if (typeof drawSchematic === 'function') drawSchematic(qpState.survey);
}
