// ===== T&D CHARTS =====
// drawTorque, drawBuckling, drawOverpull, drawBroomstick

const CHART_COLORS = { lo: '#2a7fa8', mid: '#f0a500', hi: '#c0392b' };
const CHART_PAD = { t: 62, b: 22, l: 70, r: 20 };

// Relabel the T&D control-input unit spans for the active system. Called on unit
// change (from output-controls' onChange) and once on DOMContentLoaded.
const _TD_CONTROL_UNITS = {
  uTorqWOB: 'force', uTorqMaxTq: 'torque_k', uBuckWOB: 'force',
  uOvpBlock: 'force', uOvpDPwt: 'linwt', uOvpMW: 'mw',
  uBsBlock: 'force', uBsMW: 'mw', uBsMaxHL: 'force',
};

// Phase-aware inputs for the chart engines: the survey truncated to the analysis
// TD (by default the bottom of the scenario's casing program) + that section's fluid.
function _tdSurvey() {   // to the bit: the BHA's max cumulative length (phase.js)
  return (typeof qpSurveyForString === 'function') ? qpSurveyForString() : qpState.survey;
}
function _tdFluid() {
  return (typeof qpPhaseFluid === 'function') ? qpPhaseFluid() : fluidGet();
}

function _tdUpdateControlLabels() {
  Object.keys(_TD_CONTROL_UNITS).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = QP_UNITS.label(_TD_CONTROL_UNITS[id]);
  });
}

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
  // View zoom / pan (chart-zoom.js): everything below draws in base coordinates
  if (typeof QP_ZOOM !== 'undefined') QP_ZOOM.apply(ctx, canvasId);
  _lblReset(); _lblCanvasId = canvasId;
  return { ctx, W: canvas.width, H: canvas.height, C };
}

// ── Label layout (shared by every chart) ──────────────────────────────────────
// Canvas labels used to be drawn at fixed spots, so at smaller window sizes
// they landed on each other, on the legend, or ran off the plot. Now a chart
// QUEUES its labels (_lblQueue) and the legend flushes them (_lblFlush) after
// reserving its own box: each label is clamped inside its bounds and stepped
// down (or up) a line at a time until it is clear of everything placed so far.
let _lblBoxes = [], _lblPending = [], _lblCanvasId = null;
function _lblReset() { _lblBoxes = []; _lblPending = []; }
// A box later labels must avoid. Base coordinates by default (mapped through the
// zoom window, keeping its size); pass screen=true for a box already on screen.
function _lblReserve(x, y, w, h, screen) {
  if (!screen && typeof QP_ZOOM !== 'undefined' && _lblCanvasId) {
    const c = QP_ZOOM.pt(_lblCanvasId, x + w / 2, y + h / 2);
    x = c.x - w / 2; y = c.y - h / 2;
  }
  _lblBoxes.push({ x, y, w, h });
}
function _lblHit(b) {
  return _lblBoxes.some(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
}
// Queue a label at base point (x, y) — the data point it belongs to — plus a
// pixel offset. opt: { align:'left'|'right'|'center', font, color,
//   bounds:{l,t,pw,ph}, dir: 1 (step down) | -1 (step up),
//   dx, dy   pixel offset from the anchor (y + dy = TOP of the text),
//   pin      fixed on screen (a note, not tied to data): never moves with zoom,
//   pinY     only x follows the data (a label at the top of a vertical line),
//   pinX     only y follows the data (a label at the left of a horizontal line),
//   clampY   keep it in view vertically when its anchor scrolls off }
// When zoomed, a label whose anchor is outside the visible plot is not drawn.
function _lblQueue(text, x, y, opt) { _lblPending.push({ text, x, y, opt: opt || {} }); }
function _lblFlush(ctx) {
  _zoomEnd(ctx);                                          // labels are placed in screen space
  const C = _qpColors();
  const id = ctx.canvas.id, Z = (typeof QP_ZOOM !== 'undefined') ? QP_ZOOM : null;
  const pending = _lblPending; _lblPending = [];
  pending.forEach(({ text, x, y, opt }) => {
    if (Z && !opt.pin) {
      const q = Z.pt(id, x, y), R = Z.get(id).rect;
      const vx = opt.pinX ? R.l + 1 : q.x, vy = (opt.pinY || opt.clampY) ? R.t + 1 : q.y;
      if (!Z.visible(id, vx, vy, 2)) return;
      if (!opt.pinX) x = q.x;
      if (!opt.pinY) y = opt.clampY ? Math.max(R.t, Math.min(q.y, R.t + R.ph)) : q.y;
    }
    x += opt.dx || 0; y += opt.dy || 0;
    ctx.save();
    ctx.font = opt.font || '9px sans-serif';
    const px = parseInt((ctx.font.match(/(\d+)px/) || [0, 10])[1], 10);
    const w = ctx.measureText(text).width, h = px + 3;
    const bd = opt.bounds || { l: 0, t: 0, pw: ctx.canvas.width, ph: ctx.canvas.height };
    const x0min = bd.l + 2, x0max = bd.l + bd.pw - w - 2;
    let bx = opt.align === 'right' ? x - w : opt.align === 'center' ? x - w / 2 : x;
    bx = Math.max(x0min, Math.min(bx, Math.max(x0min, x0max)));       // never off the plot
    const yMin = bd.t + 1, yMax = bd.t + bd.ph - h;
    const dir = opt.dir === -1 ? -1 : 1;
    let by = Math.max(yMin, Math.min(y, yMax)), found = false;
    for (const d of [dir, -dir]) {
      for (let k = 0; k < 40 && !found; k++) {
        const yy = Math.max(yMin, Math.min(y, yMax)) + d * k * h;
        if (yy < yMin || yy > yMax) break;
        if (!_lblHit({ x: bx - 2, y: yy, w: w + 4, h })) { by = yy; found = true; }
      }
      if (found) break;
    }
    _lblBoxes.push({ x: bx - 2, y: by, w: w + 4, h });
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = C.bg;   // halo: readable over curves
    ctx.strokeText(text, bx, by + 1);
    ctx.fillStyle = opt.color || C.text;
    ctx.fillText(text, bx, by + 1);
    ctx.restore();
  });
}

// ── Zoom-aware axes ───────────────────────────────────────────────────────────
// _zoomWin: the visible window of the plot (chart-zoom.js) as tick mappers; a
// plain 0..1 window when the module is absent. _zoomBegin: start drawing the
// data through that window. _tickFmt: a tick value with enough decimals for the
// visible span (unchanged whole numbers at 100%).
function _zoomWin(ctx, g, opts) {
  if (typeof QP_ZOOM !== 'undefined') return QP_ZOOM.plotWindow(ctx, g, opts);
  return { zoomed: false, fx: f => f, fy: f => f, sx: f => g.l + f * g.pw, sy: f => g.t + f * g.ph };
}
function _zoomBegin(ctx) { if (typeof QP_ZOOM !== 'undefined') QP_ZOOM.begin(ctx); }
function _zoomEnd(ctx)   { if (typeof QP_ZOOM !== 'undefined') QP_ZOOM.end(ctx); }
function _tickFmt(v, span, zoomed) {
  if (!zoomed) return v.toFixed(0);
  const step = Math.abs(span) / 5;
  return v.toFixed(step >= 5 ? 0 : step >= 0.5 ? 1 : step >= 0.05 ? 2 : 3);
}

function _chartGrid(ctx, W, H, xMax, yMax, xLabel, yLabel) {
  const { t, b, l, r } = CHART_PAD;
  const pw = W - l - r, ph = H - t - b;
  const C = _qpColors();
  const zw = _zoomWin(ctx, { l, t, pw, ph });
  const xSpan = xMax * (zw.fx(1) - zw.fx(0)), ySpan = yMax * (zw.fy(1) - zw.fy(0));

  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const x = l + pw * i / 5;
    const y = t + ph * i / 5;
    ctx.beginPath(); ctx.moveTo(x, t); ctx.lineTo(x, t + ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(l + pw, y); ctx.stroke();
    ctx.fillStyle = C.dim; ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(_tickFmt(xMax * zw.fx(i / 5), xSpan, zw.zoomed), x, t - 14);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(_tickFmt(yMax * (1 - zw.fy(i / 5)), ySpan, zw.zoomed), l - 5, y);
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

  _zoomBegin(ctx);            // the data drawn after this goes through the zoom window
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

// Vertical rig-limit reference line on a depth-down chart (x = value axis).
// Draws a bold dashed line at xVal across the full depth range with a label.
// No-op when xVal <= 0. Callers should fold xVal into xMax so the line is on
// screen with the curves visible to its left.
function _rigLimitLine(ctx, g, xVal, xMax, label) {
  if (!(xVal > 0)) return;
  const x = g.l + Math.min(xVal / xMax, 1) * g.pw;
  ctx.save();
  ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2; ctx.setLineDash([7, 4]);
  ctx.beginPath(); ctx.moveTo(x, g.t); ctx.lineTo(x, g.t + g.ph); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  // the label rides at the top of the visible line, whatever the zoom
  _lblQueue(label, x, g.t, { dx: -4, dy: 4, pinY: true, align: 'right', font: 'bold 9px sans-serif', color: '#c0392b', bounds: g });
}

// ── Torque chart ──────────────────────────────────────────────────────────────
function drawTorque(r) {
  const CID = 'torqueCanvas';
  const c = _chartSetup(CID);
  if (!c) return;
  const { ctx, W, H } = c;
  if (_noBha(ctx, W, H, CID)) return;

  // Display converters (compute stays imperial: kft·lb, klbf, ft)
  const toTq = v => QP_UNITS.toDisplay('torque_k', v);   // kft·lb → display
  const toD  = v => QP_UNITS.toDisplay('depth', v);
  const uTq = QP_UNITS.label('torque_k'), uD = QP_UNITS.label('depth');

  const ffLo   = +(document.getElementById('torqFFlo')?.value  || 0.20);
  const ffMid  = +(document.getElementById('torqFFmid')?.value || 0.30);
  const ffHi   = +(document.getElementById('torqFFhi')?.value  || 0.40);
  const _wobRaw = document.getElementById('torqWOB')?.value;
  // WOB field is display force (klbf/kN) → imperial klbf, then ×1000 → lbf
  const wob    = (_wobRaw === '' || _wobRaw == null ? 15 : QP_UNITS.fromDisplay('force', +_wobRaw)) * 1000;
  const mutPct = +(document.getElementById('torqMUTpct')?.value || 100) / 100;
  // Rig torque limit field is display (kft·lb/kN·m) → imperial kft·lb
  const maxTq  = QP_UNITS.fromDisplay('torque_k', +(document.getElementById('torqMaxTq')?.value || 0));

  const modes  = r.modes?.rotOn?.ffSensitivity;
  if (!modes) { _noData(ctx, W, H, 'Run Compute first'); return; }

  const bha = bhaGet();
  const makeFF = (ff) => {
    const res = tdCompute(_tdSurvey(), bha, null, _tdFluid().mudWeight,
      { ffCased: ff, ffOpen: ff, wob_klbs: wob / 1000, overpullMargin_lbf: 100000 });
    return res?.modes?.rotOn?.ffSensitivity?.mid?.stations || [];
  };

  const stLo  = makeFF(ffLo);
  const stMid = makeFF(ffMid);
  const stHi  = makeFF(ffHi);

  const _sv = _tdSurvey();
  const maxMD = _sv[_sv.length - 1].md;

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
  const xMaxImp = Math.max(...stHi.map(s => s.torque_ftlbs / 1000), mutMax, maxTq, 1) * 1.1;
  const xMax = toTq(xMaxImp), yMax = toD(maxMD);   // display axes

  const g = _chartGridDepthDown(ctx, W, H, xMax, yMax, `Torque (${uTq})`, `MD (${uD})`);

  const toLine = sts => sts.map(s => ({ x: toTq(s.torque_ftlbs / 1000), y: toD(s.md) }));
  const liveCurves = [
    { pts: toLine(stLo),  color: CHART_COLORS.lo,  label: 'FF ' + ffLo  },
    { pts: toLine(stMid), color: CHART_COLORS.mid, label: 'FF ' + ffMid },
    { pts: toLine(stHi),  color: CHART_COLORS.hi,  label: 'FF ' + ffHi  },
  ];
  CI.storeLive(CID, liveCurves);
  CI.register(CID, { pad: g, xMax, yMax, xLabel: `Torque (${uTq})`, yLabel: `MD (${uD})`, depthDown: true });
  CI.drawFrozen(ctx, CID);

  _chartLineDepthDown(ctx, liveCurves[0].pts, CHART_COLORS.lo,  1.5, g, xMax, yMax);
  _chartLineDepthDown(ctx, liveCurves[1].pts, CHART_COLORS.mid, 2,   g, xMax, yMax);
  _chartLineDepthDown(ctx, liveCurves[2].pts, CHART_COLORS.hi,  1.5, g, xMax, yMax);

  // MUT limit step-function (mutK is imperial kft·lb, MD imperial → display for plot)
  if (mutSegs.length) {
    ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    for (let i = 0; i < mutSegs.length; i++) {
      const seg = mutSegs[i];
      const x  = g.l + Math.min(toTq(seg.mutK) / xMax, 1) * g.pw;
      const y0 = g.t + (toD(seg.topMD) / yMax) * g.ph;
      const y1 = g.t + (toD(seg.botMD) / yMax) * g.ph;
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
      if (i + 1 < mutSegs.length) {
        const xNext = g.l + Math.min(toTq(mutSegs[i + 1].mutK) / xMax, 1) * g.pw;
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
      const x = g.l + Math.min(toTq(seg.mutK) / xMax, 1) * g.pw;
      const y = g.t + (toD(seg.topMD) / yMax) * g.ph;
      const rightSide = x < g.l + g.pw * 0.7;      // label on the side of the line that has room
      _lblQueue(`${seg.label}: ${toTq(seg.mutK).toFixed(1)} ${uTq}`, x, y,
        { dx: rightSide ? 3 : -4, dy: 4, clampY: true, align: rightSide ? 'left' : 'right', color: '#c0392b', bounds: g });
    });
  }

  // Rig torque limit — vertical red line (maxTq imperial kft·lb → display)
  _rigLimitLine(ctx, g, toTq(maxTq), xMax, `Max Tq ${toTq(maxTq).toFixed(0)} ${uTq}`);

  const legendLabels  = ['FF '+ffLo, 'FF '+ffMid, 'FF '+ffHi];
  const legendColors  = [CHART_COLORS.lo, CHART_COLORS.mid, CHART_COLORS.hi];
  if (mutSegs.length) {
    legendLabels.push(`MUT ${Math.round(mutPct * 100)}%`);
    legendColors.push('#c0392b');
  }
  if (maxTq > 0) { legendLabels.push('Rig Limit'); legendColors.push('#c0392b'); }
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
  if (_noBha(ctx, W, H, CID)) return;

  const toF = v => QP_UNITS.toDisplay('force', v);   // klbf → display
  const toD = v => QP_UNITS.toDisplay('depth', v);
  const uF = QP_UNITS.label('force'), uD = QP_UNITS.label('depth');

  const _wobRaw  = document.getElementById('buckWOB')?.value;
  const wob_klbs = (_wobRaw === '' || _wobRaw == null ? 15 : QP_UNITS.fromDisplay('force', +_wobRaw));
  const ffMid    = +(document.getElementById('buckFFmid')?.value || 0.30);
  const mw       = _tdFluid().mudWeight;

  if (!_tdSurvey()?.length) { _noData(ctx, W, H, 'Run Compute first'); return; }

  const res = tdCompute(_tdSurvey(), bhaGet(), null, mw,
    { ffCased: ffMid, ffOpen: ffMid, wob_klbs, overpullMargin_lbf: 100000 });

  const bk = res?.buckling;
  if (!bk?.stations?.length) { _noData(ctx, W, H, 'Run Compute first'); return; }

  const rotAllSt   = res.modes?.rotOn?.ffSensitivity?.mid?.stations   || [];
  const slideAllSt = res.modes?.slideOn?.ffSensitivity?.mid?.stations || [];
  const _sv = _tdSurvey();
  const maxMD      = _sv[_sv.length - 1].md;

  const yMax = toD(maxMD);   // display depth axis
  // Effective axial load — signed (+ tension, − compression); plotted in display
  const rotPts   = rotAllSt.map(s   => ({ x: toF(s.axialLoad_lbf / 1000), y: toD(s.md) }));
  const slidePts = slideAllSt.map(s => ({ x: toF(s.axialLoad_lbf / 1000), y: toD(s.md) }));

  // Buckling limits on the compression (negative) side
  // null fSin/fHel = vertical section: limit is 0 (any compression buckles)
  const sinPts = bk.stations.map(s => ({ x: toF(s.fSin_lbf != null ? -s.fSin_lbf / 1000 : 0), y: toD(s.md) }));
  const helPts = bk.stations.map(s => ({ x: toF(s.fHel_lbf != null ? -s.fHel_lbf / 1000 : 0), y: toD(s.md) }));
  // Extend final segment to actual TD (bk.stations uses el.md0, one interval short of maxMD)
  const lastBk = bk.stations[bk.stations.length - 1];
  sinPts.push({ x: toF(lastBk?.fSin_lbf != null ? -lastBk.fSin_lbf / 1000 : 0), y: yMax });
  helPts.push({ x: toF(lastBk?.fHel_lbf != null ? -lastBk.fHel_lbf / 1000 : 0), y: yMax });

  // Scale X axis from axial load curves only — extreme BHA-clearance limit values
  // must not blow out the scale and hide the normal buildup/horizontal limits
  const axX  = [...rotPts, ...slidePts].map(p => p.x);
  const xMax = Math.max(...axX,  1) * 1.1;
  const xMin = Math.min(...axX, ...helPts.map(p => p.x), -1) * 1.1;
  const xRange = xMax - xMin;

  const g = _chartGridDepthDownSigned(ctx, W, H, xMin, xMax, yMax, `Axial Load (${uF})`, `MD (${uD})`);

  // CI expects x values mapped as (p.x / xMax_ci) * pw, so shift by xMin
  const shift = pts => pts.map(p => ({ x: p.x - xMin, y: p.y }));
  const liveCurves = [
    { pts: shift(sinPts),   color: '#e67e22', label: 'Sin. Limit'        },
    { pts: shift(helPts),   color: '#c0392b', label: 'Hel. Limit'        },
    { pts: shift(rotPts),   color: '#2a7fa8', label: 'Axial — Rotating'  },
    { pts: shift(slidePts), color: '#7f8c8d', label: 'Axial — Sliding'   },
  ];
  CI.storeLive(CID, liveCurves);
  CI.register(CID, { pad: g, xMax: xRange, yMax,
    xLabel: `Axial Load (${uF})`, yLabel: `MD (${uD})`, depthDown: true, xOffset: xMin });
  CI.drawFrozen(ctx, CID);

  // Clip all curves to chart area so extreme BHA-section values don't overflow
  ctx.save();
  ctx.beginPath(); ctx.rect(g.l, g.t, g.pw, g.ph); ctx.clip();

  // Sinusoidal limit — orange
  _chartLineDepthDownSigned(ctx, sinPts,   '#e67e22', 1.5, g, xMin, xMax, yMax);
  // Helical limit — red
  _chartLineDepthDownSigned(ctx, helPts,   '#c0392b', 1.5, g, xMin, xMax, yMax);
  // Sliding axial load — gray dashed
  ctx.setLineDash([6, 3]);
  _chartLineDepthDownSigned(ctx, slidePts, '#7f8c8d', 1.5, g, xMin, xMax, yMax);
  ctx.setLineDash([]);
  // Rotating axial load — blue solid
  _chartLineDepthDownSigned(ctx, rotPts,   '#2a7fa8', 2,   g, xMin, xMax, yMax);

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
  if (_noBha(ctx, W, H, CID)) return;

  const toF = v => QP_UNITS.toDisplay('force', v);
  const toD = v => QP_UNITS.toDisplay('depth', v);
  const uF  = QP_UNITS.label('force'), uD = QP_UNITS.label('depth'), uMW = QP_UNITS.label('mw');

  const _blkRaw = document.getElementById('ovpBlock')?.value;
  const _dpRaw  = document.getElementById('ovpDPwt')?.value;
  const _mwRaw  = document.getElementById('ovpMW')?.value;
  const blockWt  = (_blkRaw==='' || _blkRaw==null) ? 35   : QP_UNITS.fromDisplay('force', +_blkRaw);  // klbf (canonical)
  const dpWt     = (_dpRaw ==='' || _dpRaw ==null) ? 19.5 : QP_UNITS.fromDisplay('linwt', +_dpRaw);   // lb/ft
  const mw       = (_mwRaw ==='' || _mwRaw ==null) ? _tdFluid().mudWeight : QP_UNITS.fromDisplay('mw', +_mwRaw); // ppg
  const ffLo     = +(document.getElementById('ovpFFlo')?.value     || 0.20);
  const ffMid    = +(document.getElementById('ovpFFmid')?.value    || 0.30);
  const ffHi     = +(document.getElementById('ovpFFhi')?.value     || 0.40);
  const yieldPct = +(document.getElementById('ovpYieldPct')?.value || 100) / 100;
  const BF       = 1 - mw / 65.5;

  const bha = bhaGet();
  const run = ff => tdCompute(_tdSurvey(), bha, null, mw,
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

  const _sv = _tdSurvey();
  const maxMD = _sv[_sv.length - 1].md;
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
  const xMaxImp = Math.max(...poohHi.map(toV), ...freeWt.map(toV), yieldMax, 1) * 1.1;
  const xMax = toF(xMaxImp);
  const yMax = toD(maxMD);

  const g = _chartGridDepthDown(ctx, W, H, xMax, yMax, `Hook Load (${uF})`, `MD (${uD})`);

  _lblQueue(`BF=${BF.toFixed(3)}  MW=${QP_UNITS.toDisplay('mw',mw).toFixed(1)} ${uMW}  Block=${toF(blockWt).toFixed(0)} ${uF}`,
    g.l + g.pw - 4, g.t + g.ph - 14, { pin: true, align: 'right', color: _qpColors().dim, bounds: g, dir: -1 });

  const toLine = sts => sts.map(s => ({ x: toF(toV(s)), y: toD(s.md) }));
  const liveCurves = [
    { pts: toLine(freeWt),  color: '#7f8c8d', label: 'Free Wt'         },
    { pts: toLine(poohLo),  color: '#e07878', label: `PKP FF ${ffLo}`  },
    { pts: toLine(poohMid), color: '#c0392b', label: `PKP FF ${ffMid}` },
    { pts: toLine(poohHi),  color: '#8b1a1a', label: `PKP FF ${ffHi}`  },
  ];
  CI.storeLive(CID, liveCurves);
  CI.register(CID, { pad: g, xMax, yMax, xLabel: `Hook Load (${uF})`, yLabel: `MD (${uD})`, depthDown: true });
  CI.drawFrozen(ctx, CID);

  // Free weight: gray long-dash
  ctx.setLineDash([8, 4]);
  _chartLineDepthDown(ctx, liveCurves[0].pts, '#7f8c8d', 1.5, g, xMax, yMax);

  // Pick-up (POOH): lo/hi dashed, mid solid
  ctx.setLineDash([5, 3]);
  _chartLineDepthDown(ctx, liveCurves[1].pts, '#e07878', 1.5, g, xMax, yMax);
  ctx.setLineDash([]);
  _chartLineDepthDown(ctx, liveCurves[2].pts, '#c0392b', 2,   g, xMax, yMax);
  ctx.setLineDash([5, 3]);
  _chartLineDepthDown(ctx, liveCurves[3].pts, '#8b1a1a', 1.5, g, xMax, yMax);
  ctx.setLineDash([]);

  // Tensile yield limit step-function
  if (yieldSegs.length) {
    const YIELD_CLR = '#922b21';
    ctx.strokeStyle = YIELD_CLR; ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    for (let i = 0; i < yieldSegs.length; i++) {
      const seg = yieldSegs[i];
      const x  = g.l + Math.min(toF(seg.yieldK) / xMax, 1) * g.pw;
      const y0 = g.t + (toD(seg.topMD) / yMax) * g.ph;
      const y1 = g.t + (toD(seg.botMD) / yMax) * g.ph;
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
      if (i + 1 < yieldSegs.length) {
        const xNext = g.l + Math.min(toF(yieldSegs[i + 1].yieldK) / xMax, 1) * g.pw;
        ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(xNext, y1); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    const seen = new Set();
    yieldSegs.forEach(seg => {
      const key = seg.yieldK.toFixed(0);
      if (seen.has(key)) return;
      seen.add(key);
      const x = g.l + Math.min(toF(seg.yieldK) / xMax, 1) * g.pw;
      const y = g.t + (toD(seg.topMD) / yMax) * g.ph;
      const rightSide = x < g.l + g.pw * 0.7;      // label on the side of the line that has room
      _lblQueue(`${seg.label}: ${toF(seg.yieldK).toFixed(0)} ${uF}`, x, y,
        { dx: rightSide ? 3 : -4, dy: 4, clampY: true, align: rightSide ? 'left' : 'right', color: YIELD_CLR, bounds: g });
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
  if (_noBha(ctx, W, H, CID)) return;

  const toF = v => QP_UNITS.toDisplay('force', v);
  const toD = v => QP_UNITS.toDisplay('depth', v);
  const uF  = QP_UNITS.label('force'), uD = QP_UNITS.label('depth'), uMW = QP_UNITS.label('mw');

  const _blkRaw = document.getElementById('bsBlock')?.value;
  const _mwRaw  = document.getElementById('bsMW')?.value;
  const _hlRaw  = document.getElementById('bsMaxHL')?.value;
  const blockWt = (_blkRaw==='' || _blkRaw==null) ? 35   : QP_UNITS.fromDisplay('force', +_blkRaw);  // klbf (canonical)
  const mw    = (_mwRaw==='' || _mwRaw==null) ? (_tdFluid().mudWeight || 10.0) : QP_UNITS.fromDisplay('mw', +_mwRaw); // ppg
  const maxHL = (_hlRaw==='' || _hlRaw==null) ? 0    : QP_UNITS.fromDisplay('force', +_hlRaw);       // rig hook-load limit, klbf (canonical)
  const ffLo  = +(document.getElementById('bsFFlo')?.value  || 0.20);
  const ffMid = +(document.getElementById('bsFFmid')?.value || 0.30);
  const ffHi  = +(document.getElementById('bsFFhi')?.value  || 0.40);
  const BF    = 1 - mw / 65.5;

  // Bit-at-every-depth broomstick. For each bit depth D the survey is cut at D
  // (interpolated end station, qpTruncateSurvey) and the full soft-string march
  // runs with the BHA — lengths and ODs from the BHA table — hanging from the
  // bit and drill pipe to surface. The surface hookload (block weight included)
  // is one point of the curve. The string therefore shortens as the bit comes
  // up and the collars see the inclination at THEIR depth; the old version
  // took one march at TD and read surface-minus-local load off it.
  const _sv = _tdSurvey();
  if (!_sv || _sv.length < 2) { _noData(ctx, W, H, 'Run Compute first'); return; }
  const maxMD = _sv[_sv.length - 1].md;
  const bha   = bhaGet();
  // Drill pipe lb/ft from the Casing / BHA tab (the DP row's weight ÷ length);
  // no DP row → undefined and the engine uses its table value for the DP OD.
  const dpRow = bha.components.find(c => c.type === 'Drill Pipe' && c.lengthFt > 0 && c.weightLbs > 0);
  const dpWt  = dpRow ? dpRow.weightLbs / dpRow.lengthFt : undefined;   // lb/ft
  // Bit depths: every survey station plus an even grid, so a coarse survey
  // still gives a smooth curve and a dense one keeps its kinks.
  const N_PTS = 60;
  const stationMDs = _sv.map(s => s.md).filter(m => m > 0 && m <= maxMD);
  const gridMDs = Array.from({ length: N_PTS }, (_, i) => Math.round(maxMD * (i + 1) / N_PTS));
  const depths = [...new Set([...stationMDs, ...gridMDs, maxMD])].sort((a, b) => a - b);
  const trunc = (typeof qpTruncateSurvey === 'function') ? qpTruncateSurvey : (sv) => sv;
  const hookAt = (D, ff) => {
    const res = tdCompute(trunc(_sv, D), bha, null, mw,
      { ffCased: ff, ffOpen: ff, wob_klbs: 25, dpWt_ppf: dpWt, blockWeight_klbs: blockWt, overpullMargin_lbf: 100000 });
    if (!res) return null;
    const m = res.modes;
    return { rih:    m.rih.ffSensitivity.mid.surfaceHookload_lbf    / 1000,
             pooh:   m.pooh.ffSensitivity.mid.surfaceHookload_lbf   / 1000,
             rotOff: m.rotOff.ffSensitivity.mid.surfaceHookload_lbf / 1000 };   // klbf (canonical)
  };
  const series = { rihLo: [], rihMid: [], rihHi: [], rotOff: [], poohLo: [], poohMid: [], poohHi: [] };
  const start = { x: toF(blockWt), y: 0 };                 // every curve starts at the block weight
  Object.values(series).forEach(arr => arr.push(start));
  for (const D of depths) {
    const lo = hookAt(D, ffLo), mid = hookAt(D, ffMid), hi = hookAt(D, ffHi);
    if (!lo || !mid || !hi) continue;
    const y = toD(D), P = v => ({ x: toF(Math.max(0, v)), y });
    series.rihLo.push(P(lo.rih));   series.rihMid.push(P(mid.rih));   series.rihHi.push(P(hi.rih));
    series.rotOff.push(P(mid.rotOff));
    series.poohLo.push(P(lo.pooh)); series.poohMid.push(P(mid.pooh)); series.poohHi.push(P(hi.pooh));
  }
  if (series.rihMid.length < 2) { _noData(ctx, W, H, 'Run Compute first'); return; }

  const liveCurves = [
    { pts: series.rihLo,   color: '#5a9fd4', label: `RIH FF ${ffLo}`  },
    { pts: series.rihMid,  color: '#2a7fa8', label: `RIH FF ${ffMid}` },
    { pts: series.rihHi,   color: '#1a5f88', label: `RIH FF ${ffHi}`  },
    { pts: series.rotOff,  color: '#8e44ad', label: 'Rot Off Btm'     },
    { pts: series.poohLo,  color: '#e07878', label: `PKP FF ${ffLo}`  },
    { pts: series.poohMid, color: '#c0392b', label: `PKP FF ${ffMid}` },
    { pts: series.poohHi,  color: '#8b1a1a', label: `PKP FF ${ffHi}`  },
  ];

  const xMax = Math.max(...liveCurves.flatMap(c => c.pts.map(p => p.x)), toF(maxHL), 1) * 1.1;
  const yMax = toD(maxMD);

  const g = _chartGridDepthDown(ctx, W, H, xMax, yMax, `Hookload (${uF})`, `MD (${uD})`);

  const bsNote = `BF=${BF.toFixed(3)}  MW=${QP_UNITS.toDisplay('mw',mw).toFixed(1)} ${uMW}  Block=${toF(blockWt).toFixed(0)} ${uF}`;

  CI.storeLive(CID, liveCurves);
  CI.register(CID, { pad: g, xMax, yMax, xLabel: `Hookload (${uF})`, yLabel: `MD (${uD})`, depthDown: true });
  CI.drawFrozen(ctx, CID);

  // RIH — lo/hi dashed, mid solid (blue)
  ctx.setLineDash([5, 3]);
  _chartLineDepthDown(ctx, liveCurves[0].pts, '#5a9fd4', 1.5, g, xMax, yMax);
  ctx.setLineDash([]);
  _chartLineDepthDown(ctx, liveCurves[1].pts, '#2a7fa8', 2,   g, xMax, yMax);
  ctx.setLineDash([5, 3]);
  _chartLineDepthDown(ctx, liveCurves[2].pts, '#1a5f88', 1.5, g, xMax, yMax);
  ctx.setLineDash([]);
  // Rotation Off Bottom (single curve, purple)
  _chartLineDepthDown(ctx, liveCurves[3].pts, '#8e44ad', 1.5, g, xMax, yMax);
  // POOH — lo/hi dashed, mid solid (red)
  ctx.setLineDash([5, 3]);
  _chartLineDepthDown(ctx, liveCurves[4].pts, '#e07878', 1.5, g, xMax, yMax);
  ctx.setLineDash([]);
  _chartLineDepthDown(ctx, liveCurves[5].pts, '#c0392b', 2,   g, xMax, yMax);
  ctx.setLineDash([5, 3]);
  _chartLineDepthDown(ctx, liveCurves[6].pts, '#8b1a1a', 1.5, g, xMax, yMax);
  ctx.setLineDash([]);

  // Rig hook-load limit — vertical red line
  if (maxHL > 0) _rigLimitLine(ctx, g, toF(maxHL), xMax, `Max HL ${toF(maxHL).toFixed(0)} ${uF}`);

  // ── Labels: queued, then placed clear of the legend and of each other ─────
  const pw = g.pw, ph = g.ph;
  const labelMidY = g.t + ph * 0.65;
  const bold11 = 'bold 11px sans-serif';
  // FF labels sit just inside the bottom of the plot at each curve's end, and
  // stack upward where the curves end close together
  [[2, ffHi], [1, ffMid], [0, ffLo], [4, ffLo], [5, ffMid], [6, ffHi]].forEach(([ci, ff]) => {
    const c = liveCurves[ci], last = c.pts[c.pts.length - 1];
    if (!last) return;
    _lblQueue(`${ff}FF`, g.l + (last.x / xMax) * pw, g.t + (last.y / yMax) * ph,
      { dy: -13, align: 'center', color: c.color, bounds: g, dir: -1 });
  });
  _lblQueue('Slack off', g.l + 6, labelMidY - 7, { pin: true, font: bold11, bounds: g });
  _lblQueue('Pick up', g.l + pw - 6, labelMidY - 7, { pin: true, align: 'right', font: bold11, bounds: g });
  // on the rotating curve, at the point nearest the label band
  const rotPts = liveCurves[3].pts;
  const rotMidPt = rotPts.length ? rotPts.reduce((a, p) =>
    Math.abs(g.t + (p.y / yMax) * ph - (labelMidY + 20)) < Math.abs(g.t + (a.y / yMax) * ph - (labelMidY + 20)) ? p : a) : null;
  if (rotMidPt) {
    _lblQueue('Rotation Off Bottom', g.l + (rotMidPt.x / xMax) * pw, g.t + (rotMidPt.y / yMax) * ph,
      { dx: 6, dy: -6, font: 'bold 10px sans-serif', color: '#8e44ad', bounds: g });
  }
  _lblQueue(bsNote, g.l + 4, g.t + 4, { pin: true, color: _qpColors().dim, bounds: g });

  const bsLegLabels = [`RIH ${ffLo}`, `RIH ${ffMid}`, `RIH ${ffHi}`,
     'Rot Off Btm',
     `PKP ${ffLo}`, `PKP ${ffMid}`, `PKP ${ffHi}`];
  const bsLegColors = ['#5a9fd4', '#2a7fa8', '#1a5f88',
     '#8e44ad',
     '#e07878', '#c0392b', '#8b1a1a'];
  if (maxHL > 0) { bsLegLabels.push('Rig Limit'); bsLegColors.push('#c0392b'); }
  _legend(ctx, W, g.t, bsLegLabels, bsLegColors);

  CI.drawAnnotations(ctx, CID);
}

function _chartGridDepthDown(ctx, W, H, xMax, yMax, xLabel, yLabel, opts) {
  const { t, b, l, r } = CHART_PAD;
  const pw = W - l - r, ph = H - t - b;
  const C = _qpColors();
  const bottomX = opts && opts.bottomX;
  const zw = _zoomWin(ctx, { l, t, pw, ph });
  const xSpan = xMax * (zw.fx(1) - zw.fx(0)), ySpan = yMax * (zw.fy(1) - zw.fy(0));

  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const x = l + pw * i / 5;
    const y = t + ph * i / 5;
    ctx.beginPath(); ctx.moveTo(x, t); ctx.lineTo(x, t + ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(l + pw, y); ctx.stroke();
    ctx.fillStyle = C.dim; ctx.font = '10px sans-serif';
    if (bottomX) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(_tickFmt(xMax * zw.fx(i / 5), xSpan, zw.zoomed), x, t + ph + 4);
    } else {
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(_tickFmt(xMax * zw.fx(i / 5), xSpan, zw.zoomed), x, t - 14);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(_tickFmt(yMax * zw.fy(i / 5), ySpan, zw.zoomed), l - 5, y);
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

  _zoomBegin(ctx);            // the data drawn after this goes through the zoom window
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
  const zw = _zoomWin(ctx, { l, t, pw, ph });
  const xSpan = xRange * (zw.fx(1) - zw.fx(0)), ySpan = yMax * (zw.fy(1) - zw.fy(0));

  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const x = l + pw * i / 5;
    const y = t + ph * i / 5;
    ctx.beginPath(); ctx.moveTo(x, t); ctx.lineTo(x, t + ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(l + pw, y); ctx.stroke();
    ctx.fillStyle = C.dim; ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(_tickFmt(xMin + xRange * zw.fx(i / 5), xSpan, zw.zoomed), x, t - 14);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(_tickFmt(yMax * zw.fy(i / 5), ySpan, zw.zoomed), l - 5, y);
  }

  const xZero = (xMin < 0 && xMax > 0) ? zw.sx(-xMin / xRange) : null;   // null when scrolled out of view
  if (xZero != null) {
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

  _zoomBegin(ctx);            // the data drawn after this goes through the zoom window
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
// Legend at the top-right INSIDE the plot: real text widths, wrapped onto as
// many rows as the plot width needs (it used to run a single row out past the
// left axis), on a backing panel. Reserves its box, then places the queued
// labels around it. `bounds` = {l, pw} of the plot; defaults to CHART_PAD.
function _legend(ctx, W, t, labels, colors, bounds) {
  _zoomEnd(ctx);                                          // the legend is fixed on screen
  const C = _qpColors();
  const l  = bounds ? bounds.l  : CHART_PAD.l;
  const pw = bounds ? bounds.pw : W - CHART_PAD.l - CHART_PAD.r;
  ctx.save();
  ctx.font = '10px sans-serif';
  const SW = 14, GAP = 4, ITEM_GAP = 12, ROW_H = 14, PADX = 6, PADY = 3;
  const maxW = Math.max(60, pw - 8 - 2 * PADX);
  const items = labels.map((lbl, i) => ({ lbl, color: colors[i], w: SW + GAP + ctx.measureText(lbl).width }));
  const rows = [[]]; let rowW = 0;
  items.forEach(it => {
    const add = (rows[rows.length - 1].length ? ITEM_GAP : 0) + it.w;
    if (rows[rows.length - 1].length && rowW + add > maxW) { rows.push([it]); rowW = it.w; }
    else { rows[rows.length - 1].push(it); rowW += add; }
  });
  const widthOf = r => r.reduce((a, it, k) => a + it.w + (k ? ITEM_GAP : 0), 0);
  const blockW = Math.min(Math.max(...rows.map(widthOf)), maxW) + 2 * PADX;
  const blockH = rows.length * ROW_H + 2 * PADY;
  const right = l + pw - 4, top = t + 3;
  if (labels.length) {
    ctx.globalAlpha = 0.86; ctx.fillStyle = C.bg;
    ctx.fillRect(right - blockW, top, blockW, blockH);
    ctx.globalAlpha = 1;
    _lblReserve(right - blockW, top, blockW, blockH, true);
    rows.forEach((r, ri) => {
      let x = right - PADX - widthOf(r);
      const y = top + PADY + ri * ROW_H + ROW_H / 2;
      r.forEach(it => {
        ctx.fillStyle = it.color;
        ctx.fillRect(x, y - 2, SW, 4);
        ctx.fillStyle = C.text; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(it.lbl, x + SW + GAP, y);
        x += it.w + ITEM_GAP;
      });
    });
  }
  ctx.restore();
  _lblFlush(ctx);
}

// One line of text centred on cx that must fit maxW: shrinks the font (down to
// 8px), then ends in an ellipsis. Uses the font / fillStyle / baseline already set.
function _fitText(ctx, text, cx, y, maxW) {
  ctx.save();
  ctx.textAlign = 'center';
  const m = ctx.font.match(/(\d+(?:\.\d+)?)px/);
  let px = m ? +m[1] : 10;
  while (px > 8 && ctx.measureText(text).width > maxW) { px -= 0.5; ctx.font = ctx.font.replace(/\d+(?:\.\d+)?px/, px + 'px'); }
  let t = text;
  while (t.length > 4 && ctx.measureText(t).width > maxW) t = t.slice(0, -2).trimEnd() + '…';
  ctx.fillText(t, cx, y);
  ctx.restore();
}

// The string outputs (Torque, Buckling, Overpull, Broomstick, SPP / ECD,
// Surge / Swab) need the string from the Casing / BHA tab. With an empty BHA
// table the engines used to run on built-in defaults (5" drill pipe at
// 19.5 lb/ft, 8.5" bit) and plot a string the user never entered — now the
// panel says what is missing instead. Returns true when it drew the message.
function _bhaMissing() {
  return !(typeof bhaGet === 'function' && bhaGet().components.length);
}
function _noBha(ctx, W, H, canvasId) {
  if (!_bhaMissing()) return false;
  _noData(ctx, W, H, 'Add BHA components first (Casing / BHA tab)');
  if (canvasId && typeof CI !== 'undefined') {            // no stale crosshair / freeze data
    CI.storeLive(canvasId, []);
    CI.register(canvasId, { pad: { l: 0, t: 0, pw: 0, ph: 0 }, xMax: 1, yMax: 1, xLabel: '', yLabel: '' });
  }
  return true;
}

function _noData(ctx, W, H, msg) {
  _zoomEnd(ctx);
  ctx.fillStyle = _qpColors().dim; ctx.font = '13px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(msg, W / 2, H / 2);
}
