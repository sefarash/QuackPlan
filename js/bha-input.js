// ===== BHA INPUT =====
// BHA components table, nozzle table (TFA), MWD pressure loss table

const BHA_PRESETS = {
  'Bit':         { od: 8.5,   id: 0,     wt: 50   },
  'PDM':         { od: 6.75,  id: 2.25,  wt: 1500 },
  'MWD':         { od: 6.5,   id: 2.25,  wt: 800  },
  'RSS':         { od: 6.75,  id: 2.25,  wt: 1200 },
  'Stabilizer':  { od: 8.375, id: 2.25,  wt: 400  },
  'HWDP':        { od: 5.0,   id: 3.0,   wt: 49.3 },
  'Drill Collar':{ od: 6.5,   id: 2.25,  wt: 2050 },
  'Drill Pipe':  { od: 5.0,   id: 4.276, wt: 0    },
  'Casing':      { od: 9.625, id: 8.835, wt: 47   },
};

const BHA_GRADES = ['S-135', 'G-105', 'X-95', 'E-75'];

// ── BHA table ─────────────────────────────────────────────────────────────────

function bhaAddRow(preset) {
  const body = document.getElementById('bhaBody');
  const p    = BHA_PRESETS[preset] || BHA_PRESETS['Drill Collar'];
  const comp = preset || 'Drill Collar';

  const gradeOpts = BHA_GRADES.map(g => `<option>${g}</option>`).join('');

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="editable">
      <select onchange="bhaPresetFill(this)">
        ${Object.keys(BHA_PRESETS).map(k =>
          `<option${k === comp ? ' selected' : ''}>${k}</option>`).join('')}
      </select>
    </td>
    <td class="editable"><input type="number" step="0.125" value="${p.od}"  onchange="bhaSave()"></td>
    <td class="editable"><input type="number" step="0.125" value="${p.id}"  onchange="bhaSave()"></td>
    <td class="editable"><input type="number" step="1"     value="${p.wt}"  onchange="bhaSave()"></td>
    <td class="editable"><input type="number" step="1"     value="30"       onchange="bhaSave()"></td>
    <td class="calc-cell" data-col="ppf">—</td>
    <td class="editable"><select onchange="bhaSave()">${gradeOpts}</select></td>
    <td class="editable"><input type="text"   value="" placeholder="e.g. NC50" onchange="bhaSave()"></td>
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
  bhaSave();
}

// Recompute PPF, CumWt, CumLen for all rows (bottom = row 0)
function _bhaRecalc() {
  const rows = document.getElementById('bhaBody').rows;
  let cumWt  = 0;
  let cumLen = 0;
  for (const tr of rows) {
    const nums = tr.querySelectorAll('input[type=number]');
    const wt   = +(nums[2]?.value || 0);
    const len  = +(nums[3]?.value || 1);
    cumWt  += wt;
    cumLen += len;
    const ppf = len > 0 ? wt / len : 0;
    const ppfCell   = tr.querySelector('[data-col="ppf"]');
    const cumWtCell = tr.querySelector('[data-col="cumwt"]');
    const cumLenCell= tr.querySelector('[data-col="cumlen"]');
    if (ppfCell)    ppfCell.textContent    = ppf.toFixed(2);
    if (cumWtCell)  cumWtCell.textContent  = Math.round(cumWt).toLocaleString();
    if (cumLenCell) cumLenCell.textContent = Math.round(cumLen).toLocaleString();
  }
}

function bhaLoadState(data) {
  const body = document.getElementById('bhaBody');
  body.innerHTML = '';
  (data || []).forEach(row => {
    bhaAddRow(row.comp);
    const last   = body.rows[body.rows.length - 1];
    const nums   = last.querySelectorAll('input[type=number]');
    const sels   = last.querySelectorAll('select');
    const texts  = last.querySelectorAll('input[type=text]');
    if (nums[0]) nums[0].value  = row.od    ?? nums[0].value;
    if (nums[1]) nums[1].value  = row.id    ?? nums[1].value;
    if (nums[2]) nums[2].value  = row.wt    ?? nums[2].value;
    if (nums[3]) nums[3].value  = row.len   ?? nums[3].value;
    if (sels[1]) sels[1].value  = row.grade ?? sels[1].value;
    if (texts[0]) texts[0].value = row.conn  ?? '';
  });
  bhaSave();
}

function bhaSave() {
  _bhaRecalc();
  if (!qpState.currentScenarioId) return;
  const rows = [];
  for (const tr of document.getElementById('bhaBody').rows) {
    const sels  = tr.querySelectorAll('select');
    const nums  = tr.querySelectorAll('input[type=number]');
    const texts = tr.querySelectorAll('input[type=text]');
    rows.push({
      comp:  sels[0]?.value,
      od:    nums[0]?.value,
      id:    nums[1]?.value,
      wt:    nums[2]?.value,
      len:   nums[3]?.value,
      grade: sels[1]?.value,
      conn:  texts[0]?.value,
    });
  }
  dbSaveScenarioData(qpState.currentScenarioId, 'bha', rows);
}

// ── Nozzle table + TFA ────────────────────────────────────────────────────────

function nozzleAddRow() {
  const body = document.getElementById('nozzleBody');
  const tr   = document.createElement('tr');
  tr.innerHTML = `
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
    const sels  = tr.querySelectorAll('select');
    const nums  = tr.querySelectorAll('input[type=number]');
    const texts = tr.querySelectorAll('input[type=text]');
    rows.push({
      type:       sels[0]?.value || 'Drill Collar',
      od:         +(nums[0]?.value || 6.5),
      id:         +(nums[1]?.value || 2.25),
      weightLbs:  +(nums[2]?.value || 2050),
      lengthFt:   +(nums[3]?.value || 30),
      grade:      sels[1]?.value || 'S-135',
      conn:       texts[0]?.value || '',
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
