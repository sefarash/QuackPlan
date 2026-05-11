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
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { ctx, W: canvas.width, H: canvas.height };
}

function _chartGrid(ctx, W, H, xMax, yMax, xLabel, yLabel) {
  const { t, b, l, r } = CHART_PAD;
  const pw = W - l - r, ph = H - t - b;

  ctx.strokeStyle = '#e8f0f5'; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const x = l + pw * i / 5;
    const y = t + ph * i / 5;
    ctx.beginPath(); ctx.moveTo(x, t); ctx.lineTo(x, t + ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(l + pw, y); ctx.stroke();
    ctx.fillStyle = '#5a7a8e'; ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText((xMax * i / 5).toFixed(0), x, t - 14);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText((yMax * (5 - i) / 5).toFixed(0), l - 5, y);
  }

  ctx.strokeStyle = '#9ecce3'; ctx.lineWidth = 1.5;
  ctx.strokeRect(l, t, pw, ph);

  ctx.save();
  ctx.fillStyle = '#1a2b38'; ctx.font = 'bold 11px sans-serif';
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

  const ffLo  = +(document.getElementById('torqFFlo')?.value  || 0.20);
  const ffMid = +(document.getElementById('torqFFmid')?.value || 0.30);
  const ffHi  = +(document.getElementById('torqFFhi')?.value  || 0.40);
  const _wobRaw = document.getElementById('torqWOB')?.value;
  const wob   = (_wobRaw === '' || _wobRaw == null ? 15 : +_wobRaw) * 1000;

  const modes  = r.modes?.rotOn?.ffSensitivity;
  if (!modes) { _noData(ctx, W, H, 'Run Compute first'); return; }

  const makeFF = (ff) => {
    const res = tdCompute(qpState.survey, bhaGet(), null, fluidGet().mudWeight,
      { ffCased: ff, ffOpen: ff, wob_klbs: wob / 1000, overpullMargin_lbf: 100000 });
    return res?.modes?.rotOn?.ffSensitivity?.mid?.stations || [];
  };

  const stLo  = makeFF(ffLo);
  const stMid = makeFF(ffMid);
  const stHi  = makeFF(ffHi);

  const maxMD   = qpState.survey[qpState.survey.length - 1].md;
  const xMax    = Math.max(...stHi.map(s => s.torque_ftlbs / 1000), 1) * 1.1;

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

  _legend(ctx, W, g.t, ['FF '+ffLo, 'FF '+ffMid, 'FF '+ffHi],
    [CHART_COLORS.lo, CHART_COLORS.mid, CHART_COLORS.hi]);
  CI.drawAnnotations(ctx, CID);
}

// ── Buckling chart ────────────────────────────────────────────────────────────
function drawBuckling(r) {
  const CID = 'bucklingCanvas';
  const c = _chartSetup(CID);
  if (!c) return;
  const { ctx, W, H } = c;

  const bk = r.buckling;
  if (!bk?.stations?.length) { _noData(ctx, W, H, 'Run Compute first'); return; }

  // Sliding (rotOff) compressive loads for comparison
  const rotOffSt = r.modes?.rotOff?.ffSensitivity?.mid?.stations || [];
  const slidePts = rotOffSt.map(s => ({ x: Math.max(-s.axialLoad_lbf, 0) / 1000, y: s.md }));

  const maxMD = Math.max(...bk.stations.map(s => s.md), 1);
  const xMax  = Math.max(
    ...bk.stations.map(s => Math.max(s.fSin_lbf || 0, s.fHel_lbf || 0, -s.axialLoad_lbf || 0)),
    ...rotOffSt.map(s => Math.max(-s.axialLoad_lbf, 0)),
    1
  ) / 1000 * 1.1;

  const g = _chartGridDepthDown(ctx, W, H, xMax, maxMD, 'Critical Load (klbs)', 'MD (ft)');

  const sinPts   = bk.stations.filter(s => s.fSin_lbf != null)
                               .map(s => ({ x: s.fSin_lbf / 1000, y: s.md }));
  const helPts   = bk.stations.filter(s => s.fHel_lbf != null)
                               .map(s => ({ x: s.fHel_lbf / 1000, y: s.md }));
  const rotPts   = bk.stations.map(s => ({ x: Math.max(-s.axialLoad_lbf, 0) / 1000, y: s.md }));

  const liveCurves = [
    { pts: sinPts,   color: '#c0392b', label: 'Sinusoidal'       },
    { pts: helPts,   color: '#2a7fa8', label: 'Helical'          },
    { pts: rotPts,   color: '#1a7a4a', label: 'Comp — Rotating'  },
    { pts: slidePts, color: '#e07a1a', label: 'Comp — Sliding'   },
  ];
  CI.storeLive(CID, liveCurves);
  CI.register(CID, { pad: g, xMax, yMax: maxMD, xLabel: 'Critical Load (klbs)', yLabel: 'MD (ft)', depthDown: true });
  CI.drawFrozen(ctx, CID);

  _chartLineDepthDown(ctx, sinPts,   '#c0392b', 1.5, g, xMax, maxMD);
  _chartLineDepthDown(ctx, helPts,   '#2a7fa8', 1.5, g, xMax, maxMD);
  // Sliding curve drawn dashed
  ctx.setLineDash([6, 3]);
  _chartLineDepthDown(ctx, slidePts, '#e07a1a', 2,   g, xMax, maxMD);
  ctx.setLineDash([]);
  _chartLineDepthDown(ctx, rotPts,   '#1a7a4a', 2,   g, xMax, maxMD);

  _legend(ctx, W, g.t,
    ['Sinusoidal', 'Helical', 'Comp — Rotating', 'Comp — Sliding (dashed)'],
    ['#c0392b', '#2a7fa8', '#1a7a4a', '#e07a1a']);
  CI.drawAnnotations(ctx, CID);
}

// ── Overpull chart — Slack-off (left) / Pick-up (right) split ─────────────────
function drawOverpull(r) {
  const CID = 'overpullCanvas';
  const c = _chartSetup(CID);
  if (!c) return;
  const { ctx, W, H } = c;

  const blockWt = +(document.getElementById('ovpBlock')?.value || 35);   // klbs
  const dpWt  = +(document.getElementById('ovpDPwt')?.value  || 19.5);
  const ffLo  = +(document.getElementById('ovpFFlo')?.value  || 0.20);
  const ffMid = +(document.getElementById('ovpFFmid')?.value || 0.30);
  const ffHi  = +(document.getElementById('ovpFFhi')?.value  || 0.40);
  const mw    = +(document.getElementById('ovpMW')?.value    || fluidGet().mudWeight);
  const BF    = 1 - mw / 65.5;

  const run = ff => tdCompute(qpState.survey, bhaGet(), null, mw,
    { ffCased: ff, ffOpen: ff, wob_klbs: 15, dpWt_ppf: dpWt, overpullMargin_lbf: 100000 });

  const resLo  = run(ffLo);
  const resMid = run(ffMid);
  const resHi  = run(ffHi);
  if (!resMid) { _noData(ctx, W, H, 'Run Compute first'); return; }

  const get = (res, mode) => res?.modes?.[mode]?.ffSensitivity?.mid?.stations || [];
  const rihLo   = get(resLo,  'rih');
  const rihMid  = get(resMid, 'rih');
  const rihHi   = get(resHi,  'rih');
  const freeWt  = get(resMid, 'rotOff');
  const poohLo  = get(resLo,  'pooh');
  const poohMid = get(resMid, 'pooh');
  const poohHi  = get(resHi,  'pooh');

  const maxMD = qpState.survey[qpState.survey.length - 1].md;
  // Hookload = buoyed string tension + block weight
  const toV   = s => s.axialLoad_lbf / 1000 + blockWt;
  const xMax  = Math.max(...poohHi.map(toV), ...rihLo.map(toV), 1) * 1.1;

  const g = _chartGridDepthDown(ctx, W, H, xMax, maxMD, 'Hook Load (klbs)', 'MD (ft)');

  // BF annotation
  ctx.fillStyle = '#5a7a8e'; ctx.font = '9px sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.fillText(`BF=${BF.toFixed(3)}  MW=${mw.toFixed(1)} ppg  Block=${blockWt} klbs`, g.l + g.pw - 4, g.t + 4);

  // ── Section labels ──────────────────────────────────────────────────────────
  ctx.font = 'bold 10px sans-serif'; ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(42,127,168,0.75)';
  ctx.textAlign = 'left';
  ctx.fillText('← SLACK-OFF', g.l + 6, g.t + 18);
  ctx.fillStyle = 'rgba(192,57,43,0.75)';
  ctx.textAlign = 'right';
  ctx.fillText('PICK-UP →', g.l + g.pw - 6, g.t + 18);

  const toLine = sts => sts.map(s => ({ x: toV(s), y: s.md }));
  const liveCurves = [
    { pts: toLine(rihLo),   color: '#5a9fd4', label: `SLK FF ${ffLo}`  },
    { pts: toLine(rihMid),  color: '#2a7fa8', label: `SLK FF ${ffMid}` },
    { pts: toLine(rihHi),   color: '#1a5f88', label: `SLK FF ${ffHi}`  },
    { pts: toLine(freeWt),  color: '#7f8c8d', label: 'Free Wt'         },
    { pts: toLine(poohLo),  color: '#e07878', label: `PKP FF ${ffLo}`  },
    { pts: toLine(poohMid), color: '#c0392b', label: `PKP FF ${ffMid}` },
    { pts: toLine(poohHi),  color: '#8b1a1a', label: `PKP FF ${ffHi}`  },
  ];
  CI.storeLive(CID, liveCurves);
  CI.register(CID, { pad: g, xMax, yMax: maxMD, xLabel: 'Hook Load (klbs)', yLabel: 'MD (ft)', depthDown: true });
  CI.drawFrozen(ctx, CID);

  // Slack-off (RIH): lo/hi dashed, mid solid
  ctx.setLineDash([5, 3]);
  _chartLineDepthDown(ctx, liveCurves[0].pts, '#5a9fd4', 1.5, g, xMax, maxMD);
  ctx.setLineDash([]);
  _chartLineDepthDown(ctx, liveCurves[1].pts, '#2a7fa8', 2,   g, xMax, maxMD);
  ctx.setLineDash([5, 3]);
  _chartLineDepthDown(ctx, liveCurves[2].pts, '#1a5f88', 1.5, g, xMax, maxMD);

  // Free weight: gray long-dash
  ctx.setLineDash([8, 4]);
  _chartLineDepthDown(ctx, liveCurves[3].pts, '#7f8c8d', 1.5, g, xMax, maxMD);

  // Pick-up (POOH): lo/hi dashed, mid solid
  ctx.setLineDash([5, 3]);
  _chartLineDepthDown(ctx, liveCurves[4].pts, '#e07878', 1.5, g, xMax, maxMD);
  ctx.setLineDash([]);
  _chartLineDepthDown(ctx, liveCurves[5].pts, '#c0392b', 2,   g, xMax, maxMD);
  ctx.setLineDash([5, 3]);
  _chartLineDepthDown(ctx, liveCurves[6].pts, '#8b1a1a', 1.5, g, xMax, maxMD);
  ctx.setLineDash([]);

  _legend(ctx, W, g.t,
    [`SLK ${ffLo}`, `SLK ${ffMid}`, `SLK ${ffHi}`, 'Free Wt',
     `PKP ${ffLo}`, `PKP ${ffMid}`, `PKP ${ffHi}`],
    ['#5a9fd4', '#2a7fa8', '#1a5f88', '#7f8c8d', '#e07878', '#c0392b', '#8b1a1a']);
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

  ctx.fillStyle = '#5a7a8e'; ctx.font = '9px sans-serif';
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

  ctx.fillStyle = '#1a2b38'; ctx.font = 'bold 11px sans-serif';
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

  ctx.strokeStyle = '#e8f0f5'; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const x = l + pw * i / 5;
    const y = t + ph * i / 5;
    ctx.beginPath(); ctx.moveTo(x, t); ctx.lineTo(x, t + ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(l + pw, y); ctx.stroke();
    ctx.fillStyle = '#5a7a8e'; ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText((xMax * i / 5).toFixed(0), x, t - 14);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText((yMax * i / 5).toFixed(0), l - 5, y);
  }

  ctx.strokeStyle = '#9ecce3'; ctx.lineWidth = 1.5;
  ctx.strokeRect(l, t, pw, ph);

  ctx.save();
  ctx.fillStyle = '#1a2b38'; ctx.font = 'bold 11px sans-serif';
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
    const y = g.t + (p.y / yMax) * g.ph;   // depth down: y increases with depth
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _legend(ctx, W, t, labels, colors) {
  let x = W - CHART_PAD.r - labels.reduce((s, l) => s + l.length * 7 + 24, 0);
  labels.forEach((lbl, i) => {
    ctx.fillStyle   = colors[i];
    ctx.fillRect(x, t + 4, 14, 4);
    ctx.fillStyle   = '#1a2b38';
    ctx.font        = '10px sans-serif';
    ctx.textAlign   = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(lbl, x + 18, t + 6);
    x += lbl.length * 7 + 24;
  });
}

function _noData(ctx, W, H, msg) {
  ctx.fillStyle = '#5a7a8e'; ctx.font = '13px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(msg, W / 2, H / 2);
}
