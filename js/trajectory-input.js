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

// RKB elevation above mean sea level (ft), used to convert TVD (from RKB) into
// TVDss (below MSL): TVDss = TVD − this. Onshore the RKB sits GL-above-MSL plus
// its height above ground; offshore the RKB height is measured from MSL directly.
function _kbElevationAboveMSL() {
  const d = qpState.wellDatums;
  if (!d) return 0;
  const rkb = +d.rkb || 0;
  return d.environment === 'offshore' ? rkb : (+d.gl || 0) + rkb;
}

function traj1Recalc() {
  const body     = document.getElementById('traj1Body');
  const stations = _traj1ReadStations();
  if (stations.length < 1) return;

  // Always persist raw edits so nothing is lost, even if the MD sequence is bad
  _traj1Save();
  _trajSetSource('opt1');           // a user edit here makes Option 1 the survey source

  // MD must strictly increase down the wellbore. A non-monotonic sequence would
  // otherwise silently produce garbage TVD/DLS and NaN/Infinity downstream.
  if (!_trajValidate(stations)) return;   // warning shown; keep the last good survey

  const survey = computeSurvey(stations);
  qpState.baseSurvey = survey;
  qpState.survey = survey;

  const kbElev = _kbElevationAboveMSL();   // imperial ft
  survey.forEach((pt, i) => {
    const row = body.rows[i];
    if (!row) return;
    const dls100 = pt.dls * DLS_SCALE;      // °/100ft (imperial canonical)
    _setCell(row, 'tvd',   QP_UNITS.toDisplay('depth', pt.tvd).toFixed(1));
    _setCell(row, 'tvdss', QP_UNITS.toDisplay('depth', pt.tvd - kbElev).toFixed(1)); // TVDss = TVD − RKB-above-MSL
    _setCell(row, 'dls',   QP_UNITS.toDisplay('dls', dls100).toFixed(2));
  });

  if (typeof drawSchematic === 'function') drawSchematic(survey);
}

// Validate that survey MD strictly increases. Highlights offending rows and
// renders a red warning; returns true when the sequence is valid.
function _trajValidate(stations) {
  const body    = document.getElementById('traj1Body');
  const warnDiv = document.getElementById('trajWarnings');
  if (!body) return true;
  for (const tr of body.rows) tr.style.outline = '';

  const u = QP_UNITS.label('depth');
  const fmt = ft => Math.round(QP_UNITS.toDisplay('depth', ft)).toLocaleString();
  const warnings = [];
  for (let i = 1; i < stations.length; i++) {
    const md = stations[i].md, prev = stations[i - 1].md;   // imperial
    if (!(md > prev)) {
      warnings.push(md < prev
        ? `Row ${i + 1}: MD ${fmt(md)} ${u} decreases from ${fmt(prev)} ${u} — MD must strictly increase down the wellbore`
        : `Row ${i + 1}: MD ${fmt(md)} ${u} repeats the previous station — each MD must be greater than the one above`);
      if (body.rows[i]) body.rows[i].style.outline = '2px solid #e05555';
    }
  }

  if (warnDiv) {
    warnDiv.innerHTML = warnings.map(msg =>
      `<div style="display:flex;align-items:flex-start;gap:5px;padding:3px 0;font-size:10px;color:#e05555">
         <span style="flex-shrink:0;font-weight:bold">✕</span><span>${msg}</span>
       </div>`).join('');
  }
  return warnings.length === 0;
}

// ── Unit-system wiring (Option 1) ──────────────────────────────────────────────

// Refresh the Option 1 column headers with the current unit labels
function _trajUpdateHeaders() {
  const d = QP_UNITS.label('depth'), dls = QP_UNITS.label('dls');
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('hdrMD',    `MD (${d})`);
  set('hdrTVD',   `TVD (${d})`);
  set('hdrTVDss', `TVDss (${d})`);
  set('hdrDLS',   `DLS (${dls})`);
}

// Convert the Option 1 MD input fields between two unit systems in place
function _traj1ConvertFields(fromSys, toSys) {
  const body = document.getElementById('traj1Body');
  if (!body) return;
  for (const row of body.rows) {
    const inp = row.querySelectorAll('input[type=number]')[0];
    if (inp && inp.value !== '') {
      inp.value = +QP_UNITS.convert('depth', +inp.value, fromSys, toSys).toFixed(3);
    }
  }
}

// Schematic MD Top/Bottom column headers reflect the current depth unit
function _schUpdateHeaders() {
  const d = QP_UNITS.label('depth');
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('hdrSchTop', `MD Top (${d})`);
  set('hdrSchBot', `MD Bottom (${d})`);
  set('hdrSchToc', `TOC (${d})`);
}

// Convert the schematic MD Top/Bottom input fields between unit systems in place
function _schConvertFields(fromSys, toSys) {
  const body = document.getElementById('schematicBody');
  if (!body) return;
  for (const tr of body.rows) {
    // depth fields only — OD and hole size stay in inches
    ['.sch-top', '.sch-bot', '.sch-toc'].forEach(cls => {
      const inp = tr.querySelector(cls);
      if (inp && inp.value !== '') inp.value = +QP_UNITS.convert('depth', +inp.value, fromSys, toSys).toFixed(2);
    });
  }
}

// On unit change: relabel, convert the visible trajectory + schematic MD fields,
// recompute the ACTIVE trajectory option (so qpState.survey isn't clobbered by an
// inactive one), redraw the schematic, then the active output panel. Schematic
// fields are converted BEFORE any redraw that reads _readSchematicRows (e.g. the
// trajectory plot's shoe markers).
QP_UNITS.onChange((newSys, oldSys) => {
  _trajUpdateHeaders();
  _traj1ConvertFields(oldSys, newSys);
  _schUpdateHeaders();
  _schConvertFields(oldSys, newSys);
  const opt = qpState.activeTrajOpt;
  if      (opt === 'opt2' && typeof traj2Recalc === 'function') traj2Recalc();
  else if (opt === 'tort' && typeof tortRecalc  === 'function') tortRecalc();
  else                                                          traj1Recalc();
  if (typeof drawSchematic === 'function' && qpState.survey?.length > 1) drawSchematic(qpState.survey);
  if (qpState.activeOutputTab && typeof redrawOutputPanel === 'function') {
    redrawOutputPanel(qpState.activeOutputTab);
  }
});

function _traj1ReadStations() {
  const rows = document.getElementById('traj1Body').rows;
  const stations = [];
  for (const row of rows) {
    const inputs = row.querySelectorAll('input[type=number]');
    if (inputs[0]?.value === '' && stations.length > 0) continue;
    // MD field is in display units → convert to imperial (canonical); inc/az are
    // angles (identical in both systems).
    const md  = QP_UNITS.fromDisplay('depth', +(inputs[0]?.value || 0));
    const inc = +(inputs[1]?.value || 0);
    const az  = +(inputs[2]?.value || 0);
    stations.push({ md, inc, az });
  }
  return stations;
}

function _setCell(row, col, val) {
  const cell = row.querySelector(`[data-col="${col}"]`);
  if (cell) cell.textContent = val;
}

function _traj1Save() {
  const tid = qpSaveTarget('traj1');
  if (!tid) { setStatus('Select a borehole or scenario to save data'); return; }
  const rows = document.getElementById('traj1Body').rows;
  const data = [];
  for (const row of rows) {
    const inputs = row.querySelectorAll('input[type=number]');
    // Store MD in imperial (canonical), converting from the display field. A
    // row the user hasn't filled in yet stays BLANK ('') — trajLoadRows restores
    // it blank and _traj1ReadStations skips it. (It used to be saved as a copy
    // of the previous MD, which came back as a duplicate station on reload.)
    const md  = inputs[0]?.value !== ''
      ? String(+QP_UNITS.fromDisplay('depth', +inputs[0].value).toFixed(4))
      : '';
    const inc = inputs[1]?.value || '0';
    const azi = inputs[2]?.value || '0';
    data.push({ md, inc, azi });
  }
  dbSaveScenarioData(tid, 'traj1', data);
}

function trajLoadRows(data) {
  const body = document.getElementById('traj1Body');
  body.innerHTML = '';
  // Saved MD is imperial (canonical) → convert to display units for the field
  (data || []).forEach(v => traj1AddRow({
    md:  (v.md === '' || v.md == null) ? v.md : +QP_UNITS.toDisplay('depth', +v.md).toFixed(3),
    inc: v.inc, azi: v.azi,
  }));
}

// ── Excel paste handler ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const t1 = document.getElementById('traj1Table');
  if (!t1) return;

  // Excel paste. RULE #1: this used to clear the whole table on ANY paste —
  // pasting one number into one cell wiped a user's survey and saved the
  // 1-row result. Now:
  //   single value          → default browser paste into the focused cell
  //   one tab-separated row → fills the focused row's MD / Inc / Azi
  //   multi-line block      → replaces the table, after confirmation when it
  //                           would discard existing stations
  t1.addEventListener('paste', e => {
    const text  = (e.clipboardData || window.clipboardData).getData('text') || '';
    const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const isBlock = lines.length > 1 || /\t/.test(text);
    if (!isBlock) return;                                   // plain value → normal paste
    e.preventDefault();
    const body = document.getElementById('traj1Body');
    const parse = line => line.split(/\t|,|;/).map(c => c.trim());
    if (lines.length === 1) {                               // one row → fill the row under the cursor
      const tr = e.target.closest ? e.target.closest('tr') : null;
      if (tr && body.contains(tr)) {
        const cols = parse(lines[0]), inputs = tr.querySelectorAll('input[type=number]');
        cols.slice(0, 3).forEach((c, i) => { if (inputs[i] && c !== '') inputs[i].value = c; });
        traj1Recalc();
        return;
      }
    }
    const existing = [...body.rows].filter(tr => tr.querySelector('input[type=number]')?.value !== '').length;
    if (existing > 1 && !confirm(`Replace the ${existing} existing trajectory stations with the ${lines.length} pasted rows?`)) return;
    body.innerHTML = '';
    lines.forEach(line => {
      const cols = parse(line);
      traj1AddRow({ md: cols[0] || 0, inc: cols[1] || 0, azi: cols[2] || 0 });
    });
  });

  // Seed two empty rows so the user sees something (5000 ft canonical → display)
  if (!document.getElementById('traj1Body').rows.length) {
    traj1AddRow({ md: 0, inc: 0, azi: 0 });
    traj1AddRow({ md: +QP_UNITS.toDisplay('depth', 5000).toFixed(3), inc: 0, azi: 0 });
  }
  _trajUpdateHeaders();
  _schUpdateHeaders();
});

// ── Survey source (Option 1 vs Option 2) ──────────────────────────────────────
// Which option feeds qpState.survey is stored per scenario under the additive
// key 'trajOpt' ('opt1' | 'opt2'). It used to be implicit: on load Option 2 was
// recalculated last and silently won whenever it had rows, so two leftover
// Option 2 rows made a user's Option 1 survey "disappear" from every output.
function _trajSetSource(opt) {
  if (opt !== 'opt1' && opt !== 'opt2') return;
  if (typeof qpState === 'undefined' || qpState.loadingScenario) return;
  const changed = qpState.trajSource !== opt;
  qpState.trajSource = opt;
  const tid = changed ? qpSaveTarget('trajOpt') : null;
  if (tid) dbSaveScenarioData(tid, 'trajOpt', opt);
}

// Recalculate the stored source (legacy scenarios without one: Option 2 when it
// has a usable survey, else Option 1 — the previous behaviour) and show its tab.
function trajApplySource(saved) {
  const t2rows = document.getElementById('traj2Body')?.rows.length || 0;
  let src = (saved === 'opt1' || saved === 'opt2') ? saved : (t2rows >= 2 ? 'opt2' : 'opt1');
  if (src === 'opt2' && t2rows < 2) src = 'opt1';
  qpState.trajSource = src;
  if (src === 'opt2') traj2Recalc(); else traj1Recalc();
  const tab = [...document.querySelectorAll('.opt-tab')].find(b => (b.getAttribute('onclick') || '').includes(`'${src}'`));
  if (typeof switchTrajOption === 'function') switchTrajOption(src, tab || null);
}

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
        <option value="hold">Hold</option>
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
    'hold':        ['md'],
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

  _traj2Save();
  const stations = traj2BuildStations(rows);
  if (stations.length < 2) return;
  _trajSetSource('opt2');           // a user edit here makes Option 2 the survey source

  const survey = computeSurvey(stations);
  qpState.baseSurvey = survey;
  qpState.survey = survey;

  survey.forEach((pt, i) => {
    const tr = body.rows[i];
    if (!tr) return;
    _setCell(tr, 'md2',  pt.md.toFixed(1));
    _setCell(tr, 'tvd2', pt.tvd.toFixed(1));
    _setCell(tr, 'dls2', (pt.dls * DLS_SCALE).toFixed(2));
    _setCell(tr, 'inc2', pt.inc.toFixed(2));   // shown when inc is a calc-cell (Hold)
    _setCell(tr, 'azi2', pt.az.toFixed(2));    // shown when azi is a calc-cell (Hold)
  });

  if (typeof drawSchematic === 'function') drawSchematic(survey);
}

function _traj2Save() {
  const tid = qpSaveTarget('traj2');
  if (!tid) return;
  const body = document.getElementById('traj2Body');
  const editableByMode = {
    'md_inc_azi':  ['md', 'inc', 'azi'],
    'inc_azi_tvd': ['inc', 'azi', 'tvd'],
    'inc_azi_dls': ['inc', 'azi', 'dls'],
    'hold':        ['md'],
  };
  const rows = [];
  for (const tr of body.rows) {
    const mode = tr.querySelector('select')?.value || 'md_inc_azi';
    const row  = { define: mode };
    (editableByMode[mode] || ['md', 'inc', 'azi']).forEach(f => {
      const input = tr.querySelector(`[data-field="${f}"] input`);
      row[f] = input?.value ?? '';
    });
    rows.push(row);
  }
  dbSaveScenarioData(tid, 'traj2', rows);
}

function traj2LoadRows(data) {
  const body = document.getElementById('traj2Body');
  body.innerHTML = '';
  (data || []).forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="drag-handle">⠿</td>
      <td class="editable">
        <select onchange="traj2ModeChange(this)">
          <option value="md_inc_azi">MD / Inc / Azi</option>
          <option value="inc_azi_tvd">Inc / Azi / TVD</option>
          <option value="inc_azi_dls">Inc / Azi / DLS</option>
          <option value="hold">Hold</option>
        </select>
      </td>
      <td data-field="md"  class="editable"><input type="number" step="1"    onchange="traj2Recalc()"></td>
      <td data-field="inc" class="editable"><input type="number" step="0.01" onchange="traj2Recalc()"></td>
      <td data-field="azi" class="editable"><input type="number" step="0.1"  onchange="traj2Recalc()"></td>
      <td data-field="tvd" class="calc-cell" data-col="tvd2">—</td>
      <td data-field="dls" class="calc-cell" data-col="dls2">—</td>
      <td class="row-act"><button onclick="this.closest('tr').remove();traj2Recalc()">✕</button></td>`;
    body.appendChild(tr);

    const sel = tr.querySelector('select');
    if (sel && row.define) {
      sel.value = row.define;
      _traj2UpdateCells(tr, row.define);
    }
    // Fill only the editable input fields for this mode
    ['md', 'inc', 'azi', 'tvd', 'dls'].forEach(f => {
      if (row[f] === undefined || row[f] === '') return;
      const input = tr.querySelector(`[data-field="${f}"] input`);
      if (input) input.value = row[f];
    });
  });
  traj2Recalc();
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
  // Always start from the planned (clean) survey so repeated recalcs don't stack tortuosity
  const base = (qpState.baseSurvey || qpState.survey || []);
  if (!base.length) return;

  const baseStations = base.map(s => ({ md: s.md, inc: s.inc, az: s.az || s.azimuth || 0 }));
  const applied = intervals.length ? applyTortuosity(baseStations, intervals) : baseStations;
  const survey  = computeSurvey(applied);

  // Store as effective survey so qpCompute() picks it up
  qpState.survey = survey;

  if (typeof drawSchematic === 'function') drawSchematic(survey);
  if (typeof qpCompute === 'function') qpCompute();

  tortSave();
}

function tortSave() {
  const tid = qpSaveTarget('tort');
  if (!tid) return;
  const rows = [];
  for (const tr of document.getElementById('tortBody').rows) {
    const inputs = tr.querySelectorAll('input[type=number]');
    const sel    = tr.querySelector('select');
    rows.push({
      startMD: inputs[0]?.value ?? 0,
      endMD:   inputs[1]?.value ?? 5000,
      tort:    inputs[2]?.value ?? 0.5,
      mode:    sel?.value ?? 'random',
    });
  }
  dbSaveScenarioData(tid, 'tort', rows);
}

function tortLoadState(data) {
  const body = document.getElementById('tortBody');
  body.innerHTML = '';
  (data || []).forEach(r => {
    tortAddRow();
    const tr     = body.rows[body.rows.length - 1];
    const inputs = tr.querySelectorAll('input[type=number]');
    const sel    = tr.querySelector('select');
    if (inputs[0]) inputs[0].value = r.startMD ?? 0;
    if (inputs[1]) inputs[1].value = r.endMD   ?? 5000;
    if (inputs[2]) inputs[2].value = r.tort    ?? 0.5;
    if (sel) sel.value = r.mode ?? 'random';
  });
}

// ── Well Schematic table ──────────────────────────────────────────────────────

function _schOdOptions() {
  return CATALOGUE_ODS.map(od =>
    `<option value="${od}">${od}"</option>`
  ).join('');
}

function _schWtOptions(od) {
  if (!od) return '';
  const unique = [...new Set(catalogueByOD(od).map(r => r[1]))];
  return unique.map(wt => `<option value="${wt}">${wt} lb/ft</option>`).join('');
}

function _schGradeOptions(od, wt) {
  if (!od || !wt) return '';
  return catalogueByOD(od)
    .filter(r => r[1] === +wt)
    .map(r => `<option value="${r[2]}">${r[2]}</option>`)
    .join('');
}

// Hole size column: the drilled hole the string is run in (inches, manual).
// Blank → inferred from the casing size (_qpHoleSizeFor, bit-for-casing table);
// Open Hole rows have no separate hole (their size IS the hole).
function _schHolePlaceholder(size) {
  const s = parseFloat(size);
  if (!(s > 0)) return '';
  return (typeof _qpHoleSizeFor === 'function') ? String(_qpHoleSizeFor(s)) : '';
}
function _schSyncHoleCell(tr) {
  const def  = tr.querySelector('select')?.value;
  const hole = tr.querySelector('.sch-hole');
  const size = tr.querySelector('.sch-size')?.value;
  if (!hole) return;
  const isOH = def === 'Open Hole';
  hole.disabled = isOH;
  hole.placeholder = isOH ? '= OD' : _schHolePlaceholder(size);
  if (isOH) hole.value = '';
}

function schematicAddRow(preset) {
  const body = document.getElementById('schematicBody');
  const tr   = document.createElement('tr');

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
        <option value="custom">Custom…</option>
      </select>
      <input type="text" class="sch-od-txt" placeholder="OD (in)"
        style="display:none;width:100%;margin-top:2px;box-sizing:border-box"
        oninput="_schOdCustomInput(this)">
    </td>
    <td class="editable" style="min-width:100px">
      <select class="sch-wt" onchange="_schWtChanged(this)" style="width:100%">
        <option value="">— Wt —</option>
        <option value="custom">Custom…</option>
      </select>
      <input type="text" class="sch-wt-txt" placeholder="lb/ft"
        style="display:none;width:100%;margin-top:2px;box-sizing:border-box"
        oninput="schematicSave()">
    </td>
    <td class="editable" style="min-width:90px">
      <select class="sch-grade" onchange="_schGradeChanged(this)" style="width:100%">
        <option value="">— Grade —</option>
        <option value="custom">Custom…</option>
      </select>
      <input type="text" class="sch-grade-txt" placeholder="Grade"
        style="display:none;width:100%;margin-top:2px;box-sizing:border-box"
        oninput="schematicSave()">
    </td>
    <td class="editable" style="min-width:60px">
      <input type="number" class="sch-size" step="0.125" value="${preset?.size ?? 13.375}"
        style="width:58px" onchange="schematicSave()">
    </td>
    <td class="editable" style="min-width:60px">
      <input type="number" class="sch-hole" step="0.125" min="0" placeholder="${_schHolePlaceholder(preset?.size ?? 13.375)}"
        title="Drilled hole size (in). Blank = inferred from the casing size."
        style="width:58px" value="${preset?.hole > 0 ? +preset.hole : ''}" onchange="schematicSave()">
    </td>
    <td class="editable"><input type="number" class="sch-top" step="1" value="${+QP_UNITS.toDisplay('depth', preset?.top ?? 0).toFixed(2)}" onchange="schematicSave()"></td>
    <td class="editable"><input type="number" class="sch-bot" step="1" value="${+QP_UNITS.toDisplay('depth', preset?.bot ?? 5000).toFixed(2)}" onchange="schematicSave()"></td>
    <td class="editable"><input type="number" class="sch-toc" step="1" min="0" placeholder="—"
      title="Top of cement (MD). Blank = not cemented / unknown."
      value="${(preset?.toc != null && preset.toc !== '') ? +QP_UNITS.toDisplay('depth', +preset.toc).toFixed(2) : ''}" onchange="schematicSave()"></td>
    <td class="row-act"><button onclick="this.closest('tr').remove();schematicSave()">✕</button></td>`;
  body.appendChild(tr);
  schematicSave();
}

function _schOdChanged(odSel) {
  const tr     = odSel.closest('tr');
  const wtSel  = tr.querySelector('.sch-wt');
  const grSel  = tr.querySelector('.sch-grade');
  const sizeIn = tr.querySelector('.sch-size');
  const odTxt  = tr.querySelector('.sch-od-txt');
  const wtTxt  = tr.querySelector('.sch-wt-txt');
  const grTxt  = tr.querySelector('.sch-grade-txt');
  const od     = odSel.value;

  if (od === 'custom') {
    odTxt.style.display = '';
    odTxt.focus();
    wtSel.innerHTML = '<option value="">— Wt —</option><option value="custom">Custom…</option>';
    wtSel.value = '';
    wtTxt.style.display = 'none';
    grSel.innerHTML = '<option value="">— Grade —</option><option value="custom">Custom…</option>';
    grSel.value = '';
    grTxt.style.display = 'none';
    _schStoreCatalogueSpec(tr, null);
    schematicSave();
    return;
  }

  odTxt.style.display = 'none';
  wtSel.innerHTML = `<option value="">— Wt —</option>${_schWtOptions(od)}<option value="custom">Custom…</option>`;
  wtSel.value = '';
  wtTxt.style.display = 'none';
  grSel.innerHTML = '<option value="">— Grade —</option><option value="custom">Custom…</option>';
  grSel.value = '';
  grTxt.style.display = 'none';

  if (od) sizeIn.value = _odToDecimal(od);
  _schSyncHoleCell(tr);
  _schStoreCatalogueSpec(tr, null);
  schematicSave();
}

function _schOdCustomInput(odTxt) {
  const tr     = odTxt.closest('tr');
  const sizeIn = tr.querySelector('.sch-size');
  const val    = parseFloat(odTxt.value);
  if (sizeIn && !isNaN(val)) sizeIn.value = val;
  schematicSave();
}

function _schWtChanged(wtSel) {
  const tr    = wtSel.closest('tr');
  const od    = tr.querySelector('.sch-od')?.value;
  const grSel = tr.querySelector('.sch-grade');
  const wtTxt = tr.querySelector('.sch-wt-txt');
  const grTxt = tr.querySelector('.sch-grade-txt');
  const wt    = wtSel.value;

  if (wt === 'custom') {
    wtTxt.style.display = '';
    wtTxt.focus();
    grSel.innerHTML = '<option value="">— Grade —</option><option value="custom">Custom…</option>';
    grSel.value = '';
    grTxt.style.display = 'none';
    _schStoreCatalogueSpec(tr, null);
    schematicSave();
    return;
  }

  wtTxt.style.display = 'none';
  grSel.innerHTML = `<option value="">— Grade —</option>${_schGradeOptions(od, wt)}<option value="custom">Custom…</option>`;
  grSel.value = '';
  grTxt.style.display = 'none';
  _schStoreCatalogueSpec(tr, null);
  schematicSave();
}

function _schGradeChanged(gradeSel) {
  const tr    = gradeSel.closest('tr');
  const od    = tr.querySelector('.sch-od')?.value;
  const wt    = tr.querySelector('.sch-wt')?.value;
  const grTxt = tr.querySelector('.sch-grade-txt');
  const grade = gradeSel.value;

  if (grade === 'custom') {
    grTxt.style.display = '';
    grTxt.focus();
    _schStoreCatalogueSpec(tr, null);
    schematicSave();
    return;
  }

  grTxt.style.display = 'none';
  if (!grade || !od || !wt || wt === 'custom') { _schStoreCatalogueSpec(tr, null); schematicSave(); return; }

  const spec = catalogueByOD(od).find(r => r[1] === +wt && r[2] === grade);
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
    schematicAddRow({ size: row.size, top: row.top, bot: row.bot, toc: row.toc, hole: row.hole });
    const tr     = body.rows[body.rows.length - 1];
    const selDef = tr.querySelector('select');
    const odSel  = tr.querySelector('.sch-od');
    const wtSel  = tr.querySelector('.sch-wt');
    const grSel  = tr.querySelector('.sch-grade');
    const sizeIn = tr.querySelector('.sch-size');
    const odTxt  = tr.querySelector('.sch-od-txt');
    const wtTxt  = tr.querySelector('.sch-wt-txt');
    const grTxt  = tr.querySelector('.sch-grade-txt');

    if (selDef) selDef.value = row.def  ?? 'Open Hole';
    if (sizeIn) sizeIn.value = row.size ?? 9.625;
    _schSyncHoleCell(tr);

    if (row.od && odSel) {
      odSel.value = row.od;

      if (row.od === 'custom') {
        if (odTxt) { odTxt.style.display = ''; odTxt.value = row.odCustom || ''; }
      } else {
        // Backward-compat: old data stored grade as "87.5_H-40" combined
        let savedWt    = row.wt    || '';
        let savedGrade = row.grade || '';
        if (!savedWt && savedGrade.includes('_')) {
          const i = savedGrade.indexOf('_');
          savedWt    = savedGrade.slice(0, i);
          savedGrade = savedGrade.slice(i + 1);
        }

        if (wtSel) {
          wtSel.innerHTML = `<option value="">— Wt —</option>${_schWtOptions(row.od)}<option value="custom">Custom…</option>`;
          if (savedWt === 'custom') {
            wtSel.value = 'custom';
            if (wtTxt) { wtTxt.style.display = ''; wtTxt.value = row.wtCustom || ''; }
          } else if (savedWt) {
            wtSel.value = savedWt;
            if (grSel) {
              grSel.innerHTML = `<option value="">— Grade —</option>${_schGradeOptions(row.od, savedWt)}<option value="custom">Custom…</option>`;
              if (savedGrade === 'custom') {
                grSel.value = 'custom';
                if (grTxt) { grTxt.style.display = ''; grTxt.value = row.gradeCustom || ''; }
              } else if (savedGrade) {
                grSel.value = savedGrade;
              }
            }
          }
        }
      }
    }
    if (row.casingSpec) {
      try { _schStoreCatalogueSpec(tr, JSON.parse(row.casingSpec)); } catch (_) {}
    }
  });
  // Re-save and re-validate with the fully-configured DOM (each schematicAddRow
  // above fires schematicSave while the definition select is still at its default
  // "Conductor", producing spurious warnings and corrupt DB state for the last row).
  if (typeof schematicSave === 'function') schematicSave();
  if (qpState.survey?.length > 1) drawSchematic(qpState.survey);
}

function schematicSave() {
  const tid = qpSaveTarget('schematic');
  if (!tid) return;
  const rows = [];
  for (const tr of document.getElementById('schematicBody').rows) {
    const selDef  = tr.querySelector('select');
    const odSel   = tr.querySelector('.sch-od');
    const wtSel   = tr.querySelector('.sch-wt');
    const grSel   = tr.querySelector('.sch-grade');
    const sizeIn  = tr.querySelector('.sch-size');
    const odTxt   = tr.querySelector('.sch-od-txt');
    const wtTxt   = tr.querySelector('.sch-wt-txt');
    const grTxt   = tr.querySelector('.sch-grade-txt');
    _schSyncHoleCell(tr);
    const topIn = tr.querySelector('.sch-top'), botIn = tr.querySelector('.sch-bot');
    const tocIn = tr.querySelector('.sch-toc'), holeIn = tr.querySelector('.sch-hole');
    rows.push({
      def:         selDef?.value,
      size:        sizeIn?.value,                        // OD stays inches
      // MD top/bot fields are display units → store imperial (canonical)
      top:         (topIn && topIn.value !== '') ? +QP_UNITS.fromDisplay('depth', +topIn.value).toFixed(4) : (topIn?.value ?? ''),
      bot:         (botIn && botIn.value !== '') ? +QP_UNITS.fromDisplay('depth', +botIn.value).toFixed(4) : (botIn?.value ?? ''),
      // Top of cement (MD, imperial) — additive key; '' = not cemented / unknown
      toc:         (tocIn && tocIn.value !== '') ? +QP_UNITS.fromDisplay('depth', +tocIn.value).toFixed(4) : '',
      // Drilled hole size (inches, manual) — additive key; '' = inferred from the casing size
      hole:        (holeIn && !holeIn.disabled && holeIn.value !== '') ? +holeIn.value : '',
      od:          odSel?.value  || '',
      odCustom:    odTxt?.value  || '',
      wt:          wtSel?.value  || '',
      wtCustom:    wtTxt?.value  || '',
      grade:       grSel?.value  || '',
      gradeCustom: grTxt?.value  || '',
      casingSpec:  tr.dataset.casingSpec || '',
    });
  }
  dbSaveScenarioData(tid, 'schematic', rows);
  if (typeof drawSchematic === 'function') drawSchematic(qpState.survey);
  if (typeof _schValidate === 'function') _schValidate();
  if (typeof syncCasingFromSchematic === 'function') syncCasingFromSchematic();
  // Sections changed → refresh the analysis-phase list + fluid-program rows
  if (typeof qpPhaseRebuildSelector === 'function') qpPhaseRebuildSelector();
  if (typeof fluidProgramSync === 'function') fluidProgramSync();
}
