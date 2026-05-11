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

// ── Catalogue cell HTML builders ───────────────────────────────────────────────

function _bhaCatCellHTML(compType) {
  const W = 'style="width:100%;font-size:10px;padding:1px 2px;box-sizing:border-box"';
  const wrap = 'style="display:flex;flex-direction:column;gap:2px;width:110px"';

  if (compType === 'Drill Pipe') {
    const odOpts = dpODs().map(od => `<option value="${od}">${od}"</option>`).join('');
    return `<div ${wrap}>
      <select class="bha-cat-od" ${W} onchange="_bhaDPODChanged(this)">
        <option value="">OD…</option>${odOpts}
      </select>
      <select class="bha-cat-conn" ${W} onchange="_bhaDPConnChanged(this)">
        <option value="">Conn…</option>
      </select>
    </div>`;
  }
  if (compType === 'Drill Collar') {
    const odOpts = dcODs().map(od => `<option value="${od}">${od}"</option>`).join('');
    return `<div ${wrap}>
      <select class="bha-cat-od" ${W} onchange="_bhaDCODChanged(this)">
        <option value="">OD…</option>${odOpts}
      </select>
      <select class="bha-cat-id" ${W} onchange="_bhaDCIDChanged(this)">
        <option value="">ID…</option>
      </select>
    </div>`;
  }
  if (compType === 'HWDP') {
    const nomOpts = hwdpNoms('conv').map(n => `<option value="${n}">${n}"</option>`).join('');
    return `<div ${wrap}>
      <select class="bha-cat-type" ${W} onchange="_bhaHWDPTypeChanged(this)">
        <option value="conv">Conv</option>
        <option value="spiral">Spiral</option>
      </select>
      <select class="bha-cat-od" ${W} onchange="_bhaHWDPODChanged(this)">
        <option value="">Nom…</option>${nomOpts}
      </select>
      <select class="bha-cat-conn" ${W} onchange="_bhaHWDPConnChanged(this)">
        <option value="">Conn…</option>
      </select>
    </div>`;
  }
  return '';
}

function _bhaRebuildCatCell(tr, compType) {
  const td = tr.querySelector('.bha-cat-td');
  if (td) td.innerHTML = _bhaCatCellHTML(compType);
}

// ── BHA table ─────────────────────────────────────────────────────────────────

function bhaAddRow(preset) {
  const body = document.getElementById('bhaBody');
  const p    = BHA_PRESETS[preset] || BHA_PRESETS['Drill Collar'];
  const comp = preset || 'Drill Collar';

  const gradeOpts = BHA_GRADES.map(g => `<option>${g}</option>`).join('');

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="drag-handle">⠿</td>
    <td class="editable">
      <select class="bha-type" onchange="bhaPresetFill(this)">
        ${Object.keys(BHA_PRESETS).map(k =>
          `<option${k === comp ? ' selected' : ''}>${k}</option>`).join('')}
      </select>
    </td>
    <td class="bha-cat-td">${_bhaCatCellHTML(comp)}</td>
    <td class="editable"><input type="number" step="0.125" value="${p.od}"  onchange="bhaSave()"></td>
    <td class="editable"><input type="number" step="0.125" value="${p.id}"  onchange="bhaSave()"></td>
    <td class="editable"><input type="number" step="1"     value="${p.wt}"  onchange="bhaSave()"></td>
    <td class="editable"><input type="number" step="1"     value="30"       onchange="bhaSave()"></td>
    <td class="calc-cell" data-col="ppf">—</td>
    <td class="editable"><select class="bha-grade" onchange="bhaSave()">${gradeOpts}</select></td>
    <td class="editable"><input class="bha-conn" type="text" value="" placeholder="e.g. NC50" onchange="bhaSave()"></td>
    <td class="calc-cell" data-col="cumwt">—</td>
    <td class="calc-cell" data-col="cumlen">—</td>
    <td class="row-act"><button onclick="this.closest('tr').remove();bhaSave()">✕</button></td>`;
  body.appendChild(tr);
  bhaSave();
}

function bhaPresetFill(sel) {
  const p = BHA_PRESETS[sel.value];
  if (!p) return;
  const row    = sel.closest('tr');
  const inputs = row.querySelectorAll('input[type=number]');
  inputs[0].value = p.od;
  inputs[1].value = p.id;
  inputs[2].value = p.wt;
  _bhaRebuildCatCell(row, sel.value);
  bhaSave();
}

// ── Catalogue change handlers ──────────────────────────────────────────────────

function _bhaDPODChanged(sel, doFill) {
  const tr      = sel.closest('tr');
  const connSel = tr.querySelector('.bha-cat-conn');
  if (!connSel) return;
  const od    = sel.value;
  const conns = od ? dpConnectionsByOD(od) : [];
  connSel.innerHTML = `<option value="">Conn…</option>` +
    conns.map(c => `<option value="${c}">${c}</option>`).join('');
  connSel.value = '';
  if (doFill !== false && od) {
    const nums = tr.querySelectorAll('input[type=number]');
    nums[0].value = _bhaFracToDecimal(od);
    bhaSave();
  }
}

function _bhaDPConnChanged(sel) {
  const tr   = sel.closest('tr');
  const od   = tr.querySelector('.bha-cat-od')?.value;
  const conn = sel.value;
  if (!od || !conn) return;
  const spec = dpSpec(od, conn);
  if (!spec) return;
  const nums  = tr.querySelectorAll('input[type=number]');
  const grSel = tr.querySelector('.bha-grade');
  const cText = tr.querySelector('.bha-conn');
  nums[0].value = spec.od_in;
  nums[1].value = spec.tubeID;
  const len = +(nums[3]?.value || 30);
  nums[2].value = Math.round(spec.adjWt * len);
  if (grSel) grSel.value = spec.grade;
  if (cText) cText.value = spec.conn;
  bhaSave();
}

function _bhaDCODChanged(sel, doFill) {
  const tr    = sel.closest('tr');
  const idSel = tr.querySelector('.bha-cat-id');
  if (!idSel) return;
  const od  = sel.value;
  const ids = od ? dcIDsByOD(od) : [];
  idSel.innerHTML = `<option value="">ID…</option>` +
    ids.map(id => `<option value="${id}">${id}"</option>`).join('');
  idSel.value = '';
  if (doFill !== false && od) {
    const nums = tr.querySelectorAll('input[type=number]');
    nums[0].value = _bhaFracToDecimal(od);
    bhaSave();
  }
}

function _bhaDCIDChanged(sel) {
  const tr   = sel.closest('tr');
  const od   = tr.querySelector('.bha-cat-od')?.value;
  const id   = sel.value;
  if (!od || !id) return;
  const spec = dcSpec(od, id);
  if (!spec) return;
  const nums  = tr.querySelectorAll('input[type=number]');
  const cText = tr.querySelector('.bha-conn');
  nums[0].value = spec.od_in;
  nums[1].value = spec.id_in;
  const len = +(nums[3]?.value || 30);
  nums[2].value = Math.round(spec.unitWt * len);
  if (cText) cText.value = spec.conn;
  bhaSave();
}

function _bhaHWDPTypeChanged(sel, doFill) {
  const tr      = sel.closest('tr');
  const type    = sel.value;
  const odSel   = tr.querySelector('.bha-cat-od');
  const connSel = tr.querySelector('.bha-cat-conn');
  if (!odSel) return;
  const noms = hwdpNoms(type);
  odSel.innerHTML = `<option value="">Nom…</option>` +
    noms.map(n => `<option value="${n}">${n}"</option>`).join('');
  odSel.value = '';
  if (connSel) { connSel.innerHTML = `<option value="">Conn…</option>`; connSel.value = ''; }
}

function _bhaHWDPODChanged(sel, doFill) {
  const tr      = sel.closest('tr');
  const type    = tr.querySelector('.bha-cat-type')?.value || 'conv';
  const nom     = sel.value;
  const connSel = tr.querySelector('.bha-cat-conn');
  if (!connSel) return;
  const conns = nom ? hwdpConnectionsByNom(type, nom) : [];
  connSel.innerHTML = `<option value="">Conn…</option>` +
    conns.map(c => `<option value="${c}">${c}</option>`).join('');
  connSel.value = '';
  if (doFill !== false && nom) {
    const nums = tr.querySelectorAll('input[type=number]');
    nums[0].value = _bhaFracToDecimal(nom);
    bhaSave();
  }
}

function _bhaHWDPConnChanged(sel) {
  const tr   = sel.closest('tr');
  const type = tr.querySelector('.bha-cat-type')?.value || 'conv';
  const nom  = tr.querySelector('.bha-cat-od')?.value;
  const conn = sel.value;
  if (!nom || !conn) return;
  const spec = hwdpSpec(type, nom, conn);
  if (!spec) return;
  const nums  = tr.querySelectorAll('input[type=number]');
  const cText = tr.querySelector('.bha-conn');
  nums[0].value = spec.od_in;
  nums[1].value = spec.id_in;
  const len = +(nums[3]?.value || 30);
  nums[2].value = Math.round(spec.pf * len);
  if (cText) cText.value = spec.conn;
  bhaSave();
}

// ── Recalculate PPF and cumulative weight/length ────────────────────────────────

function _bhaRecalc() {
  const rows = [...document.getElementById('bhaBody').rows];

  const data = rows.map(tr => {
    const nums = tr.querySelectorAll('input[type=number]');
    const wt   = +(nums[2]?.value || 0);
    const len  = +(nums[3]?.value || 1);
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
    bhaAddRow(row.comp);
    const last  = body.rows[body.rows.length - 1];
    const nums  = last.querySelectorAll('input[type=number]');
    if (nums[0]) nums[0].value = row.od    ?? nums[0].value;
    if (nums[1]) nums[1].value = row.id    ?? nums[1].value;
    if (nums[2]) nums[2].value = row.wt    ?? nums[2].value;
    if (nums[3]) nums[3].value = row.len   ?? nums[3].value;
    const grSel = last.querySelector('.bha-grade');
    const cText = last.querySelector('.bha-conn');
    if (grSel && row.grade) grSel.value = row.grade;
    if (cText && row.conn !== undefined) cText.value = row.conn;

    // Restore catalogue selections without triggering auto-fill of numbers
    const comp = row.comp;
    if (comp === 'Drill Pipe' && row.catOD) {
      const catODSel   = last.querySelector('.bha-cat-od');
      const catConnSel = last.querySelector('.bha-cat-conn');
      if (catODSel) {
        catODSel.value = row.catOD;
        _bhaDPODChanged(catODSel, false);
        if (catConnSel && row.catConn) catConnSel.value = row.catConn;
      }
    } else if (comp === 'Drill Collar' && row.catOD) {
      const catODSel = last.querySelector('.bha-cat-od');
      const catIDSel = last.querySelector('.bha-cat-id');
      if (catODSel) {
        catODSel.value = row.catOD;
        _bhaDCODChanged(catODSel, false);
        if (catIDSel && row.catID) catIDSel.value = row.catID;
      }
    } else if (comp === 'HWDP' && row.catOD) {
      const catTypeSel = last.querySelector('.bha-cat-type');
      const catODSel   = last.querySelector('.bha-cat-od');
      const catConnSel = last.querySelector('.bha-cat-conn');
      if (catTypeSel && row.catType) catTypeSel.value = row.catType;
      if (catTypeSel) _bhaHWDPTypeChanged(catTypeSel, false);
      if (catODSel) {
        catODSel.value = row.catOD;
        _bhaHWDPODChanged(catODSel, false);
        if (catConnSel && row.catConn) catConnSel.value = row.catConn;
      }
    }
  });
  bhaSave();
}

function bhaSave() {
  _bhaRecalc();
  if (!qpState.currentScenarioId) return;
  const rows = [];
  for (const tr of document.getElementById('bhaBody').rows) {
    const nums = tr.querySelectorAll('input[type=number]');
    rows.push({
      comp:    tr.querySelector('.bha-type')?.value,
      od:      nums[0]?.value,
      id:      nums[1]?.value,
      wt:      nums[2]?.value,
      len:     nums[3]?.value,
      grade:   tr.querySelector('.bha-grade')?.value,
      conn:    tr.querySelector('.bha-conn')?.value,
      catType: tr.querySelector('.bha-cat-type')?.value  || '',
      catOD:   tr.querySelector('.bha-cat-od')?.value    || '',
      catConn: tr.querySelector('.bha-cat-conn')?.value  || '',
      catID:   tr.querySelector('.bha-cat-id')?.value    || '',
    });
  }
  dbSaveScenarioData(qpState.currentScenarioId, 'bha', rows);
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
    const size  = +(inputs[0]?.value || 0);   // 1/32"
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

// ── Build BHA summary object (used by compute-engine) ────────────────────────

function bhaGet() {
  const rows = [];
  for (const tr of document.getElementById('bhaBody').rows) {
    const nums = tr.querySelectorAll('input[type=number]');
    rows.push({
      type:       tr.querySelector('.bha-type')?.value || 'Drill Collar',
      od:         +(nums[0]?.value || 6.5),
      id:         +(nums[1]?.value || 2.25),
      weightLbs:  +(nums[2]?.value || 2050),
      lengthFt:   +(nums[3]?.value || 30),
      grade:      tr.querySelector('.bha-grade')?.value || 'S-135',
      conn:       tr.querySelector('.bha-conn')?.value || '',
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
