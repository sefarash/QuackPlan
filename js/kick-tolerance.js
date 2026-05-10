// ===== KICK TOLERANCE =====
// PPFG chart + KT per casing section
// KT (bbl) = MAASP / ((PP_TD - MW) × 0.052) × Ann_cap
// MAASP    = (FG_shoe - MW) × 0.052 × TVD_shoe

function drawKickTolerance() {
  const fluid = fluidGet();
  const mw    = fluid.mudWeight || 10;
  const el    = document.getElementById('ktMWdisplay');
  if (el) el.textContent = mw.toFixed(1);

  const survey   = qpState.survey || [];
  const maxTVD   = survey.length ? survey[survey.length - 1].tvd : 10000;
  const allRows  = _readSchematicRows();
  const ppfgPts  = _readPPFG();
  const bha      = bhaGet();
  const dpOD     = bha.topDpOD_in || 5.0;

  _drawPPFGChart(ppfgPts, mw, allRows, survey, maxTVD);

  const resultsDiv = document.getElementById('ktResultsDiv');
  if (!resultsDiv) return;

  if (ppfgPts.length < 1) {
    resultsDiv.innerHTML = '<p style="color:#9ecce3;padding:8px 0">Add PPFG gradient points to the table</p>';
    return;
  }

  const casingRows = allRows
    .filter(r => r.def !== 'Open Hole' && +(r.bot || 0) > 0)
    .sort((a, b) => +(a.bot) - +(b.bot));

  if (!casingRows.length) {
    resultsDiv.innerHTML = '<p style="color:#9ecce3;padding:8px 0">Add casing strings in Well Schematic</p>';
    return;
  }

  const results = casingRows.map(row => {
    const shoeMD  = +(row.bot);
    const shoeTVD = _tvdAt(survey, shoeMD);
    const fg      = _ppfgInterp(ppfgPts, shoeTVD, 'fg');
    const pp      = _ppfgInterp(ppfgPts, maxTVD,  'pp');
    const maasp   = Math.max(0, (fg - mw) * 0.052 * shoeTVD);
    const dh      = _holeSizeAt(allRows, shoeMD + 1);
    const annCap  = Math.max(0, 0.000971 * (dh * dh - dpOD * dpOD));
    const deltaPPg = pp - mw;
    const kt      = deltaPPg > 0 && annCap > 0
      ? (maasp / (deltaPPg * 0.052)) * annCap : null;
    return { name: `${row.size}" ${row.def}`, shoeTVD: Math.round(shoeTVD),
             fg: fg.toFixed(2), pp: pp.toFixed(2), maasp: Math.round(maasp),
             dh, kt: kt !== null ? Math.round(kt) : null };
  });

  _renderKTTable(results, mw);
}

// ── PPFG input table ──────────────────────────────────────────────────────────

function ppfgAddRow(vals) {
  const body = document.getElementById('ppfgBody');
  if (!body) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="drag-handle">⠿</td>
    <td class="editable"><input type="number" step="100" value="${vals?.tvd ?? ''}" placeholder="0" onchange="drawKickTolerance()"></td>
    <td class="editable"><input type="number" step="0.1" value="${vals?.pp ?? ''}"  placeholder="8.6" onchange="drawKickTolerance()"></td>
    <td class="editable"><input type="number" step="0.1" value="${vals?.fg ?? ''}"  placeholder="14.0" onchange="drawKickTolerance()"></td>
    <td class="row-act"><button onclick="this.closest('tr').remove();drawKickTolerance()">✕</button></td>`;
  body.appendChild(tr);
}

function _readPPFG() {
  const rows = [];
  const body = document.getElementById('ppfgBody');
  if (!body) return rows;
  for (const tr of body.rows) {
    const n = tr.querySelectorAll('input[type=number]');
    const tvd = +(n[0]?.value || 0);
    const pp  = +(n[1]?.value || 0);
    const fg  = +(n[2]?.value || 0);
    if (pp > 0 || fg > 0) rows.push({ tvd, pp, fg });
  }
  return rows.sort((a, b) => a.tvd - b.tvd);
}

function ppfgSave() {
  if (!qpState.currentScenarioId) return;
  dbSaveScenarioData(qpState.currentScenarioId, 'ppfg', _readPPFG());
}

function ppfgLoadState(data) {
  const body = document.getElementById('ppfgBody');
  if (!body) return;
  body.innerHTML = '';
  (data || []).forEach(r => ppfgAddRow(r));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _ppfgInterp(pts, tvd, field) {
  if (!pts.length) return field === 'fg' ? 15 : 9;
  if (tvd <= pts[0].tvd) return pts[0][field];
  if (tvd >= pts[pts.length - 1].tvd) return pts[pts.length - 1][field];
  for (let i = 1; i < pts.length; i++) {
    if (tvd <= pts[i].tvd) {
      const f = (tvd - pts[i-1].tvd) / (pts[i].tvd - pts[i-1].tvd);
      return pts[i-1][field] + f * (pts[i][field] - pts[i-1][field]);
    }
  }
  return pts[pts.length - 1][field];
}

function _holeSizeAt(schRows, md) {
  for (const r of schRows) {
    if (r.def === 'Open Hole' && +(r.top || 0) <= md && +(r.bot || 99999) >= md)
      return +(r.size || 8.5);
  }
  // Fall back: smallest casing that reaches this depth
  const below = schRows.filter(r => r.def !== 'Open Hole' && +(r.bot || 0) >= md);
  below.sort((a, b) => +(a.size) - +(b.size));
  return below.length ? +(below[0].size) : 8.5;
}

// ── PPFG Chart ────────────────────────────────────────────────────────────────

function _drawPPFGChart(ppfgPts, mw, allRows, survey, maxTVD) {
  const c = _chartSetup('ktCanvas');
  if (!c) return;
  const { ctx, W, H } = c;

  const maxGrad = Math.max(20, ...ppfgPts.map(p => p.fg), mw + 2) * 1.05;

  const g = _chartGridDepthDown(ctx, W, H, maxGrad, maxTVD || 1, 'Gradient (ppg)', 'TVD (ft)');

  if (ppfgPts.length < 1) { _noData(ctx, W, H, 'Add PPFG points'); return; }

  const px = v => g.l + (v / maxGrad) * g.pw;
  const py = d => g.t + (d / (maxTVD || 1)) * g.ph;

  // Shaded mud window (between PP and FG)
  ctx.fillStyle = 'rgba(42,127,168,0.07)';
  ctx.beginPath();
  ppfgPts.forEach((p, i) => i === 0 ? ctx.moveTo(px(p.pp), py(p.tvd)) : ctx.lineTo(px(p.pp), py(p.tvd)));
  for (let i = ppfgPts.length - 1; i >= 0; i--) ctx.lineTo(px(ppfgPts[i].fg), py(ppfgPts[i].tvd));
  ctx.closePath(); ctx.fill();

  // PP curve
  ctx.strokeStyle = '#1a7a4a'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  ppfgPts.forEach((p, i) => i === 0 ? ctx.moveTo(px(p.pp), py(p.tvd)) : ctx.lineTo(px(p.pp), py(p.tvd)));
  ctx.stroke();

  // FG curve
  ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2;
  ctx.beginPath();
  ppfgPts.forEach((p, i) => i === 0 ? ctx.moveTo(px(p.fg), py(p.tvd)) : ctx.lineTo(px(p.fg), py(p.tvd)));
  ctx.stroke();

  // MW vertical line
  const mwX = px(mw);
  ctx.strokeStyle = '#7a4aa0'; ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.beginPath(); ctx.moveTo(mwX, g.t); ctx.lineTo(mwX, g.t + g.ph); ctx.stroke();
  ctx.setLineDash([]);

  // Casing shoe markers
  allRows.filter(r => r.def !== 'Open Hole' && +(r.bot || 0) > 0).forEach(row => {
    const stvd = _tvdAt(survey, +(row.bot));
    if (stvd <= 0 || stvd > maxTVD) return;
    const y = py(stvd);
    ctx.strokeStyle = '#b8976a'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(g.l, y); ctx.lineTo(g.l + g.pw, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#7a5a2a'; ctx.font = '9px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${row.size}"`, g.l + 2, y - 1);
  });

  _legend(ctx, W, g.t, ['PP', 'FG', 'MW'], ['#1a7a4a', '#c0392b', '#7a4aa0']);

  CI.register('ktCanvas', {
    pad: g, xMax: maxGrad, yMax: maxTVD || 1,
    xLabel: 'Gradient (ppg)', yLabel: 'TVD (ft)', depthDown: true,
  });
  CI.drawAnnotations(ctx, 'ktCanvas');
}

// ── KT Results Table ──────────────────────────────────────────────────────────

function _renderKTTable(results, mw) {
  const div = document.getElementById('ktResultsDiv');
  if (!div) return;

  const rows = results.map(r => {
    const status = r.kt === null  ? { txt: '— no PP data', cls: 'color:#9ecce3' }
      : r.kt >= 20 ? { txt: '✓ OK',      cls: 'color:#1a7a4a;font-weight:bold' }
      : r.kt >= 10 ? { txt: '⚠ Low',     cls: 'color:#e67e22;font-weight:bold' }
                   : { txt: '✕ Critical', cls: 'color:#c0392b;font-weight:bold' };
    const ktTxt = r.kt !== null ? r.kt + ' bbl' : '—';
    return `<tr>
      <td>${r.name}</td>
      <td style="text-align:right">${r.shoeTVD.toLocaleString()}</td>
      <td style="text-align:right">${r.fg}</td>
      <td style="text-align:right">${r.pp}</td>
      <td style="text-align:right">${r.maasp.toLocaleString()}</td>
      <td style="text-align:right">${r.dh}"</td>
      <td style="text-align:right;font-weight:bold">${ktTxt}</td>
      <td style="${status.cls}">${status.txt}</td>
    </tr>`;
  }).join('');

  div.innerHTML = `
    <table class="qp-table" style="width:100%;font-size:11px">
      <thead>
        <tr>
          <th>Section</th>
          <th style="text-align:right">Shoe TVD (ft)</th>
          <th style="text-align:right">FG@shoe (ppg)</th>
          <th style="text-align:right">PP@TD (ppg)</th>
          <th style="text-align:right">MAASP (psi)</th>
          <th style="text-align:right">Hole (in)</th>
          <th style="text-align:right">KT (bbl)</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:8px;font-size:10px;color:#9ecce3">
      MW = ${mw} ppg &nbsp;|&nbsp; KT ≥ 20 bbl = acceptable &nbsp;|&nbsp;
      Formula: MAASP / ((PP − MW) × 0.052) × Ann. capacity
    </p>`;
}

// ── Seed default PPFG points on first load ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('ppfgBody')?.rows.length) {
    ppfgAddRow({ tvd: 0,     pp: 8.6,  fg: 14.0 });
    ppfgAddRow({ tvd: 5000,  pp: 9.5,  fg: 15.0 });
    ppfgAddRow({ tvd: 10000, pp: 11.0, fg: 16.0 });
  }
});
