// ===== BHA INPUT =====
// BHA components table, nozzle table (TFA), MWD pressure loss table

const BHA_PRESETS = {
  'Bit':         { od: 8.5,   id: 0,     wt: 50   },
  'PDM':         { od: 6.75,  id: 2.25,  wt: 1500 },
  'MWD':         { od: 6.5,   id: 2.25,  wt: 800  },
  'RSS':         { od: 6.75,  id: 2.25,  wt: 1200 },
  'Stabilizer':  { od: 8.375, id: 2.25,  wt: 400  },
  'HWDP':        { od: 5.0,   id: 3.0,   wt: 1600 },
  'Drill Collar':{ od: 6.5,   id: 2.25,  wt: 2976 },
  'Drill Pipe':  { od: 5.0,   id: 4.276, wt: 710  },
  'Casing':      { od: 9.625, id: 8.835, wt: 47   },
};

const BHA_GRADES = ['S-135', 'G-105', 'X-95', 'E-75'];

// ── Row HTML factory ──────────────────────────────────────────────────────────
// Layout: drag | Component | OD | Grade | Connection | ID | Weight | Length | PPF | CumWt | CumLen | del
// catOD    = catalogue OD string (e.g. "5" for DP/HWDP, "6 1/2" for DC)
// catGrade = grade string for DP, ID string for DC, "conv"/"spiral" for HWDP
// catConn  = connection string for DP/HWDP catalogue selects

function _makeBhaRowHTML(comp, od, id, wt, len, grade, conn,
                         catOD, catGrade, catConn) {
  const p    = BHA_PRESETS[comp] || BHA_PRESETS['Drill Collar'];
  const _od  = od   ?? p.od;
  const _id  = id   ?? p.id;
  const _wt  = wt   ?? p.wt;
  const _len = len  ?? 30;
  const _gr  = grade ?? 'S-135';
  const _conn = conn  ?? '';

  const typeOpts = Object.keys(BHA_PRESETS).map(k =>
    `<option${k === comp ? ' selected' : ''}>${k}</option>`).join('');

  const SS = 'style="display:block;width:100%;font-size:10px;padding:1px 2px;box-sizing:border-box"';
  const IS = 'style="width:100%;font-size:10px;padding:1px 2px;box-sizing:border-box"';

  const isDP   = comp === 'Drill Pipe';
  const isDC   = comp === 'Drill Collar';
  const isHWDP = comp === 'HWDP';

  const safeConn = String(_conn).replace(/"/g, '&quot;');

  // ── OD column ──────────────────────────────────────────────────────────────
  const CIS = 'style="width:100%;font-size:10px;margin-top:2px;box-sizing:border-box"';
  let odCell;
  if (isDP) {
    const isCustom = catOD === 'custom';
    const opts = dpODs().map(o =>
      `<option value="${o}"${o === catOD ? ' selected' : ''}>${o}"</option>`).join('');
    odCell = `<select class="bha-cat-od" ${SS} onchange="_bhaDPODChanged(this)">
        <option value="">OD…</option>${opts}
        <option value="custom"${isCustom ? ' selected' : ''}>Custom…</option></select>
      <input class="bha-od-custom" type="number" step="0.125" placeholder="OD (in)"
        value="${isCustom ? _od : ''}"
        style="${isCustom ? '' : 'display:none;'}width:100%;font-size:10px;margin-top:2px;box-sizing:border-box"
        oninput="_bhaOdCustomInput(this)">
      <input class="bha-od-n" type="hidden" value="${_od}">`;
  } else if (isDC) {
    const isCustom = catOD === 'custom';
    const opts = dcODs().map(o =>
      `<option value="${o}"${o === catOD ? ' selected' : ''}>${o}"</option>`).join('');
    odCell = `<select class="bha-cat-od" ${SS} onchange="_bhaDCODChanged(this)">
        <option value="">OD…</option>${opts}
        <option value="custom"${isCustom ? ' selected' : ''}>Custom…</option></select>
      <input class="bha-od-custom" type="number" step="0.125" placeholder="OD (in)"
        value="${isCustom ? _od : ''}"
        style="${isCustom ? '' : 'display:none;'}width:100%;font-size:10px;margin-top:2px;box-sizing:border-box"
        oninput="_bhaOdCustomInput(this)">
      <input class="bha-od-n" type="hidden" value="${_od}">`;
  } else if (isHWDP) {
    const isCustom = catOD === 'custom';
    const opts = hwdpNoms('conv').map(o =>
      `<option value="${o}"${o === catOD ? ' selected' : ''}>${o}"</option>`).join('');
    odCell = `<select class="bha-cat-od" ${SS} onchange="_bhaHWDPODChanged(this)">
        <option value="">OD…</option>${opts}
        <option value="custom"${isCustom ? ' selected' : ''}>Custom…</option></select>
      <input class="bha-od-custom" type="number" step="0.125" placeholder="OD (in)"
        value="${isCustom ? _od : ''}"
        style="${isCustom ? '' : 'display:none;'}width:100%;font-size:10px;margin-top:2px;box-sizing:border-box"
        oninput="_bhaOdCustomInput(this)">
      <input class="bha-od-n" type="hidden" value="${_od}">`;
  } else {
    odCell = `<input class="bha-od-n" type="number" step="0.125" value="${_od}" ${IS} onchange="bhaSave()">`;
  }

  // ── Grade column ───────────────────────────────────────────────────────────
  let gradeCell;
  if (isDP) {
    const grOpts = catOD
      ? dpGradesByOD(catOD).map(g =>
          `<option value="${g}"${g === catGrade ? ' selected' : ''}>${g}</option>`).join('')
      : '';
    gradeCell = `<select class="bha-cat-grade" ${SS} onchange="_bhaDPGradeChanged(this)">
        <option value="">Grade…</option>${grOpts}</select>`;
  } else if (isDC) {
    // Grade column shows DC bore IDs for the selected OD
    const idOpts = catOD
      ? dcIDsByOD(catOD).map(i =>
          `<option value="${i}"${i === catGrade ? ' selected' : ''}>${i}"</option>`).join('')
      : '';
    gradeCell = `<select class="bha-cat-grade" ${SS} onchange="_bhaDCIDChanged(this)">
        <option value="">ID…</option>${idOpts}</select>`;
  } else if (isHWDP) {
    const isSp = catGrade === 'spiral';
    gradeCell = `<select class="bha-cat-grade" ${SS} onchange="_bhaHWDPTypeChanged(this)">
        <option value="conv"${!isSp ? ' selected' : ''}>Conv</option>
        <option value="spiral"${isSp ? ' selected' : ''}>Spiral</option>
      </select>`;
  } else {
    const gradeOpts = BHA_GRADES.map(g =>
      `<option${g === _gr ? ' selected' : ''}>${g}</option>`).join('');
    gradeCell = `<select class="bha-grade" ${SS} onchange="bhaSave()">${gradeOpts}</select>`;
  }

  // ── Connection column ──────────────────────────────────────────────────────
  let connCell;
  if (isDP) {
    const connOpts = (catOD && catGrade)
      ? dpConnectionsByODGrade(catOD, catGrade).map(c =>
          `<option value="${c}"${c === catConn ? ' selected' : ''}>${c}</option>`).join('')
      : '';
    connCell = `<select class="bha-cat-conn" ${SS} onchange="_bhaDPConnChanged(this)">
        <option value="">Conn…</option>${connOpts}</select>
      <input class="bha-conn" type="hidden" value="${safeConn}">`;
  } else if (isHWDP) {
    const hwType = catGrade || 'conv';
    const connOpts = catOD
      ? hwdpConnectionsByNom(hwType, catOD).map(c =>
          `<option value="${c}"${c === catConn ? ' selected' : ''}>${c}</option>`).join('')
      : '';
    connCell = `<select class="bha-cat-conn" ${SS} onchange="_bhaHWDPConnChanged(this)">
        <option value="">Conn…</option>${connOpts}</select>
      <input class="bha-conn" type="hidden" value="${safeConn}">`;
  } else {
    // DC: readonly auto-filled text; others: editable text
    const ro = isDC ? 'readonly ' : '';
    const ph = isDC ? 'auto' : 'e.g. NC50';
    connCell = `<input class="bha-conn" type="text" value="${safeConn}"
        placeholder="${ph}" ${ro}${IS} onchange="bhaSave()">`;
  }

  return `
    <td class="drag-handle">⠿</td>
    <td class="editable"><select class="bha-type" onchange="bhaPresetFill(this)">${typeOpts}</select></td>
    <td class="editable">${odCell}</td>
    <td class="editable">${gradeCell}</td>
    <td class="editable">${connCell}</td>
    <td class="editable"><input class="bha-id-n" type="number" step="0.125" value="${_id}" onchange="bhaSave()"></td>
    <td class="editable"><input class="bha-wt-n" type="number" step="1"     value="${_wt}" onchange="bhaSave()"></td>
    <td class="editable"><input class="bha-len-n" type="number" step="1"    value="${_len}" onchange="bhaSave()"></td>
    <td class="calc-cell" data-col="ppf">—</td>
    <td class="calc-cell" data-col="cumwt">—</td>
    <td class="calc-cell" data-col="cumlen">—</td>
    <td class="row-act"><button onclick="this.closest('tr').remove();bhaSave()">✕</button></td>`;
}

// ── BHA table ─────────────────────────────────────────────────────────────────

function bhaAddRow(preset) {
  const body = document.getElementById('bhaBody');
  const comp = preset || 'Drill Collar';
  const tr   = document.createElement('tr');
  tr.innerHTML = _makeBhaRowHTML(comp);
  body.appendChild(tr);
  bhaSave();
}

function bhaPresetFill(sel) {
  const row = sel.closest('tr');
  const len = row.querySelector('.bha-len-n')?.value;
  row.innerHTML = _makeBhaRowHTML(sel.value, null, null, null, len);
  bhaSave();
}

// ── Catalogue change handlers ──────────────────────────────────────────────────

// Drill Pipe — OD changed → repopulate Grade, clear Connection
function _bhaDPODChanged(sel) {
  const tr       = sel.closest('tr');
  const od       = sel.value;
  const odN      = tr.querySelector('.bha-od-n');
  const odCustom = tr.querySelector('.bha-od-custom');

  if (od === 'custom') {
    if (odCustom) { odCustom.style.display = ''; odCustom.focus(); }
    const grSel = tr.querySelector('.bha-cat-grade');
    if (grSel) { grSel.innerHTML = '<option value="">Grade…</option>'; grSel.value = ''; }
    const connSel = tr.querySelector('.bha-cat-conn');
    if (connSel) { connSel.innerHTML = '<option value="">Conn…</option>'; connSel.value = ''; }
    bhaSave();
    return;
  }

  if (odCustom) odCustom.style.display = 'none';
  if (odN) odN.value = od ? _bhaFracToDecimal(od) : '';

  const grSel = tr.querySelector('.bha-cat-grade');
  if (grSel) {
    const grades = od ? dpGradesByOD(od) : [];
    grSel.innerHTML = `<option value="">Grade…</option>` +
      grades.map(g => `<option value="${g}">${g}</option>`).join('');
    grSel.value = '';
  }
  const connSel = tr.querySelector('.bha-cat-conn');
  if (connSel) { connSel.innerHTML = '<option value="">Conn…</option>'; connSel.value = ''; }
  bhaSave();
}

function _bhaOdCustomInput(input) {
  const tr  = input.closest('tr');
  const odN = tr.querySelector('.bha-od-n');
  if (odN) odN.value = input.value;
  bhaSave();
}

// Drill Pipe — Grade changed → repopulate Connection
function _bhaDPGradeChanged(sel) {
  const tr    = sel.closest('tr');
  const od    = tr.querySelector('.bha-cat-od')?.value;
  const grade = sel.value;
  const connSel = tr.querySelector('.bha-cat-conn');
  if (connSel) {
    const conns = (od && grade) ? dpConnectionsByODGrade(od, grade) : [];
    connSel.innerHTML = `<option value="">Conn…</option>` +
      conns.map(c => `<option value="${c}">${c}</option>`).join('');
    connSel.value = '';
  }
  bhaSave();
}

// Drill Pipe — Connection chosen → auto-fill ID, Weight, hidden conn
function _bhaDPConnChanged(sel) {
  const tr    = sel.closest('tr');
  const od    = tr.querySelector('.bha-cat-od')?.value;
  const grade = tr.querySelector('.bha-cat-grade')?.value;
  const conn  = sel.value;
  if (!od || !grade || !conn) return;
  const spec = dpSpecFull(od, grade, conn);
  if (!spec) return;
  const lenN  = tr.querySelector('.bha-len-n');
  const idN   = tr.querySelector('.bha-id-n');
  const wtN   = tr.querySelector('.bha-wt-n');
  const connH = tr.querySelector('.bha-conn');
  if (idN)   idN.value   = spec.tubeID;
  if (wtN)   wtN.value   = Math.round(spec.adjWt * (+(lenN?.value || 30)));
  if (connH) connH.value = spec.conn;
  bhaSave();
}

// Drill Collar — OD chosen → repopulate Grade/ID select, clear conn
function _bhaDCODChanged(sel) {
  const tr       = sel.closest('tr');
  const od       = sel.value;
  const odN      = tr.querySelector('.bha-od-n');
  const odCustom = tr.querySelector('.bha-od-custom');

  if (od === 'custom') {
    if (odCustom) { odCustom.style.display = ''; odCustom.focus(); }
    const grSel = tr.querySelector('.bha-cat-grade');
    if (grSel) { grSel.innerHTML = '<option value="">ID…</option>'; grSel.value = ''; }
    const connEl = tr.querySelector('.bha-conn');
    if (connEl) connEl.value = '';
    bhaSave();
    return;
  }

  if (odCustom) odCustom.style.display = 'none';
  if (odN) odN.value = od ? _bhaFracToDecimal(od) : '';

  const grSel = tr.querySelector('.bha-cat-grade');
  if (grSel) {
    const ids = od ? dcIDsByOD(od) : [];
    grSel.innerHTML = `<option value="">ID…</option>` +
      ids.map(i => `<option value="${i}">${i}"</option>`).join('');
    grSel.value = '';
  }
  const connEl = tr.querySelector('.bha-conn');
  if (connEl) connEl.value = '';
  bhaSave();
}

// Drill Collar — ID chosen → auto-fill numeric ID, Weight, conn text
function _bhaDCIDChanged(sel) {
  const tr  = sel.closest('tr');
  const od  = tr.querySelector('.bha-cat-od')?.value;
  const bid = sel.value;
  if (!od || !bid) return;
  const spec = dcSpec(od, bid);
  if (!spec) return;
  const lenN   = tr.querySelector('.bha-len-n');
  const idN    = tr.querySelector('.bha-id-n');
  const wtN    = tr.querySelector('.bha-wt-n');
  const connEl = tr.querySelector('.bha-conn');
  if (idN)    idN.value    = spec.id_in;
  if (wtN)    wtN.value    = Math.round(spec.unitWt * (+(lenN?.value || 30)));
  if (connEl) connEl.value = spec.conn;
  bhaSave();
}

// HWDP — OD / nom changed → repopulate Connection, update hidden OD
function _bhaHWDPODChanged(sel) {
  const tr       = sel.closest('tr');
  const nom      = sel.value;
  const odN      = tr.querySelector('.bha-od-n');
  const odCustom = tr.querySelector('.bha-od-custom');

  if (nom === 'custom') {
    if (odCustom) { odCustom.style.display = ''; odCustom.focus(); }
    const connSel = tr.querySelector('.bha-cat-conn');
    if (connSel) { connSel.innerHTML = '<option value="">Conn…</option>'; connSel.value = ''; }
    bhaSave();
    return;
  }

  if (odCustom) odCustom.style.display = 'none';
  if (odN) odN.value = nom ? _bhaFracToDecimal(nom) : '';
  const type    = tr.querySelector('.bha-cat-grade')?.value || 'conv';
  const connSel = tr.querySelector('.bha-cat-conn');
  if (connSel) {
    const conns = nom ? hwdpConnectionsByNom(type, nom) : [];
    connSel.innerHTML = `<option value="">Conn…</option>` +
      conns.map(c => `<option value="${c}">${c}</option>`).join('');
    connSel.value = '';
  }
  bhaSave();
}

// HWDP — Conv/Spiral toggle → repopulate Connection
function _bhaHWDPTypeChanged(sel) {
  const tr      = sel.closest('tr');
  const type    = sel.value;
  const nom     = tr.querySelector('.bha-cat-od')?.value;
  const connSel = tr.querySelector('.bha-cat-conn');
  if (connSel) {
    const conns = nom ? hwdpConnectionsByNom(type, nom) : [];
    connSel.innerHTML = `<option value="">Conn…</option>` +
      conns.map(c => `<option value="${c}">${c}</option>`).join('');
    connSel.value = '';
  }
  bhaSave();
}

// HWDP — Connection chosen → auto-fill ID, Weight, hidden conn
function _bhaHWDPConnChanged(sel) {
  const tr   = sel.closest('tr');
  const nom  = tr.querySelector('.bha-cat-od')?.value;
  const type = tr.querySelector('.bha-cat-grade')?.value || 'conv';
  const conn = sel.value;
  if (!nom || !conn) return;
  const spec = hwdpSpec(type, nom, conn);
  if (!spec) return;
  const odN   = tr.querySelector('.bha-od-n');
  const idN   = tr.querySelector('.bha-id-n');
  const wtN   = tr.querySelector('.bha-wt-n');
  const lenN  = tr.querySelector('.bha-len-n');
  const connH = tr.querySelector('.bha-conn');
  if (odN)   odN.value   = spec.od_in;
  if (idN)   idN.value   = spec.id_in;
  if (wtN)   wtN.value   = Math.round(spec.pf * (+(lenN?.value || 30)));
  if (connH) connH.value = spec.conn;
  bhaSave();
}

// ── Recalculate PPF and cumulative weight/length ────────────────────────────────

function _bhaRecalc() {
  const rows = [...document.getElementById('bhaBody').rows];

  const data = rows.map(tr => {
    const wt  = +(tr.querySelector('.bha-wt-n')?.value  || 0);
    const len = +(tr.querySelector('.bha-len-n')?.value || 1);
    return { tr, wt, len, ppf: len > 0 ? wt / len : 0, cumWt: 0, cumLen: 0 };
  });

  let cumWt = 0, cumLen = 0;
  for (let i = data.length - 1; i >= 0; i--) {
    cumWt  += data[i].wt;
    cumLen += data[i].len;
    data[i].cumWt  = cumWt;
    data[i].cumLen = cumLen;
  }

  data.forEach(({ tr, ppf, cumWt, cumLen }) => {
    const ppfCell    = tr.querySelector('[data-col="ppf"]');
    const cumWtCell  = tr.querySelector('[data-col="cumwt"]');
    const cumLenCell = tr.querySelector('[data-col="cumlen"]');
    if (ppfCell)    ppfCell.textContent    = ppf.toFixed(2);
    if (cumWtCell)  cumWtCell.textContent  = Math.round(cumWt).toLocaleString();
    if (cumLenCell) cumLenCell.textContent = Math.round(cumLen).toLocaleString();
  });
}

function bhaLoadState(data) {
  const body = document.getElementById('bhaBody');
  body.innerHTML = '';
  (data || []).forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = _makeBhaRowHTML(
      row.comp, row.od, row.id, row.wt, row.len,
      row.grade, row.conn,
      row.catOD, row.catGrade, row.catConn
    );
    body.appendChild(tr);
  });
  bhaSave();
}

function bhaSave() {
  _bhaRecalc();
  if (!qpState.currentScenarioId) return;
  const rows = [];
  for (const tr of document.getElementById('bhaBody').rows) {
    rows.push({
      comp:     tr.querySelector('.bha-type')?.value       || '',
      od:       tr.querySelector('.bha-od-n')?.value       || '',
      id:       tr.querySelector('.bha-id-n')?.value       || '',
      wt:       tr.querySelector('.bha-wt-n')?.value       || '',
      len:      tr.querySelector('.bha-len-n')?.value      || '',
      grade:    tr.querySelector('.bha-grade')?.value      || '',
      conn:     tr.querySelector('.bha-conn')?.value       || tr.querySelector('.bha-cat-conn')?.value || '',
      catOD:    tr.querySelector('.bha-cat-od')?.value     || '',
      catGrade: tr.querySelector('.bha-cat-grade')?.value  || '',
      catConn:  tr.querySelector('.bha-cat-conn')?.value   || '',
    });
  }
  dbSaveScenarioData(qpState.currentScenarioId, 'bha', rows);
}

// ── Build BHA summary object (used by compute-engine) ────────────────────────

function bhaGet() {
  const rows = [];
  for (const tr of document.getElementById('bhaBody').rows) {
    const comp     = tr.querySelector('.bha-type')?.value || 'Drill Collar';
    const catODSel = tr.querySelector('.bha-cat-od');
    const odN      = tr.querySelector('.bha-od-n');
    const odVal    = catODSel?.value
      ? _bhaFracToDecimal(catODSel.value)
      : +(odN?.value || 6.5);
    rows.push({
      type:      comp,
      od:        odVal,
      id:        +(tr.querySelector('.bha-id-n')?.value  || 2.25),
      weightLbs: +(tr.querySelector('.bha-wt-n')?.value  || 0),
      lengthFt:  +(tr.querySelector('.bha-len-n')?.value || 30),
      grade:     tr.querySelector('.bha-grade')?.value
               || tr.querySelector('.bha-cat-grade')?.value || 'S-135',
      conn:      tr.querySelector('.bha-conn')?.value
               || tr.querySelector('.bha-cat-conn')?.value  || '',
    });
  }

  const tfa = nozzleRecalc();
  const mwdDrop = (() => {
    let t = 0;
    for (const tr of document.getElementById('mwdBody').rows) {
      const inp = tr.querySelectorAll('input[type=number]')[0];
      t += +(inp?.value || 0);
    }
    return t;
  })();

  const dpRow = rows.find(r => r.type === 'Drill Pipe') || rows[0];
  const bit   = rows.find(r => r.type === 'Bit');

  return {
    components:    rows,
    topDpOD_in:    dpRow?.od    ?? 5.0,
    topDpID_in:    dpRow?.id    ?? 4.276,
    bitOD_in:      bit?.od      ?? 8.5,
    tfa_in2:       tfa,
    mwdDeltaP_psi: mwdDrop,
  };
}

// ── Nozzle table + TFA ────────────────────────────────────────────────────────

function nozzleAddRow() {
  const body = document.getElementById('nozzleBody');
  const tr   = document.createElement('tr');
  tr.innerHTML = `
    <td class="drag-handle">⠿</td>
    <td class="editable"><input type="number" step="1" value="12" onchange="nozzleRecalc()"></td>
    <td class="editable"><input type="number" step="1" value="3"  onchange="nozzleRecalc()"></td>
    <td class="row-act"><button onclick="this.closest('tr').remove();nozzleRecalc()">✕</button></td>`;
  body.appendChild(tr);
  nozzleRecalc();
}

function nozzleRecalc() {
  let tfa = 0;
  for (const tr of document.getElementById('nozzleBody').rows) {
    const inputs = tr.querySelectorAll('input[type=number]');
    const size  = +(inputs[0]?.value || 0);
    const count = +(inputs[1]?.value || 0);
    const r_in  = size / 64;
    tfa += count * Math.PI * r_in * r_in;
  }
  const el = document.getElementById('tfaDisplay');
  if (el) el.textContent = tfa.toFixed(4) + ' in²';
  nozzleSave();
  return tfa;
}

function nozzleSave() {
  if (!qpState.currentScenarioId) return;
  const rows = [];
  for (const tr of document.getElementById('nozzleBody').rows) {
    const inputs = tr.querySelectorAll('input[type=number]');
    rows.push({ size: inputs[0]?.value, count: inputs[1]?.value });
  }
  dbSaveScenarioData(qpState.currentScenarioId, 'nozzles', rows);
}

function nozzleLoadState(data) {
  const body = document.getElementById('nozzleBody');
  body.innerHTML = '';
  (data || []).forEach(row => {
    nozzleAddRow();
    const tr     = body.rows[body.rows.length - 1];
    const inputs = tr.querySelectorAll('input[type=number]');
    if (inputs[0]) inputs[0].value = row.size  ?? 12;
    if (inputs[1]) inputs[1].value = row.count ?? 3;
  });
  nozzleRecalc();
}

// ── MWD table total ───────────────────────────────────────────────────────────

function mwdTableChange() {
  let total = 0;
  for (const tr of document.getElementById('mwdBody').rows) {
    const input = tr.querySelectorAll('input[type=number]')[0];
    total += +(input?.value || 0);
  }
  const el = document.getElementById('mwdTotalDisplay');
  if (el) el.textContent = total.toLocaleString() + ' psi';
}

// ── Init: seed a minimal BHA on first load ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('bhaBody').rows.length) {
    bhaAddRow('Bit');
    bhaAddRow('PDM');
    bhaAddRow('MWD');
    bhaAddRow('HWDP');
    bhaAddRow('Drill Pipe');
  }
  if (!document.getElementById('nozzleBody').rows.length) {
    nozzleAddRow();
  }
  mwdTableChange();
});
