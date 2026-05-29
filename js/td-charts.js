// ===== T&D CHARTS =====
// drawTorque, drawBuckling, drawOverpull, drawBroomstick

const CHART_COLORS = { lo: '#2a7fa8', mid: '#f0a500', hi: '#c0392b' };
const CHART_PAD = { t: 62, b: 22, l: 70, r: 20 };

function _chartSetup(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  // Use rendered rect so each grid-cell canvas gets its own width
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  || canvas.parentElement.clientWidth  || 800;
  canvas.height = rect.height || canvas.parentElement.clientHeight || 500;
  const ctx = canvas.getContext('2d');
  const C = _qpColors();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { ctx, W: canvas.width, H: canvas.height, C };
}

function _chartGrid(ctx, W, H, xMax, yMax, xLabel, yLabel) {
  const { t, b, l, r } = CHART_PAD;
  const pw = W - l - r, ph = H - t - b;
  const C = _qpColors();

  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const x = l + pw * i / 5;
    const y = t + ph * i / 5;
    ctx.beginPath(); ctx.moveTo(x, t); ctx.lineTo(x, t + ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(l + pw, y); ctx.stroke();
    ctx.fillStyle = C.dim; ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText((xMax * i / 5).toFixed(0), x, t - 14);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText((yMax * (5 - i) / 5).toFixed(0), l - 5, y);
  }

  ctx.strokeStyle = C.border; ctx.lineWidth = 1.5;
  ctx.strokeRect(l, t, pw, ph);

  ctx.save();
  ctx.fillStyle = C.text; ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(xLabel, l + pw / 2, t - 30);
  ctx.translate(12, t + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle';
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  return { l, t, pw, ph };
}

function _chartLine(ctx, pts, color, lw, l, t, pw, ph, xMax, yMax) {
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = l + (p.x / xMax) * pw;
    const y = t + (1 - p.y / yMax) * ph;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ── Torque chart ──────────────────────────────────────────────────────────────
function drawTorque(r) {
  const CID = 'torqueCanvas';
  const c = _chartSetup(CID);
  if (!c) return;
  const { ctx, W, H } = c;

  const ffLo   = +(document.getElementById('torqFFlo')?.value  || 0.20);
  const ffMid  = +(document.getElementById('torqFFmid')?.value || 0.30);
  const ffHi   = +(document.getElementById('torqFFhi')?.value  || 0.40);
  const _wobRaw = document.getElementById('torqWOB')?.value;
  const wob    = (_wobRaw === '' || _wobRaw == null ? 15 : +_wobRaw) * 1000;
  const mutPct = +(document.getElementById('torqMUTpct')?.value || 100) / 100;

  const modes  = r.modes?.rotOn?.ffSensitivity;
  if (!modes) { _noData(ctx, W, H, 'Run Compute first'); return; }

  const bha = bhaGet();
  const makeFF = (ff) => {
    const res = tdCompute(qpState.survey, bha, null, fluidGet().mudWeight,
      { ffCased: ff, ffOpen: ff, wob_klbs: wob / 1000, overpullMargin_lbf: 100000 });
    return res?.modes?.rotOn?.ffSensitivity?.mid?.stations || [];
  };

  const stLo  = makeFF(ffLo);
  const stMid = makeFF(ffMid);
  const stHi  = makeFF(ffHi);

  const maxMD = qpState.survey[qpState.survey.length - 1].md;

  // Build MUT step segments — DP rows are listed surface→bit, so cumulative length = MD
  const mutSegs = [];
  if (mutPct > 0) {
    let cumMD = 0;
    bha.components.filter(c => c.type === 'Drill Pipe').forEach(dp => {
      if (dp.mut_ftlb > 0 && dp.lengthFt > 0) {
        mutSegs.push({
          topMD: cumMD,
          botMD: Math.min(cumMD + dp.lengthFt, maxMD),
          mutK:  dp.mut_ftlb * mutPct / 1000,
          label: `${dp.od}" MUT`,
        });
      }
      cumMD += dp.lengthFt;
    });
  }

  const mutMax = mutSegs.length ? Math.max(...mutSegs.map(s => s.mutK)) : 0;
  const xMax   = Math.max(...stHi.map(s => s.torque_ftlbs / 1000), mutMax, 1) * 1.1;

  const g = _chartGridDepthDown(ctx, W, H, xMax, maxMD, 'Torque (ft·lbs ×1000)', 'MD (ft)');

  const toLine = sts => sts.map(s => ({ x: s.torque_ftlbs / 1000, y: s.md }));
  const liveCurves = [
    { pts: toLine(stLo),  color: CHART_COLORS.lo,  label: 'FF ' + ffLo  },
    { pts: toLine(stMid), color: CHART_COLORS.mid, label: 'FF ' + ffMid },
    { pts: toLine(stHi),  color: CHART_COLORS.hi,  label: 'FF ' + ffHi  },
  ];
  CI.storeLive(CID, liveCurves);
  CI.register(CID, { pad: g, xMax, yMax: maxMD, xLabel: 'Torque (kft·lb)', yLabel: 'MD (ft)', depthDown: true });
  CI.drawFrozen(ctx, CID);

  _chartLineDepthDown(ctx, liveCurves[0].pts, CHART_COLORS.lo,  1.5, g, xMax, maxMD);
  _chartLineDepthDown(ctx, liveCurves[1].pts, CHART_COLORS.mid, 2,   g, xMax, maxMD);
  _chartLineDepthDown(ctx, liveCurves[2].pts, CHART_COLORS.hi,  1.5, g, xMax, maxMD);

  // MUT limit step-function: one vertical segment per DP section + horizontal connectors
  if (mutSegs.length) {
    ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    for (let i = 0; i < mutSegs.length; i++) {
      const seg = mutSegs[i];
      const x  = g.l + Math.min(seg.mutK / xMax, 1) * g.pw;
      const y0 = g.t + (seg.topMD / maxMD) * g.ph;
      const y1 = g.t + (seg.botMD / maxMD) * g.ph;
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
      if (i + 1 < mutSegs.length) {
        const xNext = g.l + Math.min(mutSegs[i + 1].mutK / xMax, 1) * g.pw;
        ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(xNext, y1); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    // Label each unique MUT value once, near the top of its first segment
    const seen = new Set();
    mutSegs.forEach(seg => {
      const key = seg.mutK.toFixed(1);
      if (seen.has(key)) return;
      seen.add(key);
      const x = g.l + Math.min(seg.mutK / xMax, 1) * g.pw;
      const y = g.t + (seg.topMD / maxMD) * g.ph + 4;
      ctx.fillStyle = '#c0392b'; ctx.font = '9px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(`${seg.label}: ${seg.mutK.toFixed(1)} k`, x + 3, y);
    });
  }

  const legendLabels  = ['FF '+ffLo, 'FF '+ffMid, 'FF '+ffHi];
  const legendColors  = [CHART_COLORS.lo, CHART_COLORS.mid, CHART_COLORS.hi];
  if (mutSegs.length) {
    legendLabels.push(`MUT ${Math.round(mutPct * 100)}%`);
    legendColors.push('#c0392b');
  }
  _legend(ctx, W, g.t, legendLabels, legendColors);
  CI.drawAnnotations(ctx, CID);
}

// ── Buckling chart ────────────────────────────────────────────────────────────
// Industry-standard signed axis: compression left (negative), tension right (+)
// Effective Axial Load runs from tension at surface into compression at depth.
// Buckling limits are plotted as negative thresholds — crossing = buckling.
function drawBuckling(r) {
  const CID = 'bucklingCanvas';
  const c = _chartSetup(CID);
  if (!c) return;
  const { ctx, W, H } = c;

  const _wobRaw  = document.getElementById('buckWOB')?.value;
  const wob_klbs = (_wobRaw === '' || _wobRaw == null ? 15 : +_wobRaw);
  const ffMid    = +(document.getElementById('buckFFmid')?.value || 0.30);
  const mw       = fluidGet().mudWeight;

  if (!qpState.survey?.length) { _noData(ctx, W, H, 'Run Compute first'); return; }

  const res = tdCompute(qpState.survey, bhaGet(), null, mw,
    { ffCased: ffMid, ffOpen: ffMid, wob_klbs, overpullMargin_lbf: 100000 });

  const bk = res?.buckling;
  if (!bk?.stations?.length) { _noData(ctx, W, H, 'Run Compute first'); return; }

  const rotAllSt   = res.modes?.rotOn?.ffSensitivity?.mid?.stations   || [];
  const slideAllSt = res.modes?.slideOn?.ffSensitivity?.mid?.stations || [];
  const maxMD      = qpState.survey[qpState.survey.length - 1].md;

  // Effective axial load — signed (+ tension, − compression)
  const rotPts   = rotAllSt.map(s   => ({ x: s.axialLoad_lbf / 1000, y: s.md }));
  const slidePts = slideAllSt.map(s => ({ x: s.axialLoad_lbf / 1000, y: s.md }));

  // Buckling limits on the compression (negative) side
  // null fSin/fHel = vertical section: limit is 0 (any compression buckles)
  const sinPts = bk.stations.map(s => ({ x: s.fSin_lbf != null ? -s.fSin_lbf / 1000 : 0, y: s.md }));
  const helPts = bk.stations.map(s => ({ x: s.fHel_lbf != null ? -s.fHel_lbf / 1000 : 0, y: s.md }));
  // Extend final segment to actual TD (bk.stations uses el.md0, one interval short of maxMD)
  const lastBk = bk.stations[bk.stations.length - 1];
  sinPts.push({ x: lastBk?.fSin_lbf != null ? -lastBk.fSin_lbf / 1000 : 0, y: maxMD });
  helPts.push({ x: lastBk?.fHel_lbf != null ? -lastBk.fHel_lbf / 1000 : 0, y: maxMD });

  // Scale X axis from axial load curves only — extreme BHA-clearance limit values
  // must not blow out the scale and hide the normal buildup/horizontal limits
  const axX  = [...rotPts, ...slidePts].map(p => p.x);
  const xMax = Math.max(...axX,  1) * 1.1;
  const xMin = Math.min(...axX, ...helPts.map(p => p.x), -1) * 1.1;
  const xRange = xMax - xMin;

  const g = _chartGridDepthDownSigned(ctx, W, H, xMin, xMax, maxMD, 'Axial Load (klbs)', 'MD (ft)');

  // CI expects x values mapped as (p.x / xMax_ci) * pw, so shift by xMin
  const shift = pts => pts.map(p => ({ x: p.x - xMin, y: p.y }));
  const liveCurves = [
    { pts: shift(sinPts),   color: '#e67e22', label: 'Sin. Limit'        },
    { pts: shift(helPts),   color: '#c0392b', label: 'Hel. Limit'        },
    { pts: shift(rotPts),   color: '#2a7fa8', label: 'Axial — Rotating'  },
    { pts: shift(slidePts), color: '#7f8c8d', label: 'Axial — Sliding'   },
  ];
  CI.storeLive(CID, liveCurves);
  CI.register(CID, { pad: g, xMax: xRange, yMax: maxMD,
    xLabel: 'Axial Load (klbs)', yLabel: 'MD (ft)', depthDown: true, xOffset: xMin });
  CI.drawFrozen(ctx, CID);

  // Clip all curves to chart area so extreme BHA-section values don't overflow
  ctx.save();
  ctx.beginPath(); ctx.rect(g.l, g.t, g.pw, g.ph); ctx.clip();

  // Sinusoidal limit — orange
  _chartLineDepthDownSigned(ctx, sinPts,   '#e67e22', 1.5, g, xMin, xMax, maxMD);
  // Helical limit — red
  _chartLineDepthDownSigned(ctx, helPts,   '#c0392b', 1.5, g, xMin, xMax, maxMD);
  // Sliding axial load — gray dashed
  ctx.setLineDash([6, 3]);
  _chartLineDepthDownSigned(ctx, slidePts, '#7f8c8d', 1.5, g, xMin, xMax, maxMD);
  ctx.setLineDash([]);
  // Rotating axial load — blue solid
  _chartLineDepthDownSigned(ctx, rotPts,   '#2a7fa8', 2,   g, xMin, xMax, maxMD);

  ctx.restore();

  _legend(ctx, W, g.t,
    ['Sin. Limit', 'Hel. Limit', 'Axial — Rotating', 'Axial — Sliding (dashed)'],
    ['#e67e22', '#c0392b', '#2a7fa8', '#7f8c8d']);
  CI.drawAnnotations(ctx, CID);
}

// ── Overpull chart — Slack-off (left) / Pick-up (right) split ─────────────────
function drawOverpull(r) {
  const CID = 'overpullCanvas';
  const c = _chartSetup(CID);
  if (!c) return;
  const { ctx, W, H } = c;

  const blockWt  = +(document.getElementById('ovpBlock')?.value    || 35);
  const dpWt     = +(document.getElementById('ovpDPwt')?.value     || 19.5);
  const ffLo     = +(document.getElementById('ovpFFlo')?.value     || 0.20);
  const ffMid    = +(document.getElementById('ovpFFmid')?.value    || 0.30);
  const ffHi     = +(document.getElementById('ovpFFhi')?.value     || 0.40);
  const mw       = +(document.getElementById('ovpMW')?.value       || fluidGet().mudWeight);
  const yieldPct = +(document.getElementById('ovpYieldPct')?.value || 100) / 100;
  const BF       = 1 - mw / 65.5;

  const bha = bhaGet();
  const run = ff => tdCompute(qpState.survey, bha, null, mw,
    { ffCased: ff, ffOpen: ff, wob_klbs: 15, dpWt_ppf: dpWt, overpullMargin_lbf: 100000 });

  const resLo  = run(ffLo);
  const resMid = run(ffMid);
  const resHi  = run(ffHi);
  if (!resMid) { _noData(ctx, W, H, 'Run Compute first'); return; }

  const get = (res, mode) => res?.modes?.[mode]?.ffSensitivity?.mid?.stations || [];
  const freeWt  = get(resMid, 'rotOff');
  const poohLo  = get(resLo,  'pooh');
  const poohMid = get(resMid, 'pooh');
  const poohHi  = get(resHi,  'pooh');

  const maxMD = qpState.survey[qpState.survey.length - 1].md;
  const toV   = s => s.axialLoad_lbf / 1000 + blockWt;

  // Build tensile yield step segments — DP rows listed surface→bit
  const yieldSegs = [];
  if (yieldPct > 0) {
    let cumMD = 0;
    bha.components.filter(c => c.type === 'Drill Pipe').forEach(dp => {
      if (dp.tensYield_lbs > 0 && dp.lengthFt > 0) {
        yieldSegs.push({
          topMD:  cumMD,
          botMD:  Math.min(cumMD + dp.lengthFt, maxMD),
          yieldK: dp.tensYield_lbs * yieldPct / 1000 + blockWt,
          label:  `${dp.od}" Yield`,
        });
      }
      cumMD += dp.lengthFt;
    });
  }

  const yieldMax = yieldSegs.length ? Math.max(...yieldSegs.map(s => s.yieldK)) : 0;
  const xMax = Math.max(...poohHi.map(toV), ...freeWt.map(toV), yieldMax, 1) * 1.1;

  const g = _chartGridDepthDown(ctx, W, H, xMax, maxMD, 'Hook Load (klbs)', 'MD (ft)');

  ctx.fillStyle = _qpColors().dim; ctx.font = '9px sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText(`BF=${BF.toFixed(3)}  MW=${mw.toFixed(1)} ppg  Block=${blockWt} klbs`, g.l + g.pw - 4, g.t + g.ph - 4);

  const toLine = sts => sts.map(s => ({ x: toV(s), y: s.md }));
  const liveCurves = [
    { pts: toLine(freeWt),  color: '#7f8c8d', label: 'Free Wt'         },
    { pts: toLine(poohLo),  color: '#e07878', label: `PKP FF ${ffLo}`  },
    { pts: toLine(poohMid), color: '#c0392b', label: `PKP FF ${ffMid}` },
    { pts: toLine(poohHi),  color: '#8b1a1a', label: `PKP FF ${ffHi}`  },
  ];
  CI.storeLive(CID, liveCurves);
  CI.register(CID, { pad: g, xMax, yMax: maxMD, xLabel: 'Hook Load (klbs)', yLabel: 'MD (ft)', depthDown: true });
  CI.drawFrozen(ctx, CID);

  // Free weight: gray long-dash
  ctx.setLineDash([8, 4]);
  _chartLineDepthDown(ctx, liveCurves[0].pts, '#7f8c8d', 1.5, g, xMax, maxMD);

  // Pick-up (POOH): lo/hi dashed, mid solid
  ctx.setLineDash([5, 3]);
  _chartLineDepthDown(ctx, liveCurves[1].pts, '#e07878', 1.5, g, xMax, maxMD);
  ctx.setLineDash([]);
  _chartLineDepthDown(ctx, liveCurves[2].pts, '#c0392b', 2,   g, xMax, maxMD);
  ctx.setLineDash([5, 3]);
  _chartLineDepthDown(ctx, liveCurves[3].pts, '#8b1a1a', 1.5, g, xMax, maxMD);
  ctx.setLineDash([]);

  // Tensile yield limit step-function
  if (yieldSegs.length) {
    const YIELD_CLR = '#922b21';
    ctx.strokeStyle = YIELD_CLR; ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    for (let i = 0; i < yieldSegs.length; i++) {
      const seg = yieldSegs[i];
      const x  = g.l + Math.min(seg.yieldK / xMax, 1) * g.pw;
      const y0 = g.t + (seg.topMD / maxMD) * g.ph;
      const y1 = g.t + (seg.botMD / maxMD) * g.ph;
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
      if (i + 1 < yieldSegs.length) {
        const xNext = g.l + Math.min(yieldSegs[i + 1].yieldK / xMax, 1) * g.pw;
        ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(xNext, y1); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    const seen = new Set();
    yieldSegs.forEach(seg => {
      const key = seg.yieldK.toFixed(0);
      if (seen.has(key)) return;
      seen.add(key);
      const x = g.l + Math.min(seg.yieldK / xMax, 1) * g.pw;
      const y = g.t + (seg.topMD / maxMD) * g.ph + 4;
      ctx.fillStyle = YIELD_CLR; ctx.font = '9px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(`${seg.label}: ${seg.yieldK.toFixed(0)} k`, x + 3, y);
    });
  }

  const legendLabels = ['Free Wt', `PKP ${ffLo}`, `PKP ${ffMid}`, `PKP ${ffHi}`];
  const legendColors = ['#7f8c8d', '#e07878', '#c0392b', '#8b1a1a'];
  if (yieldSegs.length) {
    legendLabels.push(`Yield ${Math.round(yieldPct * 100)}%`);
    legendColors.push('#922b21');
  }
  _legend(ctx, W, g.t, legendLabels, legendColors);
  CI.drawAnnotations(ctx, CID);
}

// ── Broomstick chart ──────────────────────────────────────────────────────────
// Y-axis: depth increases DOWNWARD (surface at top, TD at bottom)
function drawBroomstick(r) {
  const CID = 'broomstickCanvas';
  const c = _chartSetup(CID);
  if (!c) return;
  const { ctx, W, H } = c;

  const blockWt = +(document.getElementById('bsBlock')?.value  || 35);
  const dpWt  = +(document.getElementById('bsDPwt')?.value  || 22.5);
  const ffLo  = +(document.getElementById('bsFFlo')?.value  || 0.20);
  const ffMid = +(document.getElementById('bsFFmid')?.value || 0.30);
  const ffHi  = +(document.getElementById('bsFFhi')?.value  || 0.40);
  const mw    = +(document.getElementById('bsMW')?.value    || fluidGet().mudWeight || 10.0);
  const BF    = 1 - mw / 65.5;

  // 3 runs: FF lo/mid/hi at single MW and DP weight
  const run = ff => tdCompute(qpState.survey, bhaGet(), null, mw,
    { ffCased: ff, ffOpen: ff, wob_klbs: 25, dpWt_ppf: dpWt, overpullMargin_lbf: 100000 });

  const resLo  = run(ffLo);
  const resMid = run(ffMid);
  const resHi  = run(ffHi);
  if (!resMid) { _noData(ctx, W, H, 'Run Compute first'); return; }

  const st = (res, mode) => res?.modes?.[mode]?.ffSensitivity?.mid?.stations || [];

  const rihLo  = st(resLo,  'rih');
  const rihMid = st(resMid, 'rih');
  const rihHi  = st(resHi,  'rih');
  const rotOff = st(resMid, 'rotOff');
  const poohLo = st(resLo,  'pooh');
  const poohMid= st(resMid, 'pooh');
  const poohHi = st(resHi,  'pooh');

  const maxMD = qpState.survey[qpState.survey.length - 1].md;

  // Broomstick hookload when bit is at depth D:
  //   = blockWt + accumulated (weight ± friction) from surface down to D
  //   = blockWt + surfaceLoad − axialLoad(D)
  // where surfaceLoad = axialLoad at the surface station (min MD).
  // Result: all curves start at blockWt at surface and fan out with depth.
  const surfLoad_klbs = sts => {
    if (!sts.length) return 0;
    const surf = sts.reduce((mn, s) => s.md < mn.md ? s : mn, sts[0]);
    return surf.axialLoad_lbf / 1000;
  };
  const toBS = (sl, s) => Math.max(0, blockWt + sl - s.axialLoad_lbf / 1000);
  const toBSLine = (sl, sts) => sts.map(s => ({ x: toBS(sl, s), y: s.md }));

  const slRihLo   = surfLoad_klbs(rihLo);
  const slRihMid  = surfLoad_klbs(rihMid);
  const slRihHi   = surfLoad_klbs(rihHi);
  const slRotOff  = surfLoad_klbs(rotOff);
  const slPoohLo  = surfLoad_klbs(poohLo);
  const slPoohMid = surfLoad_klbs(poohMid);
  const slPoohHi  = surfLoad_klbs(poohHi);

  const liveCurves = [
    { pts: toBSLine(slRihLo,   rihLo),  color: '#5a9fd4', label: `RIH FF ${ffLo}`  },
    { pts: toBSLine(slRihMid,  rihMid), color: '#2a7fa8', label: `RIH FF ${ffMid}` },
    { pts: toBSLine(slRihHi,   rihHi),  color: '#1a5f88', label: `RIH FF ${ffHi}`  },
    { pts: toBSLine(slRotOff,  rotOff), color: '#8e44ad', label: 'Rot Off Btm'     },
    { pts: toBSLine(slPoohLo,  poohLo), color: '#e07878', label: `PKP FF ${ffLo}`  },
    { pts: toBSLine(slPoohMid, poohMid),color: '#c0392b', label: `PKP FF ${ffMid}` },
    { pts: toBSLine(slPoohHi,  poohHi), color: '#8b1a1a', label: `PKP FF ${ffHi}`  },
  ];

  const xMax = Math.max(...liveCurves.flatMap(c => c.pts.map(p => p.x)), 1) * 1.1;

  const g = _chartGridDepthDown(ctx, W, H, xMax, maxMD, 'Hookload (kips)', 'MD (ft)');

  ctx.fillStyle = _qpColors().dim; ctx.font = '9px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(`BF=${BF.toFixed(3)}  MW=${mw.toFixed(1)} ppg  Block=${blockWt} kips`,
    g.l + 4, g.t + 4);

  CI.storeLive(CID, liveCurves);
  CI.register(CID, { pad: g, xMax, yMax: maxMD, xLabel: 'Hookload (kips)', yLabel: 'MD (ft)', depthDown: true });
  CI.drawFrozen(ctx, CID);

  // RIH — lo/hi dashed, mid solid (blue)
  ctx.setLineDash([5, 3]);
  _chartLineDepthDown(ctx, liveCurves[0].pts, '#5a9fd4', 1.5, g, xMax, maxMD);
  ctx.setLineDash([]);
  _chartLineDepthDown(ctx, liveCurves[1].pts, '#2a7fa8', 2,   g, xMax, maxMD);
  ctx.setLineDash([5, 3]);
  _chartLineDepthDown(ctx, liveCurves[2].pts, '#1a5f88', 1.5, g, xMax, maxMD);
  ctx.setLineDash([]);
  // Rotation Off Bottom (single curve, purple)
  _chartLineDepthDown(ctx, liveCurves[3].pts, '#8e44ad', 1.5, g, xMax, maxMD);
  // POOH — lo/hi dashed, mid solid (red)
  ctx.setLineDash([5, 3]);
  _chartLineDepthDown(ctx, liveCurves[4].pts, '#e07878', 1.5, g, xMax, maxMD);
  ctx.setLineDash([]);
  _chartLineDepthDown(ctx, liveCurves[5].pts, '#c0392b', 2,   g, xMax, maxMD);
  ctx.setLineDash([5, 3]);
  _chartLineDepthDown(ctx, liveCurves[6].pts, '#8b1a1a', 1.5, g, xMax, maxMD);
  ctx.setLineDash([]);

  _legend(ctx, W, g.t,
    [`RIH ${ffLo}`, `RIH ${ffMid}`, `RIH ${ffHi}`,
     'Rot Off Btm',
     `PKP ${ffLo}`, `PKP ${ffMid}`, `PKP ${ffHi}`],
    ['#5a9fd4', '#2a7fa8', '#1a5f88',
     '#8e44ad',
     '#e07878', '#c0392b', '#8b1a1a']);

  // ── Chart section labels ──────────────────────────────────────────────────
  const pw = g.pw, ph = g.ph;
  const labelMidY = g.t + ph * 0.65;

  ctx.fillStyle = _qpColors().text; ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('Slack off', g.l + 6, labelMidY);

  ctx.textAlign = 'right';
  ctx.fillText('Pick up', g.l + pw - 6, labelMidY);

  const rotMidSt = rotOff[Math.floor(rotOff.length / 2)];
  if (rotMidSt) {
    const xRot = g.l + (toBS(slRotOff, rotMidSt) / xMax) * pw;
    ctx.fillStyle = '#8e44ad'; ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('Rotation', xRot + 4, labelMidY + 20);
    ctx.fillText('Off Bottom', xRot + 4, labelMidY + 32);
  }

  // ── Bottom FF labels at TD depth (where curves fan out most) ─────────────
  const tdHL = (sl, sts) => {
    if (!sts.length) return 0;
    const td = sts.reduce((mx, s) => s.md > mx.md ? s : mx, sts[0]);
    return toBS(sl, td);
  };
  const labelY = g.t + ph + 16;
  ctx.font = '9px sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
  [
    [slRihHi,   rihHi,   ffHi,  '#1a5f88'],
    [slRihMid,  rihMid,  ffMid, '#2a7fa8'],
    [slRihLo,   rihLo,   ffLo,  '#5a9fd4'],
    [slPoohLo,  poohLo,  ffLo,  '#e07878'],
    [slPoohMid, poohMid, ffMid, '#c0392b'],
    [slPoohHi,  poohHi,  ffHi,  '#8b1a1a'],
  ].forEach(([sl, sts, ff, color]) => {
    if (!sts.length) return;
    ctx.fillStyle = color;
    ctx.fillText(`${ff}FF`, g.l + (tdHL(sl, sts) / xMax) * pw, labelY);
  });

  CI.drawAnnotations(ctx, CID);
}

function _chartGridDepthDown(ctx, W, H, xMax, yMax, xLabel, yLabel) {
  const { t, b, l, r } = CHART_PAD;
  const pw = W - l - r, ph = H - t - b;
  const C = _qpColors();

  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const x = l + pw * i / 5;
    const y = t + ph * i / 5;
    ctx.beginPath(); ctx.moveTo(x, t); ctx.lineTo(x, t + ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(l + pw, y); ctx.stroke();
    ctx.fillStyle = C.dim; ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText((xMax * i / 5).toFixed(0), x, t - 14);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText((yMax * i / 5).toFixed(0), l - 5, y);
  }

  ctx.strokeStyle = C.border; ctx.lineWidth = 1.5;
  ctx.strokeRect(l, t, pw, ph);

  ctx.save();
  ctx.fillStyle = C.text; ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(xLabel, l + pw / 2, t - 30);
  ctx.translate(12, t + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle';
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  return { l, t, pw, ph };
}

function _chartLineDepthDown(ctx, pts, color, lw, g, xMax, yMax) {
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = g.l + (p.x / xMax) * g.pw;
    const y = g.t + (p.y / yMax) * g.ph;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// Signed x-axis variant: xMin may be negative (compression left, tension right)
function _chartGridDepthDownSigned(ctx, W, H, xMin, xMax, yMax, xLabel, yLabel) {
  const { t, b, l, r } = CHART_PAD;
  const pw = W - l - r, ph = H - t - b;
  const xRange = xMax - xMin;
  const C = _qpColors();

  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const x = l + pw * i / 5;
    const y = t + ph * i / 5;
    ctx.beginPath(); ctx.moveTo(x, t); ctx.lineTo(x, t + ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(l + pw, y); ctx.stroke();
    ctx.fillStyle = C.dim; ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText((xMin + xRange * i / 5).toFixed(0), x, t - 14);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText((yMax * i / 5).toFixed(0), l - 5, y);
  }

  if (xMin < 0 && xMax > 0) {
    const xZero = l + (-xMin / xRange) * pw;
    ctx.strokeStyle = C.dim; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(xZero, t); ctx.lineTo(xZero, t + ph); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.dim; ctx.font = '9px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('0', xZero, t - 3);
  }

  ctx.strokeStyle = C.border; ctx.lineWidth = 1.5;
  ctx.strokeRect(l, t, pw, ph);

  ctx.save();
  ctx.fillStyle = C.text; ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(xLabel, l + pw / 2, t - 30);
  ctx.translate(12, t + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle';
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  return { l, t, pw, ph };
}

function _chartLineDepthDownSigned(ctx, pts, color, lw, g, xMin, xMax, yMax) {
  const xRange = xMax - xMin;
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = g.l + ((p.x - xMin) / xRange) * g.pw;
    const y = g.t + (p.y / yMax) * g.ph;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _legend(ctx, W, t, labels, colors) {
  const C = _qpColors();
  let x = W - CHART_PAD.r - labels.reduce((s, l) => s + l.length * 7 + 24, 0);
  labels.forEach((lbl, i) => {
    ctx.fillStyle   = colors[i];
    ctx.fillRect(x, t + 4, 14, 4);
    ctx.fillStyle   = C.text;
    ctx.font        = '10px sans-serif';
    ctx.textAlign   = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(lbl, x + 18, t + 6);
    x += lbl.length * 7 + 24;
  });
}

function _noData(ctx, W, H, msg) {
  ctx.fillStyle = _qpColors().dim; ctx.font = '13px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(msg, W / 2, H / 2);
}
