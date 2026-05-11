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
// Catalogue controls are embedded directly in Component / OD / Connection cells.

function _hwdpSpecOptions(type) {
  const arr = type === 'spiral' ? HWDP_SPIRAL : HWDP_CONV;
  return arr.flatMap(e => e.connections.map(c =>
    `<option value="${e.nom}|${c.conn}">${e.nom}" · ${c.conn} (${c.pf} lb/ft)</option>`
  )).join('');
}

function _makeBhaRowHTML(comp, od, id, wt, len, grade, conn) {
  const p  = BHA_PRESETS[comp] || BHA_PRESETS['Drill Collar'];
  const _od   = od   ?? p.od;
  const _id   = id   ?? p.id;
  const _wt   = wt   ?? p.wt;
  const _len  = len  ?? 30;
  const _gr   = grade ?? 'S-135';
  const _conn = conn  ?? '';

  const gradeOpts = BHA_GRADES.map(g =>
    `<option${g === _gr ? ' selected' : ''}>${g}</option>`).join('');
  const typeOpts = Object.keys(BHA_PRESETS).map(k =>
    `<option${k === comp ? ' selected' : ''}>${k}</option>`).join('');

  const CS = 'style="display:block;width:100%;font-size:10px;padding:1px 2px;box-sizing:border-box;margin-bottom:3px"';

  // ── Component cell extras (DC and HWDP catalogue pickers) ──
  let compCat = '';
  if (comp === 'Drill Collar') {
    const dcOpts = DC_CATALOGUE.map((r, i) =>
      `<option value="${i}">${r[0]}" × ${r[1]}" · ${r[3]} lb/ft</option>`
    ).join('');
    compCat = `<select class="bha-cat-dc" ${CS} onchange="_bhaDCChanged(this)">
      <option value="">Catalogue…</option>${dcOpts}</select>`;
  } else if (comp === 'HWDP') {
    compCat = `<select class="bha-cat-type" ${CS} onchange="_bhaHWDPTypeChanged(this)">
        <option value="conv">Conv HWDP</option>
        <option value="spiral">Spiral HWDP</option>
      </select>
      <select class="bha-cat-spec" ${CS} onchange="_bhaHWDPSpecChanged(this)">
        <option value="">Spec…</option>${_hwdpSpecOptions('conv')}</select>`;
  }

  // ── OD cell: catalogue OD picker for Drill Pipe ──
  const odCat = comp === 'Drill Pipe'
    ? `<select class="bha-cat-od" ${CS} onchange="_bhaDPODChanged(this)">
        <option value="">OD…</option>
        ${dpODs().map(o => `<option value="${o}">${o}"</option>`).join('')}
      </select>`
    : '';

  // ── Connection cell: catalogue conn picker for Drill Pipe ──
  const connCat = comp === 'Drill Pipe'
    ? `<select class="bha-cat-conn" ${CS} onchange="_bhaDPConnChanged(this)">
        <option value="">Conn…</option>
      </select>`
    : '';

  const safeConn = String(_conn).replace(/"/g, '&quot;');

  return `
    <td class="drag-handle">⠿</td>
    <td class="editable" style="vertical-align:top">
      <select class="bha-type" onchange="bhaPresetFill(this)">${typeOpts}</select>
      ${compCat}
    </td>
    <td class="editable" style="vertical-align:top">
      ${odCat}
      <input type="number" step="0.125" value="${_od}" onchange="bhaSave()">
    </td>
    <td class="editable"><input type="number" step="0.125" value="${_id}"  onchange="bhaSave()"></td>
    <td class="editable"><input type="number" step="1"     value="${_wt}"  onchange="bhaSave()"></td>
    <td class="editable"><input type="number" step="1"     value="${_len}" onchange="bhaSave()"></td>
    <td class="calc-cell" data-col="ppf">—</td>
    <td class="editable"><select class="bha-grade" onchange="bhaSave()">${gradeOpts}</select></td>
    <td class="editable" style="vertical-align:top">
      ${connCat}
      <input class="bha-conn" type="text" value="${safeConn}" placeholder="e.g. NC50" onchange="bhaSave()">
    </td>
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
  const row  = sel.closest('tr');
  const nums = row.querySelectorAll('input[type=number]');
  const len  = nums[3]?.value;   // keep current length across type change
  row.innerHTML = _makeBhaRowHTML(sel.value, null, null, null, len);
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
    tr.querySelectorAll('input[type=number]')[0].value = _bhaFracToDecimal(od);
    bhaSave();
  }
}

function _bhaDPConnChanged(sel) {
  const tr   = sel.closest('tr');
  const od   = tr.querySelector('.bha-cat-od')?.value;
  const conn = sel.value;
  if (!od || !conn) return;
  const spec  = dpSpec(od, conn);
  if (!spec) return;
  const nums  = tr.querySelectorAll('input[type=number]');
  const grSel = tr.querySelector('.bha-grade');
  const cText = tr.querySelector('.bha-conn');
  nums[0].value = spec.od_in;
  nums[1].value = spec.tubeID;
  nums[2].value = Math.round(spec.adjWt * (+(nums[3]?.value || 30)));
  if (grSel) grSel.value = spec.grade;
  if (cText) cText.value = spec.conn;
  bhaSave();
}

function _bhaDCChanged(sel) {
  const idx = sel.value;
  if (idx === '') return;
  const r = DC_CATALOGUE[+idx];
  if (!r) return;
  const tr    = sel.closest('tr');
  const nums  = tr.querySelectorAll('input[type=number]');
  const cText = tr.querySelector('.bha-conn');
  nums[0].value = _bhaFracToDecimal(r[0]);
  nums[1].value = _bhaFracToDecimal(r[1]);
  nums[2].value = Math.round(r[3] * (+(nums[3]?.value || 30)));
  if (cText) cText.value = r[4];
  bhaSave();
}

function _bhaHWDPTypeChanged(sel, doFill) {
  const tr      = sel.closest('tr');
  const specSel = tr.querySelector('.bha-cat-spec');
  if (!specSel) return;
  specSel.innerHTML = `<option value="">Spec…</option>` + _hwdpSpecOptions(sel.value);
  specSel.value = '';
}

function _bhaHWDPSpecChanged(sel) {
  const val = sel.value;
  if (!val) return;
  const [nom, conn] = val.split('|');
  const tr   = sel.closest('tr');
  const type = tr.querySelector('.bha-cat-type')?.value || 'conv';
  const spec = hwdpSpec(type, nom, conn);
  if (!spec) return;
  const nums  = tr.querySelectorAll('input[type=number]');
  const cText = tr.querySelector('.bha-conn');
  nums[0].value = spec.od_in;
  nums[1].value = spec.id_in;
  nums[2].value = Math.round(spec.pf * (+(nums[3]?.value || 30)));
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
    const tr = document.createElement('tr');
    tr.innerHTML = _makeBhaRowHTML(
      row.comp, row.od, row.id, row.wt, row.len, row.grade, row.conn
    );
    body.appendChild(tr);

    // Restore catalogue selections (no auto-fill — numbers already set above)
    const comp = row.comp;
    if (comp === 'Drill Pipe' && row.catOD) {
      const catODSel = tr.querySelector('.bha-cat-od');
      if (catODSel) {
        catODSel.value = row.catOD;
        _bhaDPODChanged(catODSel, false);
        const catConnSel = tr.querySelector('.bha-cat-conn');
        if (catConnSel && row.catConn) catConnSel.value = row.catConn;
      }
    } else if (comp === 'Drill Collar' && row.catDC) {
      const dcSel = tr.querySelector('.bha-cat-dc');
      if (dcSel) dcSel.value = row.catDC;
    } else if (comp === 'HWDP' && row.catSpec) {
      const catTypeSel = tr.querySelector('.bha-cat-type');
      const catSpecSel = tr.querySelector('.bha-cat-spec');
      if (catTypeSel && row.catType) {
        catTypeSel.value = row.catType;
        _bhaHWDPTypeChanged(catTypeSel, false);
      }
      if (catSpecSel) catSpecSel.value = row.catSpec;
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
      catType: tr.querySelector('.bha-cat-type')?.value || '',
      catOD:   tr.querySelector('.bha-cat-od')?.value   || '',
      catConn: tr.querySelector('.bha-cat-conn')?.value || '',
      catDC:   tr.querySelector('.bha-cat-dc')?.value   || '',
      catSpec: tr.querySelector('.bha-cat-spec')?.value || '',
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
