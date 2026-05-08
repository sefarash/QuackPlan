// ===== T&D CHARTS =====
// drawTorque, drawBuckling, drawOverpull, drawBroomstick

const CHART_COLORS = { lo: '#2a7fa8', mid: '#f0a500', hi: '#c0392b' };
const CHART_PAD = { t: 30, b: 50, l: 70, r: 20 };

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
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText((xMax * i / 5).toFixed(0), x, t + ph + 6);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText((yMax * (5 - i) / 5).toFixed(0), l - 5, y);
  }

  ctx.strokeStyle = '#9ecce3'; ctx.lineWidth = 1.5;
  ctx.strokeRect(l, t, pw, ph);

  ctx.save();
  ctx.fillStyle = '#1a2b38'; ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(xLabel, l + pw / 2, H - 8);
  ctx.translate(12, t + ph / 2); ctx.rotate(-Math.PI / 2);
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
  const c = _chartSetup('torqueCanvas');
  if (!c) return;
  const { ctx, W, H } = c;

  const ffLo  = +(document.getElementById('torqFFlo')?.value  || 0.20);
  const ffMid = +(document.getElementById('torqFFmid')?.value || 0.30);
  const ffHi  = +(document.getElementById('torqFFhi')?.value  || 0.40);
  const wob   = +(document.getElementById('torqWOB')?.value   || 15) * 1000;

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

  const maxMD    = qpState.survey[qpState.survey.length - 1].md;
  const maxTorq  = Math.max(
    ...stHi.map(s => s.torque_ftlbs / 1000), 1);

  const g = _chartGrid(ctx, W, H, maxTorq * 1.1, maxMD, 'Torque (ft·lbs ×1000)', 'MD (ft)');

  const toLine = sts => sts.map(s => ({ x: s.torque_ftlbs / 1000, y: s.md }));
  _chartLine(ctx, toLine(stLo),  CHART_COLORS.lo,  1.5, g.l, g.t, g.pw, g.ph, maxTorq * 1.1, maxMD);
  _chartLine(ctx, toLine(stMid), CHART_COLORS.mid, 2,   g.l, g.t, g.pw, g.ph, maxTorq * 1.1, maxMD);
  _chartLine(ctx, toLine(stHi),  CHART_COLORS.hi,  1.5, g.l, g.t, g.pw, g.ph, maxTorq * 1.1, maxMD);

  _legend(ctx, W, g.t, ['FF '+ffLo, 'FF '+ffMid, 'FF '+ffHi],
    [CHART_COLORS.lo, CHART_COLORS.mid, CHART_COLORS.hi]);
}

// ── Buckling chart ────────────────────────────────────────────────────────────
function drawBuckling(r) {
  const c = _chartSetup('bucklingCanvas');
  if (!c) return;
  const { ctx, W, H } = c;

  const bk = r.buckling;
  if (!bk?.stations?.length) { _noData(ctx, W, H, 'Run Compute first'); return; }

  const maxMD   = Math.max(...bk.stations.map(s => s.md), 1);
  const maxF    = Math.max(...bk.stations.map(s =>
    Math.max(s.fSin_lbf || 0, s.fHel_lbf || 0, -s.axialLoad_lbf || 0)), 1) / 1000;

  const g = _chartGrid(ctx, W, H, maxF * 1.1, maxMD, 'Critical Load (klbs)', 'MD (ft)');

  const sinPts  = bk.stations.filter(s => s.fSin_lbf != null)
                             .map(s => ({ x: s.fSin_lbf / 1000, y: s.md }));
  const helPts  = bk.stations.filter(s => s.fHel_lbf != null)
                             .map(s => ({ x: s.fHel_lbf / 1000, y: s.md }));
  const compPts = bk.stations.map(s => ({ x: Math.max(-s.axialLoad_lbf, 0) / 1000, y: s.md }));

  _chartLine(ctx, sinPts,  '#c0392b',  1.5, g.l, g.t, g.pw, g.ph, maxF * 1.1, maxMD);
  _chartLine(ctx, helPts,  '#2a7fa8',  1.5, g.l, g.t, g.pw, g.ph, maxF * 1.1, maxMD);
  _chartLine(ctx, compPts, '#1a7a4a',  2,   g.l, g.t, g.pw, g.ph, maxF * 1.1, maxMD);

  _legend(ctx, W, g.t, ['Sinusoidal', 'Helical', 'Compressive Load'],
    ['#c0392b', '#2a7fa8', '#1a7a4a']);
}

// ── Overpull chart ────────────────────────────────────────────────────────────
function drawOverpull(r) {
  const c = _chartSetup('overpullCanvas');
  if (!c) return;
  const { ctx, W, H } = c;

  const ffLo  = +(document.getElementById('ovpFFlo')?.value  || 0.20);
  const ffMid = +(document.getElementById('ovpFFmid')?.value || 0.30);
  const ffHi  = +(document.getElementById('ovpFFhi')?.value  || 0.40);
  const mw    = +(document.getElementById('ovpMW')?.value    || fluidGet().mudWeight);

  const makePooh = (ff) => {
    const res = tdCompute(qpState.survey, bhaGet(), null, mw,
      { ffCased: ff, ffOpen: ff, wob_klbs: 15, overpullMargin_lbf: 100000 });
    return res?.modes?.pooh?.ffSensitivity?.mid?.stations || [];
  };

  const stLo  = makePooh(ffLo);
  const stMid = makePooh(ffMid);
  const stHi  = makePooh(ffHi);

  const maxMD = qpState.survey[qpState.survey.length - 1].md;
  const maxHL = Math.max(...stHi.map(s => s.axialLoad_lbf / 1000), 1);

  const g = _chartGrid(ctx, W, H, maxHL * 1.1, maxMD, 'Hook Load (klbs)', 'MD (ft)');

  const toLine = sts => sts.map(s => ({ x: s.axialLoad_lbf / 1000, y: s.md }));
  _chartLine(ctx, toLine(stLo),  CHART_COLORS.lo,  1.5, g.l, g.t, g.pw, g.ph, maxHL * 1.1, maxMD);
  _chartLine(ctx, toLine(stMid), CHART_COLORS.mid, 2,   g.l, g.t, g.pw, g.ph, maxHL * 1.1, maxMD);
  _chartLine(ctx, toLine(stHi),  CHART_COLORS.hi,  1.5, g.l, g.t, g.pw, g.ph, maxHL * 1.1, maxMD);

  _legend(ctx, W, g.t, ['FF '+ffLo, 'FF '+ffMid, 'FF '+ffHi],
    [CHART_COLORS.lo, CHART_COLORS.mid, CHART_COLORS.hi]);
}

// ── Broomstick chart ──────────────────────────────────────────────────────────
// Y-axis: depth increases DOWNWARD (surface at top, TD at bottom)
function drawBroomstick(r) {
  const c = _chartSetup('broomstickCanvas');
  if (!c) return;
  const { ctx, W, H } = c;

  const ff  = +(document.getElementById('bsFF')?.value || 0.30);
  const mw  = fluidGet().mudWeight;

  const res = tdCompute(qpState.survey, bhaGet(), null, mw,
    { ffCased: ff, ffOpen: ff, wob_klbs: 15, overpullMargin_lbf: 100000 });
  if (!res) { _noData(ctx, W, H, 'Run Compute first'); return; }

  const rotOn = res.modes.rotOn?.ffSensitivity?.mid?.stations || [];
  const pooh  = res.modes.pooh?.ffSensitivity?.mid?.stations  || [];
  const rih   = res.modes.rih?.ffSensitivity?.mid?.stations   || [];

  const maxMD = qpState.survey[qpState.survey.length - 1].md;
  const allHL = [...rotOn, ...pooh, ...rih].map(s => Math.abs(s.axialLoad_lbf) / 1000);
  const maxHL = Math.max(...allHL, 1);

  // Draw grid with inverted Y (depth down)
  const g = _chartGridDepthDown(ctx, W, H, maxHL * 1.1, maxMD,
    'Hook Load (klbs)', 'MD (ft)');

  // toLine: x = hook load, y = md (depth increases down → y increases down in plot)
  const toLine = sts => sts.map(s => ({ x: Math.abs(s.axialLoad_lbf) / 1000, y: s.md }));
  _chartLineDepthDown(ctx, toLine(rih),   '#2a7fa8', 1.5, g, maxHL * 1.1, maxMD);
  _chartLineDepthDown(ctx, toLine(rotOn), '#1a7a4a', 2,   g, maxHL * 1.1, maxMD);
  _chartLineDepthDown(ctx, toLine(pooh),  '#c0392b', 1.5, g, maxHL * 1.1, maxMD);

  _legend(ctx, W, g.t, ['RIH', 'Rot-On (WOB)', 'POOH'],
    ['#2a7fa8', '#1a7a4a', '#c0392b']);
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
    // X labels (hook load)
    ctx.fillStyle = '#5a7a8e'; ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText((xMax * i / 5).toFixed(0), x, t + ph + 6);
    // Y labels: depth increases downward → label increases downward
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText((yMax * i / 5).toFixed(0), l - 5, y);
  }

  ctx.strokeStyle = '#9ecce3'; ctx.lineWidth = 1.5;
  ctx.strokeRect(l, t, pw, ph);

  ctx.save();
  ctx.fillStyle = '#1a2b38'; ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(xLabel, l + pw / 2, H - 8);
  ctx.translate(12, t + ph / 2); ctx.rotate(-Math.PI / 2);
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
