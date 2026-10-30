// ===== KICK TOLERANCE =====
// Real-gas model (SPE-IADC 140113): single methane bubble migrating from the kick
// zone (the section TD) to the weak point (the shoe, and the weakest open-hole
// depth), Hall-Yarborough Z-factor, non-isothermal (formation temperature, thermal.js),
// KT = min(shut-in at bottom, circulating at weak point with density-ratio expansion),
// gas height laid along the deviated hole. See ktComputeSections().

const _KT_PPG = 0.051948;   // psi/ft per ppg (precise)
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

// Temperature helpers — thin names over the 'temp' / 'tgrad' quantities of
// QP_UNITS (which carry the °F→°C offset); kept because thermal.js and
// casing-triaxial.js call them.
function _ktTempToImp(v)  { return QP_UNITS.fromDisplay('temp', v); }    // display → °F
function _ktTempToDisp(f) { return QP_UNITS.toDisplay('temp', f); }      // °F → display
function _ktGeoToImp(v)   { return QP_UNITS.fromDisplay('tgrad', v); }   // display → °F/100ft
function _ktGeoToDisp(g)  { return QP_UNITS.toDisplay('tgrad', g); }
function _ktUTemp()       { return QP_UNITS.label('temp'); }
function _ktUGeo()        { return QP_UNITS.label('tgrad'); }
// convert a value between two explicit systems (for the unit switch)
function _ktConvTemp(v, from, to) { return QP_UNITS.convert('temp',  v, from, to); }
function _ktConvGeo(v, from, to)  { return QP_UNITS.convert('tgrad', v, from, to); }

// ── KT / PPFG unit-system wiring ───────────────────────────────────────────────
function _ktUpdateLabels() {
  const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  set('uKtSafety', QP_UNITS.label('press'));
  set('uKtTemp',   _ktUTemp());
  set('uKtGeo',    _ktUGeo());
  set('uKtInflux', QP_UNITS.label('pgrad'));
  set('uKtKickInt', QP_UNITS.label('mw'));
  set('uKtMinVol',  QP_UNITS.label('volume'));
  set('ktMWunit',  QP_UNITS.label('mw'));
  set('hdrPpfgTVD', `TVD (${QP_UNITS.label('depth')})`);
  set('hdrPpfgPP',  `Max Pore Pressure (${QP_UNITS.label('mw')})`);
  set('hdrPpfgFG',  `Min Frac Gradient (${QP_UNITS.label('mw')})`);
}

// The model-input fields only (not the PPFG table, which ppfgAddRow fills in display units)
function _ktConvertInputs(fromSys, toSys) {
  const conv = (id, q) => { const el = document.getElementById(id); if (el && el.value !== '') el.value = +QP_UNITS.convert(q, +el.value, fromSys, toSys).toFixed(2); };
  conv('ktSafety', 'press');
  conv('ktInfluxGrad', 'pgrad');
  const st = document.getElementById('ktSurfTemp');
  if (st && st.value !== '') st.value = +_ktConvTemp(+st.value, fromSys, toSys).toFixed(1);
  const gg = document.getElementById('ktGeoGrad');
  if (gg && gg.value !== '') gg.value = +_ktConvGeo(+gg.value, fromSys, toSys).toFixed(3);
}

function _ktConvertFields(fromSys, toSys) {
  _ktConvertInputs(fromSys, toSys);
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

// Annulus of one open-hole interval, weak point → bit, as MD steps of ≤ 10 ft:
// [{ md, tvd, cap }], cap = annular capacity (bbl/ft) of the step ENDING at that
// point. The bit sits at the interval's TD: the bottom dcLen ft of string is the
// collar section, drill pipe above it.
function _ktAnnulusProfile(survey, topMD, bitMD, dh, dpOD, dcOD, dcLen) {
  const capOf = od => Math.max(0, (dh * dh - od * od) / 1029.4);
  const dcTop = bitMD - dcLen;
  const mds = new Set([topMD, bitMD]);
  for (let m = topMD + 10; m < bitMD; m += 10) mds.add(m);
  if (dcTop > topMD && dcTop < bitMD) mds.add(dcTop);
  for (const st of survey) if (st.md > topMD && st.md < bitMD) mds.add(st.md);
  const arr = [...mds].sort((a, b) => a - b);
  return arr.map((md, i) => {
    const mid = i ? (md + arr[i - 1]) / 2 : md;
    return { md, tvd: _tvdAt(survey, md), cap: capOf(mid >= dcTop ? dcOD : dpOD) };
  });
}

// Annular volume (bbl) of a gas column `h` ft of VERTICAL height laid along the
// hole — up from the bit (fromBit) or down from the weak point. A deviated step
// holds length = height / cos(inc); a horizontal step adds volume with no height.
// Around the string as it actually sits: drill pipe in the open hole first, the
// rest around the collars. reached = the column ran out of hole.
function _ktColumnVol(prof, h, fromBit) {
  let vol = 0, rem = h;
  const n = prof.length;
  for (let k = 1; k < n; k++) {
    const j = fromBit ? n - k : k;                 // step prof[j-1] → prof[j]
    const a = prof[j - 1], b = prof[j];
    const dL = b.md - a.md, dT = Math.abs(b.tvd - a.tvd);
    if (dT >= rem) return { vol: vol + b.cap * dL * (dT > 0 ? rem / dT : 1), reached: false };
    vol += b.cap * dL; rem -= dT;
  }
  return { vol, reached: true };
}

// Real-gas kick tolerance for one weak point / kick-zone pair.
// opts: { mw, pp, fg, tvdKick, tvdWeak, tempKick_R, tempWeak_R, safetyPsi,
//         influx: 'methane'|number(psi/ft), prof (weak point → bit, _ktAnnulusProfile) }
// pp is the kick-zone pressure as EMW (a swabbed kick enters at pp = mw).
// Returns { kt, hmax, maasp, gradWeak, volBottom, volCirc, infinite }.
function _ktGasTolerance(o) {
  const Pfrac = o.fg * _KT_PPG * o.tvdWeak;               // fracture pressure at weak point (psig)
  const maasp = Pfrac - o.mw * _KT_PPG * o.tvdWeak - o.safetyPsi;   // adjusted/circulating MAASP
  const none = { kt: 0, hmax: 0, maasp: Math.round(maasp), gradWeak: 0, volBottom: 0, volCirc: 0, infinite: false };
  if (maasp <= 0) return none;

  // Influx density at the weak point (gas the weak point sees at Pfrac − safety)
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

  // Max allowable gas height (SPE-IADC 140113)
  const hmax = (maasp - _KT_PPG * (o.pp - o.mw) * o.tvdKick) / (_KT_PPG * (o.mw - rhoK));
  if (!(hmax > 0)) return { ...none, gradWeak };

  // Shut-in: gas at the bottom, hmax of height up from the bit (collars, then DP)
  const volBottom = _ktColumnVol(o.prof, hmax, true).vol;
  // Circulating: gas just below the weak point, converted to bottom-hole volume
  // via the density ratio
  const volCirc = _ktColumnVol(o.prof, hmax, false).vol * (denBottom > 0 ? denWeak / denBottom : 1);

  // Infinite if the gas column would extend above the weak point
  const infinite = hmax >= (o.tvdKick - o.tvdWeak);
  return { kt: Math.min(volBottom, volCirc), hmax, maasp: Math.round(maasp), gradWeak, volBottom, volCirc, infinite };
}

// Model inputs from the panel (display → imperial).
function _ktInputs() {
  const v = id => document.getElementById(id)?.value;
  const influxSel = v('ktInflux') || 'methane';
  const kiRaw = v('ktKickInt');
  return {
    safetyPsi: QP_UNITS.fromDisplay('press', +(v('ktSafety') || 100)),
    influxSel,
    influx: influxSel === 'methane' ? 'methane' : QP_UNITS.fromDisplay('pgrad', +(v('ktInfluxGrad') || 0.1)),
    kickInt: (kiRaw === '' || kiRaw == null) ? null : Math.max(0, QP_UNITS.fromDisplay('mw', +kiRaw)),
    minVol: QP_UNITS.fromDisplay('volume', +(v('ktMinVol') || 20)),
    thermal: (typeof qpThermal === 'function') ? qpThermal() : { surfT: 70, geoGrad: 1.5 },
  };
}

// Kick tolerance for every casing shoe (the conductor excluded). Each shoe is the
// top of the hole section drilled below it and is checked against THAT section:
// kick zone at the section's TD with the highest pore pressure in the interval
// (or the section mud weight + kick intensity), the section's own mud weight and
// hole size, the BHA with the bit at the section TD, and gas laid along the
// actual (deviated) hole. Two weak points: the shoe, and the weakest point of
// the open-hole interval (the one giving the lowest kick tolerance).
// Returns { results, inp } or { error }. All values imperial.
function ktComputeSections() {
  const survey  = (typeof qpState !== 'undefined' && qpState.survey) || [];
  const allRows = _readSchematicRows();
  const ppfgPts = _readPPFG();
  if (!ppfgPts.length) return { error: 'Add PPFG gradient points to the table' };

  const casingRows = allRows
    .filter(r => r.def !== 'Open Hole' && r.def !== 'Conductor' && +(r.bot || 0) > 0)  // no KT for the conductor
    .sort((a, b) => +(a.bot) - +(b.bot));
  if (!casingRows.length) return { error: 'Add casing strings in Well Schematic' };

  const inp     = _ktInputs();
  const tempR   = tvd => qpTempAt(tvd, inp.thermal) + 459.67;    // °F → °R
  const phases  = (typeof qpPhaseList === 'function') ? qpPhaseList() : [];
  const trajTD  = survey.length ? survey[survey.length - 1].md : 0;
  const baseMW  = ((typeof fluidBase === 'function') ? fluidBase() : fluidGet()).mudWeight || 10;

  const bha    = bhaGet();
  const dpOD   = bha.topDpOD_in || 5.0;
  const dcComps= (bha.components || []).filter(c => c.type === 'Drill Collar');
  const dcOD   = dcComps.length ? Math.max(...dcComps.map(c => +c.od || 0)) : (dpOD + 1.5);
  const dcLen  = dcComps.reduce((s, c) => s + (+c.lengthFt || 0), 0);

  const results = casingRows.map(row => {
    const shoeMD  = +(row.bot);
    const shoeTVD = _tvdAt(survey, shoeMD);
    const fgShoe  = _ppfgInterp(ppfgPts, shoeTVD, 'fg');
    const base    = { name: `${row.size}" ${row.def}`, shoeMD, shoeTVD, fgShoe };

    // The hole section drilled below this shoe (casing program), to the trajectory TD at most
    const ph   = phases.find(p => Math.abs(p.holeTop - shoeMD) < 0.5);
    const tdMD = ph ? (trajTD > 0 ? Math.min(ph.mdLimit, trajTD) : ph.mdLimit) : 0;
    if (!ph || !(tdMD > shoeMD + 1)) return { ...base, noSection: true };
    const tdTVD = _tvdAt(survey, tdMD);
    const dh    = ph.holeSize;
    const mw    = ((typeof fluidForSection === 'function') ? fluidForSection(ph.key).mudWeight : 0) || baseMW;

    const prof = _ktAnnulusProfile(survey, shoeMD, tdMD, dh, dpOD, dcOD, dcLen);
    const tvdLo = Math.min(...prof.map(p => p.tvd)), tvdHi = Math.max(...prof.map(p => p.tvd));

    // Highest pore pressure in the interval (piecewise linear: ends + breakpoints)
    const ppCand = [tvdLo, tvdHi, ...ppfgPts.map(p => p.tvd).filter(t => t > tvdLo && t < tvdHi)];
    const ppMax  = Math.max(...ppCand.map(t => _ppfgInterp(ppfgPts, t, 'pp')));
    const pp     = inp.kickInt != null ? mw + inp.kickInt : ppMax;
    const ppEff  = Math.max(pp, mw);              // swabbed kick (pp ≤ mw) enters at mw

    const calc = (i, fg) => _ktGasTolerance({
      mw, pp: ppEff, fg, tvdKick: tdTVD, tvdWeak: prof[i].tvd,
      tempKick_R: tempR(tdTVD), tempWeak_R: tempR(prof[i].tvd),
      safetyPsi: inp.safetyPsi, influx: inp.influx, prof: prof.slice(i) });
    const ktOf = g => g.infinite ? Infinity : g.kt;

    // Frac at the shoe
    const gasShoe = calc(0, fgShoe);
    // Weakest point of the open hole: the depth giving the lowest kick tolerance
    let wi = 0, gasWeak = gasShoe;
    for (let i = 1; i < prof.length - 1; i++) {
      if (i % 3 && i !== prof.length - 2) continue;          // every ~30 ft MD
      const g = calc(i, _ppfgInterp(ppfgPts, prof[i].tvd, 'fg'));
      if (ktOf(g) < ktOf(gasWeak) - 1e-6) { wi = i; gasWeak = g; }
    }
    const weakTVD = prof[wi].tvd;
    const ktGov   = Math.min(ktOf(gasShoe), ktOf(gasWeak));

    return { ...base, tdMD, tdTVD, dh, mw, ppMax, pp, swabbed: pp <= mw + _KT_PP_TOL,
             gasShoe, weakMD: prof[wi].md, weakTVD, fgWeak: _ppfgInterp(ppfgPts, weakTVD, 'fg'),
             weakIsShoe: wi === 0, gasWeak, ktGov, pass: ktGov >= inp.minVol };
  });
  return { results, inp };
}

function drawKickTolerance() {
  const survey  = (typeof qpState !== 'undefined' && qpState.survey) || [];
  const maxTVD  = survey.length ? survey[survey.length - 1].tvd : 10000;
  const mw      = ((typeof fluidBase === 'function') ? fluidBase() : fluidGet()).mudWeight || 10;   // well default (chart line)
  const el      = document.getElementById('ktMWdisplay');
  if (el) el.textContent = QP_UNITS.fmt('mw', mw);
  const uMWel = document.getElementById('ktMWunit');
  if (uMWel) uMWel.textContent = QP_UNITS.label('mw');
  const thEl = document.getElementById('ktThermalNote');
  if (thEl && typeof qpThermalText === 'function') thEl.textContent = qpThermalText();

  const out = ktComputeSections();
  _drawPPFGChart(_readPPFG(), mw, _readSchematicRows(), survey, maxTVD, out.results || []);

  const resultsDiv = document.getElementById('ktResultsDiv');
  if (!resultsDiv) return;
  if (out.error) {
    resultsDiv.innerHTML = `<p style="color:var(--text-dim);padding:8px 0">${out.error}</p>`;
    return;
  }
  _renderKTTable(out.results, out.inp);
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
  const tid = qpSaveTarget('ppfg');
  if (!tid) return;
  dbSaveScenarioData(tid, 'ppfg', _readPPFG());
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

function _drawPPFGChart(ppfgPts, mw, allRows, survey, maxTVD, results) {
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
    _lblQueue(`${row.size}"`, g.l, y, { dx: 2, dy: -12, pinX: true, color: ctx.fillStyle, font: ctx.font, bounds: g, dir: -1 });
  });

  // Weak points below the shoe (the open-hole depth giving the lowest KT)
  const wps = (results || []).filter(r => r.weakTVD != null && !r.weakIsShoe && r.weakTVD <= chartMaxTVDimp);
  wps.forEach(r => {
    const x = px(toG(r.fgWeak)), y = py(toD(r.weakTVD));
    ctx.fillStyle = '#e67e22';
    ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill();
    _lblReserve(x - 5, y - 5, 10, 10);
    _lblQueue(`WP ${r.name.split(' ')[0]}`, x, y, { dx: 7, dy: -6, color: '#e67e22', font: '9px sans-serif', bounds: g });
  });

  const lg = ['PP', 'FG', 'MW'], lc = ['#1a7a4a', '#c0392b', '#7a4aa0'];
  if (wps.length) { lg.push('Weak point'); lc.push('#e67e22'); }
  _legend(ctx, W, g.t, lg, lc);

  CI.drawAnnotations(ctx, 'ktCanvas');
}

// ── KT Results Table ──────────────────────────────────────────────────────────

function _renderKTTable(results, inp) {
  const div = document.getElementById('ktResultsDiv');
  if (!div) return;

  const dD = v => Math.round(QP_UNITS.toDisplay('depth', v)).toLocaleString();
  const dM = v => QP_UNITS.fmt('mw', v);
  const dP = v => Math.round(QP_UNITS.toDisplay('press', v)).toLocaleString();
  const dV = v => v === Infinity ? '∞' : QP_UNITS.fmt('volume', v);
  const uD = QP_UNITS.label('depth'), uMW = QP_UNITS.label('mw'),
        uP = QP_UNITS.label('press'), uV = QP_UNITS.label('volume');
  const ktTxt = g => g.infinite ? '∞' : dV(g.kt);
  const ktTip = g => g.infinite ? 'gas column reaches the weak point before MAASP is used'
    : `MAASP ${dP(g.maasp)} ${uP} · max gas height ${dD(g.hmax)} ${uD} TVD · shut-in ${dV(g.volBottom)} / circulating ${dV(g.volCirc)} ${uV}`;

  const calc = results.filter(r => !r.noSection);
  const gov  = calc.length ? calc.reduce((m, r) => (r.ktGov < m.ktGov ? r : m), calc[0]) : null;

  const rows = results.map(r => {
    if (r.noSection) return `<tr>
      <td>${r.name}</td><td style="text-align:right">${dD(r.shoeTVD)}</td>
      <td colspan="8" style="color:var(--text-dim)">no hole section below this shoe in the casing program</td></tr>`;
    const status = r.pass
      ? { txt: '✓ OK',        cls: 'color:#2aad6a;font-weight:bold' }
      : { txt: '✕ Below min', cls: 'color:#e05555;font-weight:bold' };
    const ppTip = inp.kickInt != null
      ? `MW ${dM(r.mw)} + kick intensity ${dM(inp.kickInt)} ${uMW} (highest PPFG pore pressure in the section: ${dM(r.ppMax)})`
      : `Highest pore pressure between the shoe and the section TD${r.swabbed ? ' — at or below MW: swabbed kick, enters at MW' : ''}`;
    const wp = r.weakIsShoe ? '<span style="color:var(--text-dim)">= shoe</span>'
      : `${dD(r.weakTVD)} / ${dM(r.fgWeak)}`;
    return `<tr>
      <td>${r.name}</td>
      <td style="text-align:right">${dD(r.shoeTVD)}</td>
      <td style="text-align:right" title="Section TD ${dD(r.tdMD)} ${uD} MD">${_qpFmtIn(r.dh)}" → ${dD(r.tdTVD)}</td>
      <td style="text-align:right">${dM(r.mw)}</td>
      <td style="text-align:right" title="${ppTip}">${dM(r.pp)}${inp.kickInt != null ? '*' : ''}</td>
      <td style="text-align:right">${dM(r.fgShoe)}</td>
      <td style="text-align:right;font-weight:bold" title="${ktTip(r.gasShoe)}">${ktTxt(r.gasShoe)}</td>
      <td style="text-align:right" title="Weakest point of the open hole (lowest kick tolerance): TVD / fracture gradient">${wp}</td>
      <td style="text-align:right;font-weight:bold" title="${ktTip(r.gasWeak)}">${r.weakIsShoe ? '<span style="color:var(--text-dim);font-weight:normal">—</span>' : ktTxt(r.gasWeak)}</td>
      <td style="${status.cls}">${status.txt}</td>
    </tr>`;
  }).join('');

  const influxNote = inp.influxSel === 'methane'
    ? 'methane, real gas (Hall-Yarborough Z, non-isothermal)'
    : 'fixed influx gradient';
  const ppNote = inp.kickInt != null
    ? `kick intensity ${dM(inp.kickInt)} ${uMW} over each section's MW (*)`
    : 'pore pressure from the PPFG table';

  div.innerHTML = `
    <div style="overflow-x:auto">
    <table class="qp-table" style="width:100%;font-size:11px">
      <thead>
        <tr>
          <th>Section</th>
          <th style="text-align:right">Shoe TVD (${uD})</th>
          <th style="text-align:right" title="Hole drilled below the shoe → section TD (TVD)">Hole → TD (${uD})</th>
          <th style="text-align:right">MW (${uMW})</th>
          <th style="text-align:right">PP (${uMW})</th>
          <th style="text-align:right">FG@shoe (${uMW})</th>
          <th style="text-align:right" title="Real-gas single bubble (SPE-IADC 140113), weak point at the shoe">KT@shoe (${uV})</th>
          <th style="text-align:right">Weak pt TVD / FG</th>
          <th style="text-align:right" title="Real-gas single bubble, weak point at the weakest open-hole depth">KT@weak pt (${uV})</th>
          <th>vs min ${dV(inp.minVol)} ${uV}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
    <p style="margin-top:8px;font-size:11px">
      <strong>Governing KT: ${gov ? `${dV(gov.ktGov)} ${uV} (${gov.name}) — ${gov.pass ? '<span style="color:#2aad6a">meets</span>' : '<span style="color:#e05555">below</span>'} the ${dV(inp.minVol)} ${uV} minimum` : '—'}</strong>
      &nbsp;·&nbsp; safety margin ${dP(inp.safetyPsi)} ${uP} &nbsp;·&nbsp; ${ppNote} &nbsp;·&nbsp; influx: ${influxNote}
      &nbsp;·&nbsp; T: ${typeof qpThermalText === 'function' ? qpThermalText() : ''}
    </p>
    <p style="margin-top:6px;font-size:10px;color:var(--text-dim);line-height:1.5">
      <strong>Per section</strong> — each shoe is checked against the hole drilled below it: kick at that
      section's TD with its highest pore pressure, its own mud weight (Fluid Program) and hole size, the
      bit at the section TD. <strong>Real-gas model</strong> — single bubble, KT = min(shut-in at the bottom,
      circulating at the weak point with density-ratio expansion); the gas height is laid along the actual
      hole (height ÷ cos inclination, horizontal hole adds volume), around drill pipe in the open hole and
      the collars below it. <strong>Caveats:</strong> one BHA for every section (only the hole size
      changes); two-section annulus (stabilisers collapse to the collar OD); static temperature profile.
      <strong>Influx:</strong> Methane models real-gas expansion (use for gas kicks); Fixed-gradient is
      incompressible (oil/liquid kicks of known gradient only).
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
  // On a non-imperial startup, convert the static HTML KT model-input defaults
  // (PPFG fields are already display-correct via ppfgAddRow above).
  if (QP_UNITS.get() !== 'imperial') _ktConvertInputs('imperial', QP_UNITS.get());
});
