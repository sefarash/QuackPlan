// ===== KICK TOLERANCE =====
// Two models:
//  1. Static (quick):  KT = MAASP / ((PP_TD - MW) × 0.052) × Ann_cap   — incompressible
//  2. Real-gas (WECS / SPE-IADC 140113):  single methane bubble migrating from the
//     kick zone (TD) to the weak point (shoe), Hall-Yarborough Z-factor, non-isothermal,
//     KT = min(shut-in at bottom, circulating at weak point with density-ratio expansion).
//     Validated against the Beach WECS worked example (min KT = 15.0 bbl).

const _KT_PPG = 0.051948;   // psi/ft per ppg (precise, matches WECS MAASP)
const _KT_ATM = 14.7;       // psia
const _KT_PP_TOL = 0.01;    // ppg tolerance on the pp==mw swabbed/balanced boundary
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

// Temperature conversions (offset, so handled inline — not the factor-based units).
const _KT_GEO = 1.822688;   // °F/100ft ↔ °C/100m scale
function _ktTempToImp(v)  { return QP_UNITS.isMetric() ? (+v * 9 / 5 + 32) : +v; }   // display → °F
function _ktTempToDisp(f) { return QP_UNITS.isMetric() ? ((f - 32) * 5 / 9) : f; }   // °F → display
function _ktGeoToImp(v)   { return QP_UNITS.isMetric() ? (+v / _KT_GEO) : +v; }       // display → °F/100ft
function _ktGeoToDisp(g)  { return QP_UNITS.isMetric() ? (g * _KT_GEO) : g; }
function _ktUTemp()       { return QP_UNITS.isMetric() ? '°C' : '°F'; }
function _ktUGeo()        { return QP_UNITS.isMetric() ? '°C/100m' : '°F/100ft'; }
// convert a value between two explicit systems (for the unit toggle)
function _ktConvTemp(v, from, to) { return from === to ? +v : (from === 'imperial' ? (+v - 32) * 5 / 9 : +v * 9 / 5 + 32); }
function _ktConvGeo(v, from, to)  { return from === to ? +v : (from === 'imperial' ? +v * _KT_GEO : +v / _KT_GEO); }

// ── KT / PPFG unit-system wiring ───────────────────────────────────────────────
function _ktUpdateLabels() {
  const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  set('uKtSafety', QP_UNITS.label('press'));
  set('uKtTemp',   _ktUTemp());
  set('uKtGeo',    _ktUGeo());
  set('uKtInflux', QP_UNITS.label('pgrad'));
  set('ktMWunit',  QP_UNITS.label('mw'));
  set('hdrPpfgTVD', `TVD (${QP_UNITS.label('depth')})`);
  set('hdrPpfgPP',  `Max Pore Pressure (${QP_UNITS.label('mw')})`);
  set('hdrPpfgFG',  `Min Frac Gradient (${QP_UNITS.label('mw')})`);
}

function _ktConvertFields(fromSys, toSys) {
  const conv = (id, q) => { const el = document.getElementById(id); if (el && el.value !== '') el.value = +QP_UNITS.convert(q, +el.value, fromSys, toSys).toFixed(2); };
  conv('ktSafety', 'press');
  conv('ktInfluxGrad', 'pgrad');
  const st = document.getElementById('ktSurfTemp');
  if (st && st.value !== '') st.value = +_ktConvTemp(+st.value, fromSys, toSys).toFixed(1);
  const gg = document.getElementById('ktGeoGrad');
  if (gg && gg.value !== '') gg.value = +_ktConvGeo(+gg.value, fromSys, toSys).toFixed(3);
  // PPFG table: TVD (depth), PP/FG (mw)
  const body = document.getElementById('ppfgBody');
  if (body) for (const tr of body.rows) {
    const n = tr.querySelectorAll('input[type=number]');
    if (n[0] && n[0].value !== '') n[0].value = +QP_UNITS.convert('depth', +n[0].value, fromSys, toSys).toFixed(1);
    if (n[1] && n[1].value !== '') n[1].value = +QP_UNITS.convert('mw',    +n[1].value, fromSys, toSys).toFixed(1);
    if (n[2] && n[2].value !== '') n[2].value = +QP_UNITS.convert('mw',    +n[2].value, fromSys, toSys).toFixed(1);
  }
}

QP_UNITS.onChange((newSys, oldSys) => {
  _ktConvertFields(oldSys, newSys);
  _ktUpdateLabels();
  if (typeof qpState !== 'undefined' && qpState.activeOutputTab === 'kt') drawKickTolerance();
});

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
  // Swabbed convention is MW = PP; a small tolerance (well below the 0.1 ppg input
  // granularity) keeps the pp == mw boundary swabbed despite display-unit rounding.
  const swabbed = o.pp <= o.mw + _KT_PP_TOL;
  const Pfrac = o.fg * _KT_PPG * o.tvdWeak;               // fracture pressure at weak point (psig)
  const maasp = Pfrac - o.mw * _KT_PPG * o.tvdWeak - o.safetyPsi;   // adjusted/circulating MAASP
  if (maasp <= 0) return { kt: 0, hmax: 0, maasp: Math.round(maasp), gradWeak: 0, swabbed, infinite: false };

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
  if (!(hmax > 0)) return { kt: 0, hmax: 0, maasp: Math.round(maasp), gradWeak, swabbed, infinite: false };

  // Shut-in: gas at bottom, height hmax (around DC then DP)
  const volBottom = hmax > o.dcLen
    ? o.capBHA * o.dcLen + o.capDP * (hmax - o.dcLen)
    : o.capBHA * hmax;
  // Circulating: gas at weak point around DP, converted to bottom-hole via density ratio
  const volCirc = o.capDP * hmax * (denBottom > 0 ? denWeak / denBottom : 1);

  const kt = Math.min(volBottom, volCirc);
  // Infinite if the gas column would extend above the weak point (shoe → surface open)
  const infinite = hmax >= (o.tvdKick - o.tvdWeak);
  return { kt, hmax, maasp: Math.round(maasp), gradWeak, swabbed, infinite };
}

function drawKickTolerance() {
  // Phase-aware: the active drilling stage's fluid, survey and casing program
  const fluid = (typeof qpPhaseFluid === 'function') ? qpPhaseFluid() : fluidGet();
  const mw    = fluid.mudWeight || 10;   // imperial ppg (canonical)
  const el    = document.getElementById('ktMWdisplay');
  if (el) el.textContent = QP_UNITS.toDisplay('mw', mw).toFixed(QP_UNITS.isMetric() ? 0 : 1);
  const uMWel = document.getElementById('ktMWunit');
  if (uMWel) uMWel.textContent = QP_UNITS.label('mw');

  const survey   = ((typeof qpSurveyForAnalysis === 'function') ? qpSurveyForAnalysis() : qpState.survey) || [];
  const maxTVD   = survey.length ? survey[survey.length - 1].tvd : 10000;
  const allRows  = (typeof qpPhaseRows === 'function') ? qpPhaseRows() : _readSchematicRows();
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

  // Real-gas (WECS) model inputs (display units) → imperial (canonical) for the engine
  const safetyPsi = QP_UNITS.fromDisplay('press', +(document.getElementById('ktSafety')?.value || 100));
  const surfT     = _ktTempToImp(document.getElementById('ktSurfTemp')?.value ?? 70);   // °F
  const geoGrad   = _ktGeoToImp(document.getElementById('ktGeoGrad')?.value ?? 1.5);     // °F/100ft
  const influxSel = document.getElementById('ktInflux')?.value || 'methane';
  const influxGrad= QP_UNITS.fromDisplay('pgrad', +(document.getElementById('ktInfluxGrad')?.value || 0.1));
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
    const ob = deltaPPg <= _KT_PP_TOL; // overbalanced/balanced (tolerant of display rounding at pp≈mw)
    const kt = !ob && annCap > 0
      ? (maasp / (deltaPPg * 0.052)) * annCap : null;

    // Real-gas KT: this shoe is the weak point, kick zone at TD
    const capBHA = Math.max(0, (dh * dh - dcOD * dcOD) / 1029.4);
    const capDP  = Math.max(0, (dh * dh - dpOD * dpOD) / 1029.4);
    const gas = (shoeTVD > 0 && tvdKick > shoeTVD)
      ? _ktGasTolerance({ mw, pp, fg, tvdKick, tvdWeak: shoeTVD,
          tempKick_R, tempWeak_R: tempAtR(shoeTVD), safetyPsi, capBHA, capDP, dcLen, influx })
      : null;

    // Values kept imperial (canonical) for status/governing logic; converted for
    // display in _renderKTTable.
    return { name: `${row.size}" ${row.def}`, shoeTVD, fg, pp, maasp,
             dh, kt, ob,
             ktGas: gas && gas.kt != null ? +gas.kt.toFixed(2) : null,
             gasInf: gas ? gas.infinite : false,
             gasSwab: gas ? gas.swabbed : true };
  });

  _renderKTTable(results, mw, { influxSel, safetyPsi });
}

// ── PPFG input table ──────────────────────────────────────────────────────────

function ppfgAddRow(vals) {
  const body = document.getElementById('ppfgBody');
  if (!body) return;
  // vals are imperial (canonical: TVD ft, PP/FG ppg) → display for the fields
  const dD = v => (v === '' || v == null) ? '' : +QP_UNITS.toDisplay('depth', +v).toFixed(1);
  const dM = v => (v === '' || v == null) ? '' : +QP_UNITS.toDisplay('mw',    +v).toFixed(1);
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="drag-handle">⠿</td>
    <td class="editable"><input type="number" step="100" value="${dD(vals?.tvd)}" placeholder="0"    onchange="ppfgRecalc()"></td>
    <td class="editable"><input type="number" step="0.1"  value="${dM(vals?.pp)}"  placeholder="8.6"  onchange="ppfgRecalc()"></td>
    <td class="editable"><input type="number" step="0.1"  value="${dM(vals?.fg)}"  placeholder="14.0" onchange="ppfgRecalc()"></td>
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
    // fields are display units → imperial (canonical): TVD depth, PP/FG as EMW (mw)
    const tvd = QP_UNITS.fromDisplay('depth', +(n[0]?.value || 0));
    const pp  = QP_UNITS.fromDisplay('mw',    +(n[1]?.value || 0));
    const fg  = QP_UNITS.fromDisplay('mw',    +(n[2]?.value || 0));
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
    // pasted values are in the active display units → store canonical (imperial)
    ppfgAddRow({
      tvd: QP_UNITS.fromDisplay('depth', +(cols[0] || 0)),
      pp:  QP_UNITS.fromDisplay('mw',    +(cols[1] || 0)),
      fg:  QP_UNITS.fromDisplay('mw',    +(cols[2] || 0)),
    });
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

  // Data is imperial (canonical); plot & label in display units (self-scaling).
  const toG = v => QP_UNITS.toDisplay('mw', v);      // EMW gradient ppg → display
  const toD = v => QP_UNITS.toDisplay('depth', v);   // TVD ft → display
  const uMW = QP_UNITS.label('mw'), uD = QP_UNITS.label('depth');

  const chartMaxTVDimp = (maxTVD || 1) + 200; // extend past planned TD (imperial)
  const maxGradImp = Math.max(20, ...ppfgPts.map(p => p.fg), mw + 2) * 1.05;
  const chartMaxTVD = toD(chartMaxTVDimp);    // display
  const maxGrad     = toG(maxGradImp);        // display

  const g = _chartGridDepthDown(ctx, W, H, maxGrad, chartMaxTVD, `Gradient (${uMW})`, `TVD (${uD})`);

  if (ppfgPts.length < 1) { _noData(ctx, W, H, 'Add PPFG points'); return; }

  const px = v => g.l + (v / maxGrad) * g.pw;      // v in display gradient
  const py = d => g.t + (d / chartMaxTVD) * g.ph;  // d in display depth

  CI.storeLive('ktCanvas', [
    { pts: ppfgPts.map(p => ({ x: toG(p.pp), y: toD(p.tvd) })), color: '#1a7a4a', label: 'PP' },
    { pts: ppfgPts.map(p => ({ x: toG(p.fg), y: toD(p.tvd) })), color: '#c0392b', label: 'FG' },
  ]);
  CI.register('ktCanvas', {
    pad: g, xMax: maxGrad, yMax: chartMaxTVD,
    xLabel: `Gradient (${uMW})`, yLabel: `TVD (${uD})`, depthDown: true,
  });
  CI.drawFrozen(ctx, 'ktCanvas');

  // Extend PPFG points (imperial) to fill chart from TVD=0 to chartMaxTVDimp
  const extPts = [...ppfgPts];
  if (extPts[0].tvd > 0)
    extPts.unshift({ tvd: 0, pp: extPts[0].pp, fg: extPts[0].fg });
  if (extPts[extPts.length - 1].tvd < chartMaxTVDimp)
    extPts.push({ tvd: chartMaxTVDimp, pp: _ppfgInterp(ppfgPts, chartMaxTVDimp, 'pp'), fg: _ppfgInterp(ppfgPts, chartMaxTVDimp, 'fg') });

  // Clip all curves to chart area
  ctx.save();
  ctx.beginPath(); ctx.rect(g.l, g.t, g.pw, g.ph); ctx.clip();

  // Shaded mud window (between PP and FG)
  ctx.fillStyle = 'rgba(42,127,168,0.07)';
  ctx.beginPath();
  extPts.forEach((p, i) => i === 0 ? ctx.moveTo(px(toG(p.pp)), py(toD(p.tvd))) : ctx.lineTo(px(toG(p.pp)), py(toD(p.tvd))));
  for (let i = extPts.length - 1; i >= 0; i--) ctx.lineTo(px(toG(extPts[i].fg)), py(toD(extPts[i].tvd)));
  ctx.closePath(); ctx.fill();

  // PP curve
  ctx.strokeStyle = '#1a7a4a'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  extPts.forEach((p, i) => i === 0 ? ctx.moveTo(px(toG(p.pp)), py(toD(p.tvd))) : ctx.lineTo(px(toG(p.pp)), py(toD(p.tvd))));
  ctx.stroke();

  // FG curve
  ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2;
  ctx.beginPath();
  extPts.forEach((p, i) => i === 0 ? ctx.moveTo(px(toG(p.fg)), py(toD(p.tvd))) : ctx.lineTo(px(toG(p.fg)), py(toD(p.tvd))));
  ctx.stroke();

  // MW vertical line
  const mwX = px(toG(mw));
  ctx.strokeStyle = '#7a4aa0'; ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.beginPath(); ctx.moveTo(mwX, g.t); ctx.lineTo(mwX, g.t + g.ph); ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();

  // Casing shoe markers
  allRows.filter(r => r.def !== 'Open Hole' && +(r.bot || 0) > 0).forEach(row => {
    const stvd = _tvdAt(survey, +(row.bot));   // imperial
    if (stvd <= 0 || stvd > chartMaxTVDimp) return;
    const y = py(toD(stvd));
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

  // Governing (minimum) real-gas KT over the swabbed-valid sections (PP ≤ MW).
  // True-kick sections (PP > MW) are out of the WECS swabbed scope, so they are
  // excluded from the governing figure (but still shown per-row with a ⚠).
  const swabRows = results.filter(r => r.gasSwab && r.ktGas != null);
  const minGas   = swabRows.length ? Math.min(...swabRows.map(r => r.ktGas)) : null;
  const trueKickOnly = minGas == null && results.some(r => r.ktGas != null && !r.gasSwab);

  const rows = results.map(r => {
    // The real-gas KT governs the status when it computed; an overbalanced 'OB'
    // reading only applies to the static (no-influx) model, so it must NOT mask a
    // finite swabbed real-gas tolerance.
    const status = r.ktGas != null
      ? (r.ktGas >= 20 ? { txt: '✓ OK',       cls: 'color:#2aad6a;font-weight:bold' }
       : r.ktGas >= 10 ? { txt: '⚠ Low',      cls: 'color:#e0a020;font-weight:bold' }
                       : { txt: '✕ Critical', cls: 'color:#e05555;font-weight:bold' })
      : r.ob          ? { txt: '✓ OB',        cls: 'color:#2aad6a;font-weight:bold' }
      : r.kt == null  ? { txt: '— no data',   cls: 'color:var(--text-dim)' }
      : r.kt >= 20    ? { txt: '✓ OK',        cls: 'color:#2aad6a;font-weight:bold' }
      : r.kt >= 10    ? { txt: '⚠ Low',       cls: 'color:#e0a020;font-weight:bold' }
                      : { txt: '✕ Critical',  cls: 'color:#e05555;font-weight:bold' };
    // Display converters (values above are imperial/canonical)
    const dD = v => Math.round(QP_UNITS.toDisplay('depth', v)).toLocaleString();
    const dM = v => QP_UNITS.toDisplay('mw', v).toFixed(QP_UNITS.isMetric() ? 0 : 2);
    const dP = v => Math.round(QP_UNITS.toDisplay('press', v)).toLocaleString();
    const dV = v => QP_UNITS.toDisplay('volume', v).toFixed(QP_UNITS.isMetric() ? 2 : 1);
    const uV = QP_UNITS.label('volume');
    const ktTxt   = r.ob ? '∞' : r.kt   != null ? dV(r.kt) + ' ' + uV : '—';
    const gasTxt  = r.gasInf ? '∞ (>WP)' : r.ktGas != null ? dV(r.ktGas) + ' ' + uV : '—';
    const swab    = !r.gasSwab ? ' title="PP&gt;MW: true/induced kick — beyond the WECS swabbed scope; use WellPlan/DrillBench"' : '';
    const gasMark = !r.gasSwab && r.ktGas != null ? ' ⚠' : '';
    return `<tr>
      <td>${r.name}</td>
      <td style="text-align:right">${dD(r.shoeTVD)}</td>
      <td style="text-align:right">${dM(r.fg)}</td>
      <td style="text-align:right">${dM(r.pp)}</td>
      <td style="text-align:right">${dP(r.maasp)}</td>
      <td style="text-align:right">${r.dh}"</td>
      <td style="text-align:right;color:var(--text-dim)">${ktTxt}</td>
      <td style="text-align:right;font-weight:bold"${swab}>${gasTxt}${gasMark}</td>
      <td style="${status.cls}">${status.txt}</td>
    </tr>`;
  }).join('');

  const influxNote = meta.influxSel === 'methane'
    ? 'methane, real gas (Hall-Yarborough Z, non-isothermal)'
    : 'fixed influx gradient';
  const uD = QP_UNITS.label('depth'), uMW = QP_UNITS.label('mw'),
        uP = QP_UNITS.label('press'), uVol = QP_UNITS.label('volume');
  const govDisp = v => QP_UNITS.toDisplay('volume', v).toFixed(QP_UNITS.isMetric() ? 2 : 1);

  div.innerHTML = `
    <table class="qp-table" style="width:100%;font-size:11px">
      <thead>
        <tr>
          <th>Section</th>
          <th style="text-align:right">Shoe TVD (${uD})</th>
          <th style="text-align:right">FG@shoe (${uMW})</th>
          <th style="text-align:right">PP@TD (${uMW})</th>
          <th style="text-align:right">MAASP (${uP})</th>
          <th style="text-align:right">Hole (in)</th>
          <th style="text-align:right" title="Simple incompressible estimate">KT static (${uVol})</th>
          <th style="text-align:right" title="Real-gas single-bubble (WECS / SPE-IADC 140113)">KT real-gas (${uVol})</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:8px;font-size:11px">
      <strong>Governing (min) real-gas KT: ${minGas != null ? govDisp(minGas) + ' ' + uVol
        : trueKickOnly ? '— (true-kick sections only — use WellPlan/DrillBench)' : '—'}</strong>
      &nbsp;·&nbsp; MW = ${QP_UNITS.toDisplay('mw', mw).toFixed(QP_UNITS.isMetric() ? 0 : 1)} ${uMW}
      &nbsp;·&nbsp; safety margin ${Math.round(QP_UNITS.toDisplay('press', meta.safetyPsi || 100))} ${uP} &nbsp;·&nbsp; influx: ${influxNote}
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

  // Seed default points if nothing loaded (ppfgAddRow converts imperial → display)
  if (!document.getElementById('ppfgBody')?.rows.length) {
    ppfgAddRow({ tvd: 0,     pp: 8.6,  fg: 14.0 });
    ppfgAddRow({ tvd: 5000,  pp: 9.5,  fg: 15.0 });
    ppfgAddRow({ tvd: 10000, pp: 11.0, fg: 16.0 });
  }

  _ktUpdateLabels();
  // On a metric startup, convert the static HTML KT model-input defaults
  // (PPFG fields are already display-correct via ppfgAddRow above).
  if (QP_UNITS.isMetric()) {
    const conv = (id, q) => { const el = document.getElementById(id); if (el && el.value !== '') el.value = +QP_UNITS.convert(q, +el.value, 'imperial', 'metric').toFixed(2); };
    conv('ktSafety', 'press');
    conv('ktInfluxGrad', 'pgrad');
    const st = document.getElementById('ktSurfTemp'); if (st && st.value !== '') st.value = +_ktConvTemp(+st.value, 'imperial', 'metric').toFixed(1);
    const gg = document.getElementById('ktGeoGrad');  if (gg && gg.value !== '') gg.value = +_ktConvGeo(+gg.value, 'imperial', 'metric').toFixed(3);
  }
});
