// ===== KICK TOLERANCE =====
// Two models:
//  1. Static (quick):  KT = MAASP / ((PP_TD - MW) × 0.052) × Ann_cap   — incompressible
//  2. Real-gas (WECS / SPE-IADC 140113):  single methane bubble migrating from the
//     kick zone (TD) to the weak point (shoe), Hall-Yarborough Z-factor, non-isothermal,
//     KT = min(shut-in at bottom, circulating at weak point with density-ratio expansion).
//     Validated against the Beach WECS worked example (min KT = 15.0 bbl).

const _KT_PPG = 0.051948;   // psi/ft per ppg (precise, matches WECS MAASP)
const _KT_ATM = 14.7;       // psia
// Methane pseudo-critical + gas constants (field units)
const _CH4 = { Tc: 343.0 /*°R*/, Pc: 666.4 /*psia*/, M: 16.043 /*lb/lbmol*/, R: 10.7316 /*psia·ft³/lbmol·°R*/ };

// Hall-Yarborough compressibility factor (Newton-Raphson on reduced density y)
function _ktHYZ(Pr, Tr) {
  if (!(Pr > 0) || !(Tr > 0)) return 1;
  const t = 1 / Tr;
  const A = 0.06125 * t * Math.exp(-1.2 * (1 - t) ** 2);
  const B = t * (14.76 - 9.76 * t + 4.58 * t * t);
  const C = t * (90.7 - 242.2 * t + 42.4 * t * t);
  const D = 2.18 + 2.82 * t;
  let y = 0.0125 * A * Pr; if (!(y > 0)) y = 0.01;
  for (let i = 0; i < 100; i++) {
    const y2 = y*y, y3 = y2*y, y4 = y3*y, om = 1 - y;
    const F  = -A * Pr + (y + y2 + y3 - y4) / (om ** 3) - B * y2 + C * Math.pow(y, D);
    const dF = (1 + 4*y + 4*y2 - 4*y3 + y4) / (om ** 4) - 2 * B * y + C * D * Math.pow(y, D - 1);
    const dy = F / dF; y -= dy;
    if (y <= 0) y = 1e-8; if (y >= 1) y = 0.9999999;
    if (Math.abs(dy) < 1e-12) break;
  }
  return A * Pr / y;
}

// Real methane density (lb/ft³) at pressure (psia) and temperature (°R)
function _ktGasDensity(P_psia, T_R) {
  const Z = _ktHYZ(P_psia / _CH4.Pc, T_R / _CH4.Tc);
  return P_psia * _CH4.M / (Z * _CH4.R * T_R);
}

// Real-gas kick tolerance for one weak point / kick-zone pair.
// opts: { mw, pp, fg, tvdKick, tvdWeak, tempKick_R, tempWeak_R, safetyPsi,
//         capBHA, capDP, dcLen, influx: 'methane'|number(psi/ft) }
// Returns { kt, hmax, maasp, gradWeak, swabbed, infinite } or null.
function _ktGasTolerance(o) {
  const Pfrac = o.fg * _KT_PPG * o.tvdWeak;               // fracture pressure at weak point (psig)
  const maasp = Pfrac - o.mw * _KT_PPG * o.tvdWeak - o.safetyPsi;   // adjusted/circulating MAASP
  if (maasp <= 0) return { kt: 0, hmax: 0, maasp: Math.round(maasp), gradWeak: 0, swabbed: o.pp <= o.mw, infinite: false };

  // Influx density at the weak point (gas the shoe sees at Pfrac − safety)
  const Pweak = Math.max(_KT_ATM, Pfrac - o.safetyPsi + _KT_ATM);
  let denWeak, gradWeak, denBottom;
  if (o.influx === 'methane') {
    denWeak   = _ktGasDensity(Pweak, o.tempWeak_R);
    const Pbot = o.pp * _KT_PPG * o.tvdKick + _KT_ATM;    // gas enters at pore pressure
    denBottom = _ktGasDensity(Pbot, o.tempKick_R);
    gradWeak  = denWeak / 144;
  } else {
    // Custom fixed influx gradient (psi/ft) — incompressible, no expansion
    gradWeak  = +o.influx;
    denWeak   = gradWeak * 144;
    denBottom = denWeak;
  }
  const rhoK = gradWeak / _KT_PPG;                          // influx gradient in ppg

  // Max allowable gas height (WECS / SPE-IADC 140113)
  const hmax = (maasp - _KT_PPG * (o.pp - o.mw) * o.tvdKick) / (_KT_PPG * (o.mw - rhoK));
  if (!(hmax > 0)) return { kt: 0, hmax: 0, maasp: Math.round(maasp), gradWeak, swabbed: o.pp <= o.mw, infinite: false };

  // Shut-in: gas at bottom, height hmax (around DC then DP)
  const volBottom = hmax > o.dcLen
    ? o.capBHA * o.dcLen + o.capDP * (hmax - o.dcLen)
    : o.capBHA * hmax;
  // Circulating: gas at weak point around DP, converted to bottom-hole via density ratio
  const volCirc = o.capDP * hmax * (denBottom > 0 ? denWeak / denBottom : 1);

  const kt = Math.min(volBottom, volCirc);
  // Infinite if the gas column would extend above the weak point (shoe → surface open)
  const infinite = hmax >= (o.tvdKick - o.tvdWeak);
  return { kt, hmax, maasp: Math.round(maasp), gradWeak, swabbed: o.pp <= o.mw, infinite };
}

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
    resultsDiv.innerHTML = '<p style="color:var(--text-dim);padding:8px 0">Add PPFG gradient points to the table</p>';
    return;
  }

  const casingRows = allRows
    .filter(r => r.def !== 'Open Hole' && +(r.bot || 0) > 0)
    .sort((a, b) => +(a.bot) - +(b.bot));

  if (!casingRows.length) {
    resultsDiv.innerHTML = '<p style="color:var(--text-dim);padding:8px 0">Add casing strings in Well Schematic</p>';
    return;
  }

  // Real-gas (WECS) model inputs + BHA geometry
  const safetyPsi = +(document.getElementById('ktSafety')?.value   || 100);
  const surfT     = +(document.getElementById('ktSurfTemp')?.value || 70);
  const geoGrad   = +(document.getElementById('ktGeoGrad')?.value  || 1.5);   // °F/100ft
  const influxSel = document.getElementById('ktInflux')?.value || 'methane';
  const influxGrad= +(document.getElementById('ktInfluxGrad')?.value || 0.1);
  const influx    = influxSel === 'methane' ? 'methane' : influxGrad;
  const tempAtR   = tvd => surfT + geoGrad / 100 * tvd + 459.67;   // °F → °R

  const comps  = bha.components || [];
  const dcComps= comps.filter(c => c.type === 'Drill Collar');
  const dcOD   = dcComps.length ? Math.max(...dcComps.map(c => +c.od || 0)) : (dpOD + 1.5);
  const dcLen  = dcComps.reduce((s, c) => s + (+c.lengthFt || 0), 0);
  const tvdKick   = maxTVD;                     // kick zone = well TD
  const tempKick_R= tempAtR(tvdKick);

  const results = casingRows.map(row => {
    const shoeMD  = +(row.bot);
    const shoeTVD = _tvdAt(survey, shoeMD);
    const fg      = _ppfgInterp(ppfgPts, shoeTVD, 'fg');
    const pp      = _ppfgInterp(ppfgPts, maxTVD,  'pp');
    const maasp   = Math.max(0, (fg - mw) * 0.052 * shoeTVD);
    const dh      = _holeSizeAt(allRows, shoeMD + 1);
    const annCap  = Math.max(0, 0.000971 * (dh * dh - dpOD * dpOD));
    const deltaPPg = pp - mw;
    const ob = deltaPPg <= 0; // overbalanced — PP at TD below MW, no kick influx possible
    const kt = !ob && annCap > 0
      ? (maasp / (deltaPPg * 0.052)) * annCap : null;

    // Real-gas KT: this shoe is the weak point, kick zone at TD
    const capBHA = Math.max(0, (dh * dh - dcOD * dcOD) / 1029.4);
    const capDP  = Math.max(0, (dh * dh - dpOD * dpOD) / 1029.4);
    const gas = (shoeTVD > 0 && tvdKick > shoeTVD)
      ? _ktGasTolerance({ mw, pp, fg, tvdKick, tvdWeak: shoeTVD,
          tempKick_R, tempWeak_R: tempAtR(shoeTVD), safetyPsi, capBHA, capDP, dcLen, influx })
      : null;

    return { name: `${row.size}" ${row.def}`, shoeTVD: Math.round(shoeTVD),
             fg: fg.toFixed(2), pp: pp.toFixed(2), maasp: Math.round(maasp),
             dh, kt: kt !== null ? Math.round(kt) : null, ob,
             ktGas: gas && gas.kt != null ? +gas.kt.toFixed(1) : null,
             gasInf: gas ? gas.infinite : false,
             gasSwab: gas ? gas.swabbed : true };
  });

  _renderKTTable(results, mw, { influxSel, safetyPsi });
}

// ── PPFG input table ──────────────────────────────────────────────────────────

function ppfgAddRow(vals) {
  const body = document.getElementById('ppfgBody');
  if (!body) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="drag-handle">⠿</td>
    <td class="editable"><input type="number" step="100" value="${vals?.tvd ?? ''}" placeholder="0"    onchange="ppfgRecalc()"></td>
    <td class="editable"><input type="number" step="0.1"  value="${vals?.pp  ?? ''}" placeholder="8.6"  onchange="ppfgRecalc()"></td>
    <td class="editable"><input type="number" step="0.1"  value="${vals?.fg  ?? ''}" placeholder="14.0" onchange="ppfgRecalc()"></td>
    <td class="row-act"><button onclick="this.closest('tr').remove();ppfgRecalc()">✕</button></td>`;
  body.appendChild(tr);
}

function ppfgRecalc() {
  ppfgSave();
  if (qpState.activeOutputTab === 'kt') drawKickTolerance();
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

function ppfgImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    _ppfgPasteText(e.target.result);
    ppfgRecalc();
  };
  reader.readAsText(file);
  input.value = '';
}

function _ppfgPasteText(text) {
  const body = document.getElementById('ppfgBody');
  if (!body) return;
  body.innerHTML = '';
  text.trim().split(/\r?\n/).forEach((line, i) => {
    const cols = line.split(/\t|,/);
    if (i === 0 && isNaN(parseFloat(cols[0]))) return; // skip header
    if (cols.length < 2) return;
    ppfgAddRow({ tvd: +(cols[0] || 0), pp: +(cols[1] || 0), fg: +(cols[2] || 0) });
  });
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

  const chartMaxTVD = (maxTVD || 1) + 200; // extend 200 ft past planned TD
  const maxGrad = Math.max(20, ...ppfgPts.map(p => p.fg), mw + 2) * 1.05;

  const g = _chartGridDepthDown(ctx, W, H, maxGrad, chartMaxTVD, 'Gradient (ppg)', 'TVD (ft)');

  if (ppfgPts.length < 1) { _noData(ctx, W, H, 'Add PPFG points'); return; }

  const px = v => g.l + (v / maxGrad) * g.pw;
  const py = d => g.t + (d / chartMaxTVD) * g.ph;

  CI.storeLive('ktCanvas', [
    { pts: ppfgPts.map(p => ({ x: p.pp, y: p.tvd })), color: '#1a7a4a', label: 'PP' },
    { pts: ppfgPts.map(p => ({ x: p.fg, y: p.tvd })), color: '#c0392b', label: 'FG' },
  ]);
  CI.register('ktCanvas', {
    pad: g, xMax: maxGrad, yMax: chartMaxTVD,
    xLabel: 'Gradient (ppg)', yLabel: 'TVD (ft)', depthDown: true,
  });
  CI.drawFrozen(ctx, 'ktCanvas');

  // Extend PPFG points to fill chart from TVD=0 to chartMaxTVD
  const extPts = [...ppfgPts];
  if (extPts[0].tvd > 0)
    extPts.unshift({ tvd: 0, pp: extPts[0].pp, fg: extPts[0].fg });
  if (extPts[extPts.length - 1].tvd < chartMaxTVD)
    extPts.push({ tvd: chartMaxTVD, pp: _ppfgInterp(ppfgPts, chartMaxTVD, 'pp'), fg: _ppfgInterp(ppfgPts, chartMaxTVD, 'fg') });

  // Clip all curves to chart area
  ctx.save();
  ctx.beginPath(); ctx.rect(g.l, g.t, g.pw, g.ph); ctx.clip();

  // Shaded mud window (between PP and FG)
  ctx.fillStyle = 'rgba(42,127,168,0.07)';
  ctx.beginPath();
  extPts.forEach((p, i) => i === 0 ? ctx.moveTo(px(p.pp), py(p.tvd)) : ctx.lineTo(px(p.pp), py(p.tvd)));
  for (let i = extPts.length - 1; i >= 0; i--) ctx.lineTo(px(extPts[i].fg), py(extPts[i].tvd));
  ctx.closePath(); ctx.fill();

  // PP curve
  ctx.strokeStyle = '#1a7a4a'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  extPts.forEach((p, i) => i === 0 ? ctx.moveTo(px(p.pp), py(p.tvd)) : ctx.lineTo(px(p.pp), py(p.tvd)));
  ctx.stroke();

  // FG curve
  ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2;
  ctx.beginPath();
  extPts.forEach((p, i) => i === 0 ? ctx.moveTo(px(p.fg), py(p.tvd)) : ctx.lineTo(px(p.fg), py(p.tvd)));
  ctx.stroke();

  // MW vertical line
  const mwX = px(mw);
  ctx.strokeStyle = '#7a4aa0'; ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.beginPath(); ctx.moveTo(mwX, g.t); ctx.lineTo(mwX, g.t + g.ph); ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();

  // Casing shoe markers
  allRows.filter(r => r.def !== 'Open Hole' && +(r.bot || 0) > 0).forEach(row => {
    const stvd = _tvdAt(survey, +(row.bot));
    if (stvd <= 0 || stvd > chartMaxTVD) return;
    const y = py(stvd);
    ctx.strokeStyle = '#b8976a'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(g.l, y); ctx.lineTo(g.l + g.pw, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = _qpColors().dim; ctx.font = '9px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${row.size}"`, g.l + 2, y - 1);
  });

  _legend(ctx, W, g.t, ['PP', 'FG', 'MW'], ['#1a7a4a', '#c0392b', '#7a4aa0']);

  CI.drawAnnotations(ctx, 'ktCanvas');
}

// ── KT Results Table ──────────────────────────────────────────────────────────

function _renderKTTable(results, mw, meta) {
  const div = document.getElementById('ktResultsDiv');
  if (!div) return;
  meta = meta || {};

  // Governing (minimum) real-gas KT across sections that can take a kick
  const gasVals = results.map(r => r.ktGas).filter(v => v != null && v > 0);
  const minGas  = gasVals.length ? Math.min(...gasVals) : null;

  const rows = results.map(r => {
    // Status now driven by the real-gas KT when available, else the static estimate
    const govKt = r.ktGas != null ? r.ktGas : r.kt;
    const status = r.ob                  ? { txt: '✓ OB',       cls: 'color:#2aad6a;font-weight:bold' }
      : govKt == null                    ? { txt: '— no data',  cls: 'color:var(--text-dim)' }
      : govKt >= 20                      ? { txt: '✓ OK',       cls: 'color:#2aad6a;font-weight:bold' }
      : govKt >= 10                      ? { txt: '⚠ Low',      cls: 'color:#e0a020;font-weight:bold' }
                                         : { txt: '✕ Critical', cls: 'color:#e05555;font-weight:bold' };
    const ktTxt   = r.ob ? '∞' : r.kt   != null ? r.kt + ' bbl' : '—';
    const gasTxt  = r.gasInf ? '∞ (>WP)' : r.ktGas != null ? r.ktGas.toFixed(1) + ' bbl' : '—';
    const swab    = !r.gasSwab ? ' title="PP&gt;MW: true/induced kick — beyond the WECS swabbed scope; use WellPlan/DrillBench"' : '';
    const gasMark = !r.gasSwab && r.ktGas != null ? ' ⚠' : '';
    return `<tr>
      <td>${r.name}</td>
      <td style="text-align:right">${r.shoeTVD.toLocaleString()}</td>
      <td style="text-align:right">${r.fg}</td>
      <td style="text-align:right">${r.pp}</td>
      <td style="text-align:right">${r.maasp.toLocaleString()}</td>
      <td style="text-align:right">${r.dh}"</td>
      <td style="text-align:right;color:var(--text-dim)">${ktTxt}</td>
      <td style="text-align:right;font-weight:bold"${swab}>${gasTxt}${gasMark}</td>
      <td style="${status.cls}">${status.txt}</td>
    </tr>`;
  }).join('');

  const influxNote = meta.influxSel === 'methane'
    ? 'methane, real gas (Hall-Yarborough Z, non-isothermal)'
    : 'fixed influx gradient';

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
          <th style="text-align:right" title="Simple incompressible estimate">KT static</th>
          <th style="text-align:right" title="Real-gas single-bubble (WECS / SPE-IADC 140113)">KT real-gas</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:8px;font-size:11px">
      <strong>Governing (min) real-gas KT: ${minGas != null ? minGas.toFixed(1) + ' bbl' : '—'}</strong>
      &nbsp;·&nbsp; MW = ${mw} ppg &nbsp;·&nbsp; safety margin ${meta.safetyPsi || 100} psi &nbsp;·&nbsp; influx: ${influxNote}
    </p>
    <p style="margin-top:6px;font-size:10px;color:var(--text-dim);line-height:1.5">
      <strong>Real-gas model</strong> — single bubble migrating kick-zone(TD)→weak-point(shoe),
      KT = min(shut-in at bottom, circulating at weak point w/ density-ratio expansion). Validated
      to the Beach WECS worked example (15.0 bbl).<br>
      <strong>Caveats:</strong> swabbed-kick scope (PP≤MW; ⚠ rows are true/induced kicks — use
      WellPlan/DrillBench); two-node temperature (surface + geothermal gradient); DC/DP two-section
      annulus from the BHA (stabilisers collapse to the collar OD). <strong>Influx:</strong> Methane
      models real-gas expansion (conservative — use for gas kicks); Fixed-gradient is incompressible
      (no expansion — for oil/liquid kicks of known gradient only). <strong>KT static</strong> is the
      older incompressible estimate, shown for comparison.
    </p>`;
}

// ── Paste handler + seed on first load ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Excel / CSV paste into the table
  const tbl = document.getElementById('ppfgTable');
  if (tbl) {
    tbl.addEventListener('paste', e => {
      e.preventDefault();
      _ppfgPasteText((e.clipboardData || window.clipboardData).getData('text'));
      ppfgRecalc();
    });
  }

  // Seed default points if nothing loaded
  if (!document.getElementById('ppfgBody')?.rows.length) {
    ppfgAddRow({ tvd: 0,     pp: 8.6,  fg: 14.0 });
    ppfgAddRow({ tvd: 5000,  pp: 9.5,  fg: 15.0 });
    ppfgAddRow({ tvd: 10000, pp: 11.0, fg: 16.0 });
  }
});
