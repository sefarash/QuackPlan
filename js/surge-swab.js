// ===== SURGE / SWAB =====
// Closed-pipe (Burkhardt) effective annular velocity → shared annular-loss model
// in rheology-engine.js (exact Herschel-Bulkley slot laminar solution, Bourgoyne
// annular Reynolds check, API RP 13D / Dodge–Metzner turbulent branch).
// surge = +ΔP tripping in, swab = −ΔP tripping out.
// Chart: ECD at Bottom [ppg] vs MD (ft) — depth-down, five speed curves,
//        surge fan (right) and swab fan (left) on the same axis.
// Reference cases + regression: `npm run test:surgeswab` (test/surge-swab-reference.mjs).

const SS_COLORS = ['#e74c3c', '#27ae60', '#2980b9', '#8bc34a', '#f0c040'];
let SS_SPEEDS = [20, 40, 60, 80, 100]; // updated by drawSurgeSwab() from speed inputs
const SS_CLING = 0.45;                  // Burkhardt mud-clinging constant, closed pipe

// ── Rheology ─────────────────────────────────────────────────────────────────
// Shared with Hydraulics: rheoParams() (rheology-engine.js) resolves the fluid
// form / fluid-program values for the SELECTED model into Herschel-Bulkley form
// (τ₀ lb/100ft², K lb·sⁿ/100ft², n) — Bingham → (YP, PV, 1), Power Law → (0, K, n)
// from nPL/kPL or the PV/YP dial-reading fit, HB → (τ₀, K, n) from the form.
function _ssRheology(fluid) {
  const r = rheoParams(fluid);
  return { ...r, label: rheoLabel(r) };
}

// ── Segment pressure loss ─────────────────────────────────────────────────────
// ΔP (psi) over L ft of annulus dh / pipe OD (in) with the closed-end pipe moving
// at v_ftmin. Returns { psi, turb, re }.
//   1. Burkhardt closed-pipe effective annular velocity (Bourgoyne eq. 4.94):
//      v̄e = v_pipe · (K_cling + A_p/A_a), K_cling = 0.45.
//   2. rheoAnnularGrad() (rheology-engine.js): exact HB slot laminar solution →
//      Bourgoyne annular Reynolds number → API 13D transition → Dodge–Metzner
//      turbulent gradient, monotonic in velocity.
function _ssSegLoss(v_ftmin, dh, dpOD, L, rheo) {
  if (L <= 0 || dh <= dpOD + 0.1) return { psi: 0, turb: false, re: 0 };
  const gap = dh - dpOD;
  const ve  = v_ftmin * (SS_CLING + (dpOD * dpOD) / (dh * dh - dpOD * dpOD)) / 60; // ft/s
  if (ve <= 0) return { psi: 0, turb: false, re: 0 };
  const r = rheoAnnularGrad(ve, gap, rheo);
  return { psi: r.grad * L, turb: r.turb, re: r.re };
}
function _ssSegPsi(v_ftmin, dh, dpOD, L, rheo) {   // scalar convenience (tests)
  return _ssSegLoss(v_ftmin, dh, dpOD, L, rheo).psi;
}

// ── String profile ────────────────────────────────────────────────────────────
// OD steps of the moving string measured UP from the bit: [{ od, from, to }]
// with from/to = distance above the bit (ft). Built from the BHA table
// (bit-first, as documented in the manual) with the top drill-pipe OD extending
// to surface; a uniform drill pipe when the table is empty. Bits at hole gauge
// contribute nothing (no annulus).
function _ssStringSteps(bha) {
  const dpOD  = bha.topDpOD_in ?? 5.0;
  const steps = [];
  let acc = 0;
  for (const c of (bha.components || [])) {
    if (c.type === 'Drill Pipe') continue;
    const len = +c.lengthFt || 0, od = +c.od || 0;
    if (len <= 0 || od <= 0) continue;
    steps.push({ od, from: acc, to: acc + len });
    acc += len;
  }
  steps.push({ od: dpOD, from: acc, to: Infinity });
  return steps;
}

// ── Geometry helper ───────────────────────────────────────────────────────────

function _ssGeom() {
  // Phase-aware: the active drilling stage's survey, fluid and hole configuration
  const survey = (typeof qpSurveyForAnalysis === 'function') ? qpSurveyForAnalysis() : qpState.survey;
  if (!survey || survey.length < 2) return null;
  const fluid   = (typeof qpPhaseFluid === 'function') ? qpPhaseFluid() : fluidGet();
  const bha     = bhaGet();
  const schRows = (typeof qpPhaseRows === 'function') ? qpPhaseRows()
                : (typeof _readSchematicRows === 'function' ? _readSchematicRows() : []);
  const mwFluid = fluid.mudWeight || 10;
  const rheo    = { ..._ssRheology(fluid), mw: mwFluid };
  const dpOD    = bha.topDpOD_in ?? 5.0;
  const steps   = _ssStringSteps(bha);
  const tdMD    = survey[survey.length - 1].md;

  // Build a NON-OVERLAPPING innermost-geometry profile vs MD. Schematic rows are
  // concentric strings whose MD ranges overlap (surface / intermediate /
  // production casing all start near 0) — the pipe only sees the INNERMOST
  // string at each depth. Summing every row (as before) counted the shallow
  // intervals 3–4× and wildly overstated surge/swab. WellPlan integrates over
  // the innermost wellbore diameter per depth; do the same via a boundary sweep.
  let segs = [];
  if (schRows.length) {
    const rows = schRows.map(r => ({
      top: +r.top || 0,
      bot: +r.bot || tdMD,
      // Open hole IS its drilled diameter; casing flow bore is its ID (from the
      // catalogue spec when present, else ≈ 0.88 × OD).
      id:  r.def === 'Open Hole' ? +r.size
         : (r.id_in ? +r.id_in : (+r.size * 0.88)),
    })).filter(r => r.bot > r.top && r.id > 0);
    const bounds = [...new Set(rows.flatMap(r => [r.top, r.bot]))].sort((a, b) => a - b);
    for (let i = 0; i < bounds.length - 1; i++) {
      const a = bounds[i], b = bounds[i + 1], mid = (a + b) / 2;
      const covering = rows.filter(r => r.top <= mid && mid < r.bot);
      if (!covering.length) continue;
      segs.push({ mdTop: a, mdBot: b, dh: Math.min(...covering.map(r => r.id)) });
    }
  }
  if (!segs.length) segs.push({ mdTop: 0, mdBot: tdMD, dh: 8.5 });
  return { survey, rheo, dpOD, steps, segs, mwFluid, rheoLabel: rheo.label };
}

// ── Per-station ECD profile ───────────────────────────────────────────────────
// Each survey station is treated as the bit depth: the string steps hang from
// st.md and the loss is summed over every (string step × hole segment) overlap
// between surface and the bit. `turb` marks stations where any segment left the
// laminar regime at this speed.
function _ssProfile(mwBase, speedFtMin, g = _ssGeom()) {
  if (!g) return null;
  const { survey, segs, steps, rheo } = g;
  const result = [];
  for (const st of survey) {
    if (st.tvd <= 0) {
      result.push({ md: st.md, tvd: 0, ecdSurge: mwBase, ecdSwab: mwBase, dp: 0, turb: false });
      continue;
    }
    let psi = 0, turb = false;
    for (const s of steps) {
      const elBot = st.md - s.from;                       // MD of this OD step's bottom
      const elTop = Math.max(st.md - s.to, 0);            // … and top (DP → surface)
      if (elBot <= elTop) continue;
      for (const seg of segs) {
        const top = Math.max(seg.mdTop, elTop), bot = Math.min(seg.mdBot, elBot);
        if (bot <= top) continue;
        const r = _ssSegLoss(speedFtMin, seg.dh, s.od, bot - top, rheo);
        psi += r.psi; turb = turb || r.turb;
      }
    }
    const delta = psi / (0.052 * st.tvd);
    result.push({ md: st.md, tvd: st.tvd, ecdSurge: mwBase + delta, ecdSwab: mwBase - delta, dp: psi, turb });
  }
  return result;
}

// ── Speed-limit interval tables ───────────────────────────────────────────────

function _ssIntervals(surgeProfs, swabProfs, ppfgPts, survey) {
  if (!ppfgPts || !ppfgPts.length) return null;
  const schRows = typeof _readSchematicRows === 'function' ? _readSchematicRows() : [];
  const shoes   = schRows
    .filter(r => r.def !== 'Open Hole' && +(r.bot || 0) > 0)
    .map(r => +(r.bot))
    .filter(md => md > 0);
  const tdMD = survey[survey.length - 1].md;
  const bounds = [...new Set([0, ...shoes, tdMD])].sort((a, b) => a - b);

  const inRows = [], outRows = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const fromMD = bounds[k], toMD = bounds[k + 1];
    const tvd    = _tvdAt(survey, toMD);
    if (tvd <= 0) continue;
    const fg = _ppfgInterp(ppfgPts, tvd, 'fg');
    const pp = _ppfgInterp(ppfgPts, tvd, 'pp');

    // Max surge speed: FASTEST tested speed whose ECD_surge stays ≤ FG at the
    // interval's deepest point. (Previously this broke on the first violating
    // speed and reported the next slower one WITHOUT checking it — if 80 and
    // 100 ft/min both violated, it reported 80 as safe.)
    let maxIn = 0;                                   // none pass → STOP
    for (let si = SS_SPEEDS.length - 1; si >= 0; si--) {
      const pt = surgeProfs[si].find(p => p.md >= toMD) || surgeProfs[si][surgeProfs[si].length - 1];
      if (pt.ecdSurge <= fg) {
        maxIn = (si === SS_SPEEDS.length - 1) ? 'N.R.' : SS_SPEEDS[si];
        break;
      }
    }
    // Max swab speed: FASTEST tested speed whose ECD_swab stays ≥ PP.
    let maxOut = 0;
    for (let si = SS_SPEEDS.length - 1; si >= 0; si--) {
      const pt = swabProfs[si].find(p => p.md >= toMD) || swabProfs[si][swabProfs[si].length - 1];
      if (pt.ecdSwab >= pp) {
        maxOut = (si === SS_SPEEDS.length - 1) ? 'N.R.' : SS_SPEEDS[si];
        break;
      }
    }
    inRows.push({ from: fromMD, to: toMD, maxSpeed: maxIn });
    outRows.push({ from: fromMD, to: toMD, maxSpeed: maxOut });
  }
  return { tripIn: inRows, tripOut: outRows };
}

// ── Draw one speed table on canvas ────────────────────────────────────────────

function _ssDrawTable(ctx, C, rows, reverse, x, y, title) {
  if (!rows || !rows.length) return;
  const display = reverse ? [...rows].reverse() : rows;
  const RH = 13, CW = [42, 42, 38];
  const TW  = CW.reduce((s, w) => s + w, 0) + 8;
  const TH  = RH * (display.length + 2) + 6;

  // Rows hold imperial values (ft, ft/min) — convert at render only
  const toD    = v => Math.round(QP_UNITS.toDisplay('depth', v)).toLocaleString();
  const metric = QP_UNITS.isMetric();
  const fmtSpd = v => metric ? (Math.round(QP_UNITS.toDisplay('speed', v) * 10) / 10) : v;

  ctx.fillStyle = 'rgba(20,30,45,0.82)';
  ctx.fillRect(x, y, TW, TH);

  ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillStyle = C.text;
  ctx.fillText(title, x + TW / 2, y + 2);

  ctx.font = '8px sans-serif';
  const hdrY = y + RH + 2;
  ctx.fillStyle = C.dim;
  ctx.fillText(`From ${QP_UNITS.label('depth')}`, x + 4 + CW[0] / 2, hdrY);
  ctx.fillText(`To ${QP_UNITS.label('depth')}`,   x + 4 + CW[0] + CW[1] / 2, hdrY);
  ctx.fillText(QP_UNITS.label('speed'),           x + 4 + CW[0] + CW[1] + CW[2] / 2, hdrY);

  display.forEach((row, i) => {
    const ry = hdrY + (i + 1) * RH;
    ctx.fillStyle = C.text;
    ctx.fillText(toD(row.from), x + 4 + CW[0] / 2, ry);
    ctx.fillText(toD(row.to),   x + 4 + CW[0] + CW[1] / 2, ry);
    if (row.maxSpeed === 'N.R.') {
      ctx.fillStyle = '#8bc34a';
      ctx.fillText('N.R.', x + 4 + CW[0] + CW[1] + CW[2] / 2, ry);
    } else if (row.maxSpeed === 0) {
      ctx.fillStyle = '#e05555';
      ctx.fillText('STOP', x + 4 + CW[0] + CW[1] + CW[2] / 2, ry);
    } else {
      const ci = SS_SPEEDS.indexOf(row.maxSpeed);
      ctx.fillStyle = ci >= 0 ? SS_COLORS[ci] : C.text;
      ctx.fillText(fmtSpd(row.maxSpeed), x + 4 + CW[0] + CW[1] + CW[2] / 2, ry);
    }
  });
}

// ── Main chart ────────────────────────────────────────────────────────────────

function drawSurgeSwab() {
  const CID = 'surgeSwabCanvas';
  const c = _chartSetup(CID);
  if (!c) return;
  const { ctx, W, H } = c;
  const C = _qpColors();

  const g = _ssGeom();
  if (!g) { _noData(ctx, W, H, 'Run Compute first'); return; }

  const survey = g.survey;
  const maxMD  = survey[survey.length - 1].md;
  const maxTVD = survey[survey.length - 1].tvd;

  // ── Display converters (engine stays imperial: ppg, ft, ft/min) ─────────────
  const toMW  = v => QP_UNITS.toDisplay('mw',    v);
  const toD   = v => QP_UNITS.toDisplay('depth', v);
  const toSpd = v => QP_UNITS.toDisplay('speed', v);
  const uMW   = QP_UNITS.label('mw');
  const uD    = QP_UNITS.label('depth');
  const uSpd  = QP_UNITS.label('speed');
  const metric = QP_UNITS.isMetric();
  const fmtEcd = v => metric ? v.toFixed(0) : v.toFixed(2);          // axis ticks (display units)
  const fmtSpd = v => metric ? (Math.round(toSpd(v) * 10) / 10) : v; // legend/table (display units)

  // ── Input values — speed fields are display units → imperial (empty falls
  //    back to the imperial HTML defaults un-converted) ────────────────────────
  const _vMinRaw = document.getElementById('ssSpeedMin')?.value;
  const _vMaxRaw = document.getElementById('ssSpeedMax')?.value;
  const vMin = Math.max(5,
    (_vMinRaw === '' || _vMinRaw == null) ? 20 : QP_UNITS.fromDisplay('speed', +_vMinRaw));
  const vMax = Math.max(vMin + 4,
    (_vMaxRaw === '' || _vMaxRaw == null) ? 100 : QP_UNITS.fromDisplay('speed', +_vMaxRaw));
  // 5 equal increments from vMin to vMax (imperial ft/min internally)
  SS_SPEEDS = Array.from({ length: 5 }, (_, i) => Math.round(vMin + i * (vMax - vMin) / 4));
  const mwBase   = g.mwFluid;
  const showPP   = document.getElementById('ssShowPP')?.checked;
  const showFP   = document.getElementById('ssShowFP')?.checked;
  const showData = document.getElementById('ssShowData')?.checked;

  // ── Compute profiles ──────────────────────────────────────────────────────────
  const surgeProfs = SS_SPEEDS.map(v => _ssProfile(mwBase, v, g));
  const swabProfs  = surgeProfs; // symmetric: same profiles for surge and swab
  if (!surgeProfs[0]) { _noData(ctx, W, H, 'Run Compute first'); return; }

  // ── Axis range ────────────────────────────────────────────────────────────────
  const ppfgPts = (typeof _readPPFG === 'function') ? _readPPFG() : [];
  let xMin = mwBase, xMax = mwBase;

  for (let si = 0; si < SS_SPEEDS.length; si++) {
    for (const pt of surgeProfs[si]) xMax = Math.max(xMax, pt.ecdSurge);
    for (const pt of swabProfs[si])  xMin = Math.min(xMin, pt.ecdSwab);
  }
  if (showPP && ppfgPts.length) {
    for (const pt of ppfgPts) xMin = Math.min(xMin, pt.pp - 0.1);
  }
  if (showFP && ppfgPts.length) {
    for (const pt of ppfgPts) xMax = Math.max(xMax, pt.fg + 0.1);
  }
  // Convert the axis range to display units, pad symmetrically, and round to a
  // unit-appropriate step (0.05 ppg / 5 kg/m³)
  let xMinD = toMW(xMin), xMaxD = toMW(xMax);
  const spanD = xMaxD - xMinD, stepD = metric ? 5 : 0.05;
  xMinD = Math.floor((xMinD - spanD * 0.06) / stepD) * stepD;
  xMaxD = Math.ceil( (xMaxD + spanD * 0.06) / stepD) * stepD;
  const yMaxD = toD(maxMD);

  // ── Layout ───────────────────────────────────────────────────────────────────
  // R must fit the right-hand TVD tick labels ("17,100" ≈ 40px) plus the rotated
  // axis title — 22px clipped/mangled them into the title.
  const L = 62, T = 78, R = 60, B = 36;
  const pw = W - L - R, ph = H - T - B;

  // Coordinate mappers (display units in, pixels out)
  const cx = ecdD => L + (ecdD - xMinD) / (xMaxD - xMinD) * pw;
  const cy = mdD  => T + (mdD  / yMaxD) * ph;

  // ── Grid ──────────────────────────────────────────────────────────────────────
  const N_X = 6, N_Y = 6;
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  for (let i = 0; i <= N_X; i++) {
    const ecdD = xMinD + (xMaxD - xMinD) * i / N_X;
    const gx   = cx(ecdD);
    ctx.beginPath(); ctx.moveTo(gx, T); ctx.lineTo(gx, T + ph); ctx.stroke();
    ctx.fillStyle = C.dim; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(fmtEcd(ecdD), gx, T + ph + 3);
    // Skip the top-axis label at the left corner — it collided with the MD "0" tick
    if (i > 0) {
      ctx.textBaseline = 'bottom';
      ctx.fillText(fmtEcd(ecdD), gx, T - 2);
    }
  }
  for (let i = 0; i <= N_Y; i++) {
    const mdImp = maxMD * i / N_Y;          // imperial for the survey lookup
    const gy    = cy(toD(mdImp));
    ctx.beginPath(); ctx.moveTo(L, gy); ctx.lineTo(L + pw, gy); ctx.stroke();
    ctx.fillStyle = C.dim; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(toD(mdImp)).toLocaleString(), L - 4, gy);
    // TVD labels on right
    const tvd = _tvdAt(survey, mdImp);
    ctx.textAlign = 'left';
    ctx.fillText(Math.round(toD(tvd)).toLocaleString(), L + pw + 4, gy);
  }
  ctx.strokeStyle = C.border; ctx.lineWidth = 1.5;
  ctx.strokeRect(L, T, pw, ph);

  // Axis titles
  ctx.fillStyle = C.text; ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(`ECD at Bottom [${uMW}]`, L + pw / 2, T + ph + 20);

  ctx.save();
  ctx.translate(12, T + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillStyle = C.text;
  ctx.fillText(`MD (${uD})`, 0, 0);
  ctx.restore();

  // Right axis label (TVD)
  ctx.save();
  ctx.translate(W - 10, T + ph / 2); ctx.rotate(Math.PI / 2);
  ctx.font = '10px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillStyle = C.dim;
  ctx.fillText(`TVD (${uD})`, 0, 0);
  ctx.restore();

  // ── CI storage — both fans, so freeze/tooltip see swab too (display coords) ─
  CI.storeLive(CID, SS_SPEEDS.flatMap((v, i) => [
    { pts: surgeProfs[i].map(pt => ({ x: toMW(pt.ecdSurge) - xMinD, y: toD(pt.md) })),
      color: SS_COLORS[i], label: `${fmtSpd(v)} ${uSpd} surge` },
    { pts: swabProfs[i].map(pt => ({ x: toMW(pt.ecdSwab) - xMinD, y: toD(pt.md) })),
      color: SS_COLORS[i], label: `${fmtSpd(v)} ${uSpd} swab` },
  ]));
  CI.register(CID, {
    pad: { l: L, t: T, pw, ph },
    xMax: xMaxD - xMinD, yMax: yMaxD,
    xLabel: `ECD (${uMW})`, yLabel: `MD (${uD})`,
    depthDown: true, xOffset: xMinD,
  });
  CI.drawFrozen(ctx, CID);

  // ── Clip to chart area ────────────────────────────────────────────────────────
  ctx.save();
  ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();

  // ── PP / FG profiles ──────────────────────────────────────────────────────────
  if (ppfgPts.length) {
    const drawGradLine = (field, color, show) => {
      if (!show) return;
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([6, 3]);
      ctx.beginPath();
      let first = true;
      for (const st of survey) {
        if (st.tvd <= 0) continue;
        const ecd = _ppfgInterp(ppfgPts, st.tvd, field);
        const x = cx(toMW(ecd)), y = cy(toD(st.md));
        first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        first = false;
      }
      ctx.stroke(); ctx.setLineDash([]);
    };
    drawGradLine('pp', '#e05555', showPP);
    drawGradLine('fg', '#2aad6a', showFP);
  }

  // ── MW reference line ─────────────────────────────────────────────────────────
  ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
  ctx.strokeStyle = '#7a4aa0';
  ctx.beginPath(); ctx.moveTo(cx(toMW(mwBase)), T); ctx.lineTo(cx(toMW(mwBase)), T + ph); ctx.stroke();
  ctx.setLineDash([]);

  // ── Speed curves ─────────────────────────────────────────────────────────────
  for (let si = 0; si < SS_SPEEDS.length; si++) {
    ctx.strokeStyle = SS_COLORS[si]; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';

    const drawCurve = (pts, field) => {
      ctx.beginPath();
      let first = true;
      for (const pt of pts) {
        const x = cx(toMW(pt[field])), y = cy(toD(pt.md));
        first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        first = false;
      }
      ctx.stroke();
    };
    drawCurve(surgeProfs[si], 'ecdSurge');
    drawCurve(swabProfs[si],  'ecdSwab');
  }

  ctx.restore(); // end clip

  // ── Speed tables (Show Data) ──────────────────────────────────────────────────
  if (showData) {
    const intervals = _ssIntervals(surgeProfs, swabProfs, ppfgPts, survey);
    if (intervals) {
      // Trip In: show deep-to-shallow (reverse)
      _ssDrawTable(ctx, C, intervals.tripIn,  true,  L + 4,              T + 4, 'Trip In');
      // Trip Out: show shallow-to-deep
      _ssDrawTable(ctx, C, intervals.tripOut, false, L + pw - 136,       T + 4, 'Trip Out');
    } else {
      ctx.fillStyle = C.dim; ctx.font = '9px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('Add PPFG data for speed tables', L + 6, T + 6);
    }
  }

  // ── Legend ────────────────────────────────────────────────────────────────────
  const lgW = SS_SPEEDS.length * 76;
  let lx = L + (pw - lgW) / 2;
  SS_SPEEDS.forEach((v, i) => {
    ctx.fillStyle = SS_COLORS[i];
    ctx.fillRect(lx, T - 22, 16, 4);
    ctx.fillStyle = C.text; ctx.font = '9px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`${fmtSpd(v)} ${uSpd}`, lx + 20, T - 20);
    lx += 76;
  });

  // ── Model caption ─────────────────────────────────────────────────────────────
  const turbAt = SS_SPEEDS.find((v, i) => surgeProfs[i].some(pt => pt.turb));
  ctx.fillStyle = C.dim; ctx.font = '9px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(`${g.rheoLabel} · closed-end string, K=${SS_CLING} · BHA steps from table · ` +
               (turbAt != null ? `turbulent annular flow from ${fmtSpd(turbAt)} ${uSpd}` : 'laminar throughout'),
               L + pw / 2, T - 38);

  CI.drawAnnotations(ctx, CID);
}

// ── Unit-label spans on the speed inputs ──────────────────────────────────────
// Field-value conversion on a unit toggle is handled centrally by
// output-controls.js (_OC_UNITS has ssSpeedMin/ssSpeedMax), which also redraws
// the active panel afterwards — this only relabels the spans.
function _ssUpdateControlLabels() {
  ['uSsSpeedMin', 'uSsSpeedMax'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = QP_UNITS.label('speed');
  });
}
document.addEventListener('DOMContentLoaded', _ssUpdateControlLabels);
if (typeof QP_UNITS !== 'undefined') QP_UNITS.onChange(_ssUpdateControlLabels);
