// ===== SURGE / SWAB =====
// Burkhardt clamp model: surge = +ΔP tripping in, swab = −ΔP tripping out
// Chart: ECD at Bottom [ppg] vs MD (ft) — depth-down, five speed curves,
//        surge fan (right) and swab fan (left) on the same axis

const SS_SPEEDS = [20, 40, 60, 80, 100]; // ft/min
const SS_COLORS = ['#e74c3c', '#27ae60', '#2980b9', '#8bc34a', '#f0c040'];

// ── Geometry helper ───────────────────────────────────────────────────────────

function _ssGeom() {
  const survey = qpState.survey;
  if (!survey || survey.length < 2) return null;
  const fluid   = fluidGet();
  const bha     = bhaGet();
  const schRows = typeof _readSchematicRows === 'function' ? _readSchematicRows() : [];
  const pv  = fluid.pv  || 16;
  const yp  = fluid.yp  || 13;
  const dpOD = bha.topDpOD_in ?? 5.0;
  let segs = [];
  if (schRows.length) {
    for (const row of schRows) {
      const id = row.id_in ? +row.id_in : (+row.size * 0.88);
      segs.push({ mdTop: +row.top || 0, mdBot: +row.bot || survey[survey.length - 1].md, dh: id });
    }
  } else {
    segs.push({ mdTop: 0, mdBot: survey[survey.length - 1].md, dh: 8.5 });
  }
  return { survey, pv, yp, dpOD, segs, mwFluid: fluid.mudWeight || 10 };
}

// ── Segment pressure (psi) ────────────────────────────────────────────────────

function _ssSegPsi(v_ftmin, dh, dpOD, pv, yp, L) {
  if (L <= 0 || dh <= dpOD + 0.1) return 0;
  // Clamp-model annular velocity (closed-end pipe, factor 0.45)
  const v_ann = (v_ftmin / 60) * (dpOD * dpOD) / (dh * dh - dpOD * dpOD) * 0.45; // ft/s
  if (v_ann <= 0) return 0;
  // Bingham effective viscosity
  const gap_in = (dh - dpOD) / 2;
  const mu_eff = pv + yp * gap_in / (300 * Math.max(v_ann, 0.001));
  // Laminar annular pressure gradient (psi/ft)
  const dP_ft = (mu_eff * v_ann * 144) / (1000 * (dh - dpOD) * (dh - dpOD));
  return Math.max(dP_ft * L, 0);
}

// ── Per-station ECD profile ───────────────────────────────────────────────────

function _ssProfile(mwBase, speedFtMin) {
  const g = _ssGeom();
  if (!g) return null;
  const { survey, pv, yp, dpOD, segs } = g;
  const result = [];
  for (const st of survey) {
    if (st.tvd <= 0) {
      result.push({ md: st.md, tvd: 0, ecdSurge: mwBase, ecdSwab: mwBase });
      continue;
    }
    let psi = 0;
    for (const seg of segs) {
      const top = Math.max(seg.mdTop, 0);
      const bot = Math.min(seg.mdBot, st.md);
      if (bot > top) psi += _ssSegPsi(speedFtMin, seg.dh, dpOD, pv, yp, bot - top);
    }
    const delta = psi / (0.052 * st.tvd);
    result.push({ md: st.md, tvd: st.tvd, ecdSurge: mwBase + delta, ecdSwab: mwBase - delta });
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

    // Max surge speed: highest speed where ECD_surge ≤ FG at deepest point
    let maxIn = 'N.R.';
    for (let si = SS_SPEEDS.length - 1; si >= 0; si--) {
      const pt = surgeProfs[si].find(p => p.md >= toMD) || surgeProfs[si][surgeProfs[si].length - 1];
      if (pt.ecdSurge > fg) { maxIn = si > 0 ? SS_SPEEDS[si - 1] : 0; break; }
    }
    // Max swab speed: highest speed where ECD_swab ≥ PP at deepest point
    let maxOut = 'N.R.';
    for (let si = SS_SPEEDS.length - 1; si >= 0; si--) {
      const pt = swabProfs[si].find(p => p.md >= toMD) || swabProfs[si][swabProfs[si].length - 1];
      if (pt.ecdSwab < pp) { maxOut = si > 0 ? SS_SPEEDS[si - 1] : 0; break; }
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

  ctx.fillStyle = 'rgba(20,30,45,0.82)';
  ctx.fillRect(x, y, TW, TH);

  ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillStyle = C.text;
  ctx.fillText(title, x + TW / 2, y + 2);

  ctx.font = '8px sans-serif';
  const hdrY = y + RH + 2;
  ctx.fillStyle = C.dim;
  ctx.fillText('From ft', x + 4 + CW[0] / 2, hdrY);
  ctx.fillText('To ft',   x + 4 + CW[0] + CW[1] / 2, hdrY);
  ctx.fillText('ft/min',  x + 4 + CW[0] + CW[1] + CW[2] / 2, hdrY);

  display.forEach((row, i) => {
    const ry = hdrY + (i + 1) * RH;
    ctx.fillStyle = C.text;
    ctx.fillText(Math.round(row.from).toLocaleString(), x + 4 + CW[0] / 2, ry);
    ctx.fillText(Math.round(row.to).toLocaleString(),   x + 4 + CW[0] + CW[1] / 2, ry);
    if (row.maxSpeed === 'N.R.') {
      ctx.fillStyle = '#8bc34a';
      ctx.fillText('N.R.', x + 4 + CW[0] + CW[1] + CW[2] / 2, ry);
    } else if (row.maxSpeed === 0) {
      ctx.fillStyle = '#e05555';
      ctx.fillText('STOP', x + 4 + CW[0] + CW[1] + CW[2] / 2, ry);
    } else {
      const ci = SS_SPEEDS.indexOf(row.maxSpeed);
      ctx.fillStyle = ci >= 0 ? SS_COLORS[ci] : C.text;
      ctx.fillText(row.maxSpeed, x + 4 + CW[0] + CW[1] + CW[2] / 2, ry);
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

  // ── Input values ─────────────────────────────────────────────────────────────
  const mwIn  = +(document.getElementById('ssMWin')?.value  || 0) || g.mwFluid;
  const mwOut = +(document.getElementById('ssMWout')?.value || 0) || g.mwFluid;
  const showPP   = document.getElementById('ssShowPP')?.checked;
  const showFP   = document.getElementById('ssShowFP')?.checked;
  const showData = document.getElementById('ssShowData')?.checked;

  // Update display labels in controls
  const elIn  = document.getElementById('ssMWin');
  const elOut = document.getElementById('ssMWout');
  if (elIn  && !elIn.value)  elIn.placeholder  = g.mwFluid.toFixed(1);
  if (elOut && !elOut.value) elOut.placeholder = g.mwFluid.toFixed(1);

  // ── Compute profiles ──────────────────────────────────────────────────────────
  const surgeProfs = SS_SPEEDS.map(v => _ssProfile(mwIn,  v));
  const swabProfs  = SS_SPEEDS.map(v => _ssProfile(mwOut, v));
  if (!surgeProfs[0]) { _noData(ctx, W, H, 'Run Compute first'); return; }

  // ── Axis range ────────────────────────────────────────────────────────────────
  const ppfgPts = (typeof _readPPFG === 'function') ? _readPPFG() : [];
  let xMin = Math.min(mwIn, mwOut), xMax = Math.max(mwIn, mwOut);

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
  // Symmetric padding, round to 0.05 increments
  const span = xMax - xMin;
  xMin = Math.floor((xMin - span * 0.06) * 20) / 20;
  xMax = Math.ceil( (xMax + span * 0.06) * 20) / 20;

  // ── Layout ───────────────────────────────────────────────────────────────────
  const L = 62, T = 78, R = 22, B = 36;
  const pw = W - L - R, ph = H - T - B;

  // Coordinate mappers
  const cx = ecd => L + (ecd - xMin) / (xMax - xMin) * pw;
  const cy = md  => T + (md  / maxMD) * ph;

  // ── Grid ──────────────────────────────────────────────────────────────────────
  const N_X = 6, N_Y = 6;
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  for (let i = 0; i <= N_X; i++) {
    const ecd = xMin + (xMax - xMin) * i / N_X;
    const gx  = cx(ecd);
    ctx.beginPath(); ctx.moveTo(gx, T); ctx.lineTo(gx, T + ph); ctx.stroke();
    ctx.fillStyle = C.dim; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(ecd.toFixed(2), gx, T + ph + 3);
    ctx.textBaseline = 'bottom';
    ctx.fillText(ecd.toFixed(2), gx, T - 2);
  }
  for (let i = 0; i <= N_Y; i++) {
    const md = maxMD * i / N_Y;
    const gy = cy(md);
    ctx.beginPath(); ctx.moveTo(L, gy); ctx.lineTo(L + pw, gy); ctx.stroke();
    ctx.fillStyle = C.dim; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(md).toLocaleString(), L - 4, gy);
    // TVD labels on right
    const tvd = _tvdAt(survey, md);
    ctx.textAlign = 'left';
    ctx.fillText(Math.round(tvd).toLocaleString(), L + pw + 4, gy);
  }
  ctx.strokeStyle = C.border; ctx.lineWidth = 1.5;
  ctx.strokeRect(L, T, pw, ph);

  // Axis titles
  ctx.fillStyle = C.text; ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('ECD at Bottom [ppg]', L + pw / 2, T + ph + 20);

  ctx.save();
  ctx.translate(12, T + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillStyle = C.text;
  ctx.fillText('MD (ft)', 0, 0);
  ctx.restore();

  // Right axis label (TVD)
  ctx.save();
  ctx.translate(W - 10, T + ph / 2); ctx.rotate(Math.PI / 2);
  ctx.font = '10px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillStyle = C.dim;
  ctx.fillText('TVD (ft)', 0, 0);
  ctx.restore();

  // ── CI storage ────────────────────────────────────────────────────────────────
  CI.storeLive(CID, SS_SPEEDS.map((v, i) => ({
    pts: surgeProfs[i].map(pt => ({ x: pt.ecdSurge - xMin, y: pt.md })),
    color: SS_COLORS[i], label: `${v} ft/min`,
  })));
  CI.register(CID, {
    pad: { l: L, t: T, pw, ph },
    xMax: xMax - xMin, yMax: maxMD,
    xLabel: 'ECD (ppg)', yLabel: 'MD (ft)',
    depthDown: true, xOffset: xMin,
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
        const x = cx(ecd), y = cy(st.md);
        first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        first = false;
      }
      ctx.stroke(); ctx.setLineDash([]);
    };
    drawGradLine('pp', '#e05555', showPP);
    drawGradLine('fg', '#2aad6a', showFP);
  }

  // ── MW reference lines ────────────────────────────────────────────────────────
  ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
  ctx.strokeStyle = '#2aad6a';
  ctx.beginPath(); ctx.moveTo(cx(mwIn), T); ctx.lineTo(cx(mwIn), T + ph); ctx.stroke();
  if (Math.abs(mwOut - mwIn) > 0.01) {
    ctx.strokeStyle = '#e05555';
    ctx.beginPath(); ctx.moveTo(cx(mwOut), T); ctx.lineTo(cx(mwOut), T + ph); ctx.stroke();
  }
  ctx.setLineDash([]);

  // ── Speed curves ─────────────────────────────────────────────────────────────
  for (let si = 0; si < SS_SPEEDS.length; si++) {
    ctx.strokeStyle = SS_COLORS[si]; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';

    const drawCurve = (pts, field) => {
      ctx.beginPath();
      let first = true;
      for (const pt of pts) {
        const x = cx(pt[field]), y = cy(pt.md);
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
    ctx.fillText(`${v} ft/min`, lx + 20, T - 20);
    lx += 76;
  });

  CI.drawAnnotations(ctx, CID);
}
