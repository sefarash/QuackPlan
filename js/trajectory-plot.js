// ===== TRAJECTORY PLOT =====
// Two-panel view: Vertical Section (TVD vs departure) + Plan View (N vs E)

function drawTrajPlot() {
  const survey = qpState.survey;
  if (!survey || survey.length < 2) {
    ['trajVsCanvas', 'trajPlanCanvas'].forEach(id => {
      const c = _chartSetup(id);
      if (c) _noData(c.ctx, c.W, c.H, 'Add trajectory stations and Compute');
    });
    return;
  }
  _drawVS(survey);
  _drawPlan(survey);
}

// ── Vertical Section ──────────────────────────────────────────────────────────

function _drawVS(survey) {
  const CID = 'trajVsCanvas';
  const c = _chartSetup(CID);
  if (!c) return;
  const { ctx, W, H } = c;

  const dense = _densify(survey, 50);
  const pts = dense.map(s => ({
    dep: Math.sqrt(s.north * s.north + s.east * s.east),
    tvd: s.tvd,
    md:  s.md,
  }));

  const xMax = Math.max(...pts.map(p => p.dep), 10)  * 1.18;
  const yMax = Math.max(...pts.map(p => p.tvd), 100) * 1.10;

  const g = _chartGridDepthDown(ctx, W, H, xMax, yMax, 'Horizontal Departure (ft)', 'TVD (ft)');

  // Title
  ctx.fillStyle = '#1a2b38'; ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Vertical Section', g.l + g.pw / 2, g.t - 14);

  // Register with CI and draw frozen
  CI.storeLive(CID, [{ pts: pts.map(p => ({ x: p.dep, y: p.tvd })), color: '#1a5f7a', label: 'VS' }]);
  CI.register(CID, { pad: g, xMax, yMax, xLabel: 'Departure (ft)', yLabel: 'TVD (ft)', depthDown: true });
  CI.drawFrozen(ctx, CID);

  // ── Wellpath line ──
  ctx.strokeStyle = '#1a5f7a'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = g.l + (p.dep / xMax) * g.pw;
    const y = g.t  + (p.tvd / yMax) * g.ph;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // ── Casing / liner shoe markers ──
  _readSchematicRows().forEach(row => {
    const md = +(row.bot || 0);
    if (!md) return;
    const st  = _interpSurvey(survey, md);
    const dep = Math.sqrt(st.north * st.north + st.east * st.east);
    const sy  = g.t + (st.tvd / yMax) * g.ph;
    const bx  = g.l + (dep   / xMax)  * g.pw;
    if (sy < g.t - 2 || sy > g.t + g.ph + 2) return;

    // Dashed horizontal line to shoe
    ctx.strokeStyle = '#9ecce3'; ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
    ctx.beginPath(); ctx.moveTo(g.l, sy); ctx.lineTo(bx, sy); ctx.stroke();
    ctx.setLineDash([]);

    // Shoe triangle (pointing down = casing shoe convention)
    ctx.fillStyle = '#2a7fa8';
    ctx.beginPath();
    ctx.moveTo(bx - 6, sy - 6);
    ctx.lineTo(bx + 6, sy - 6);
    ctx.lineTo(bx, sy + 4);
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = '#1a2b38'; ctx.font = '9px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`${row.size}" ${row.def}  ${Math.round(st.tvd)}'TVD`, bx + 9, sy);
  });

  // ── MD tick labels ──
  const last     = pts[pts.length - 1];
  const interval = _niceInterval(last.md, 6);
  ctx.fillStyle = '#5a7a8e'; ctx.font = '9px sans-serif';
  for (let md = interval; md < last.md - interval * 0.5; md += interval) {
    const st  = _interpSurvey(survey, md);
    const dep = Math.sqrt(st.north * st.north + st.east * st.east);
    const px  = g.l + (dep    / xMax) * g.pw;
    const py  = g.t + (st.tvd / yMax) * g.ph;
    ctx.fillStyle = '#9ecce3';
    ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5a7a8e';
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText(Math.round(md) + "'", px - 3, py - 2);
  }

  // ── Surface marker ──
  ctx.fillStyle = '#2a7fa8';
  ctx.beginPath(); ctx.arc(g.l, g.t, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a2b38'; ctx.font = '9px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('Surface  0\' MD', g.l + 7, g.t - 1);

  // ── TD marker ──
  const tdx = g.l + (last.dep / xMax) * g.pw;
  const tdy = g.t  + (last.tvd / yMax) * g.ph;
  ctx.fillStyle = '#c0392b';
  ctx.beginPath(); ctx.arc(tdx, tdy, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a2b38'; ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const tdIndent = ctx.measureText('TD  ').width;
  ctx.fillText(`TD  ${Math.round(last.tvd).toLocaleString()}' TVD`, tdx + 7, tdy + 2);
  ctx.fillText(`${Math.round(last.md).toLocaleString()}' MD`,       tdx + 7 + tdIndent, tdy + 13);

  CI.drawAnnotations(ctx, CID);
}

// ── Plan View ─────────────────────────────────────────────────────────────────

function _drawPlan(survey) {
  const CID = 'trajPlanCanvas';
  const c = _chartSetup(CID);
  if (!c) return;
  const { ctx, W, H } = c;

  const PP = { t: 38, b: 42, l: 54, r: 20 };
  const pw = W - PP.l - PP.r;
  const ph = H - PP.t - PP.b;

  // Bounds — always include origin (wellhead)
  const norths = survey.map(s => s.north);
  const easts  = survey.map(s => s.east);
  const nMin = Math.min(0, ...norths), nMax = Math.max(0, ...norths);
  const eMin = Math.min(0, ...easts),  eMax = Math.max(0, ...easts);

  const margin = Math.max(nMax - nMin, eMax - eMin, 30) * 0.20 + 30;
  const nMid   = (nMin + nMax) / 2;
  const eMid   = (eMin + eMax) / 2;
  const range  = Math.max(nMax - nMin, eMax - eMin) + 2 * margin;
  const N0 = nMid - range / 2;
  const E0 = eMid - range / 2;

  // Canvas-space converters (north up)
  const toX = e => PP.l + ((e - E0) / range) * pw;
  const toY = n => PP.t + (1 - (n - N0) / range) * ph;

  // Grid
  const ticks = 4;
  ctx.strokeStyle = '#e8f0f5'; ctx.lineWidth = 1;
  for (let i = 0; i <= ticks; i++) {
    const e = E0 + (i / ticks) * range;
    const n = N0 + (i / ticks) * range;
    ctx.beginPath(); ctx.moveTo(toX(e), PP.t); ctx.lineTo(toX(e), PP.t + ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PP.l, toY(n)); ctx.lineTo(PP.l + pw, toY(n)); ctx.stroke();
    ctx.fillStyle = '#5a7a8e'; ctx.font = '8px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(_shortFt(e), toX(e), PP.t + ph + 3);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(_shortFt(n), PP.l - 2, toY(n));
  }
  ctx.strokeStyle = '#9ecce3'; ctx.lineWidth = 1.5;
  ctx.strokeRect(PP.l, PP.t, pw, ph);

  // Axis labels
  ctx.fillStyle = '#5a7a8e'; ctx.font = '10px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('Easting (ft)', PP.l + pw / 2, H - 16);
  ctx.save(); ctx.translate(13, PP.t + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('Northing (ft)', 0, 0); ctx.restore();

  // Title
  ctx.fillStyle = '#1a2b38'; ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Plan View', PP.l + pw / 2, PP.t - 14);

  // Wellpath
  ctx.strokeStyle = '#1a5f7a'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
  ctx.beginPath();
  _densify(survey, 50).forEach((s, i) => {
    i === 0 ? ctx.moveTo(toX(s.east), toY(s.north))
            : ctx.lineTo(toX(s.east), toY(s.north));
  });
  ctx.stroke();

  // Wellhead
  ctx.fillStyle = '#2a7fa8';
  ctx.beginPath(); ctx.arc(toX(0), toY(0), 5, 0, Math.PI * 2); ctx.fill();

  // TD
  const last = survey[survey.length - 1];
  ctx.fillStyle = '#c0392b';
  ctx.beginPath(); ctx.arc(toX(last.east), toY(last.north), 5, 0, Math.PI * 2); ctx.fill();

  // North arrow (inside top-right of plot)
  const arX = PP.l + pw - 18, arY = PP.t + 26;
  ctx.strokeStyle = '#1a2b38'; ctx.fillStyle = '#1a2b38'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(arX, arY + 16); ctx.lineTo(arX, arY - 16); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(arX, arY - 16); ctx.lineTo(arX - 5, arY - 4); ctx.lineTo(arX + 5, arY - 4);
  ctx.closePath(); ctx.fill();
  ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('N', arX, arY - 18);

  // Legend dots
  ctx.fillStyle = '#2a7fa8';
  ctx.beginPath(); ctx.arc(PP.l + 6, PP.t + ph - 18, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c0392b';
  ctx.beginPath(); ctx.arc(PP.l + 6, PP.t + ph - 6, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a2b38'; ctx.font = '9px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('Wellhead', PP.l + 13, PP.t + ph - 18);
  ctx.fillText('TD', PP.l + 13, PP.t + ph - 6);

  // Register plan view with CI (offset coordinates so tooltip shows real E/N)
  CI.register(CID, {
    pad: { l: PP.l, t: PP.t, pw, ph },
    xMax: range, yMax: range,
    xLabel: 'Easting (ft)', yLabel: 'Northing (ft)',
    depthDown: false,
    xOffset: E0, yOffset: N0,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _interpSurvey(survey, md) {
  if (md <= survey[0].md) return { ...survey[0] };
  const last = survey[survey.length - 1];
  if (md >= last.md) return { ...last };
  for (let i = 1; i < survey.length; i++) {
    if (survey[i].md >= md) {
      const f    = (md - survey[i - 1].md) / (survey[i].md - survey[i - 1].md);
      const lerp = (a, b) => a + f * (b - a);
      return {
        md,
        tvd:   lerp(survey[i - 1].tvd,   survey[i].tvd),
        north: lerp(survey[i - 1].north, survey[i].north),
        east:  lerp(survey[i - 1].east,  survey[i].east),
        inc:   lerp(survey[i - 1].inc,   survey[i].inc),
      };
    }
  }
  return { ...last };
}

// Sub-sample each survey segment into `step`-ft increments using min curvature arcs
function _densify(survey, step) {
  const DEG = Math.PI / 180;
  if (survey.length < 2) return survey.slice();
  const result = [{ ...survey[0] }];

  for (let i = 0; i < survey.length - 1; i++) {
    const s0 = survey[i];
    const s1 = survey[i + 1];
    const segDMD = s1.md - s0.md;
    if (segDMD < 0.01) continue;

    const nSub = Math.max(1, Math.ceil(segDMD / step));
    for (let j = 1; j <= nSub; j++) {
      if (j === nSub) { result.push({ ...s1 }); continue; }

      const f      = j / nSub;
      const subInc = s0.inc + f * (s1.inc - s0.inc);
      const subAz  = (s0.az || 0) + f * ((s1.az || 0) - (s0.az || 0));
      const dMD    = f * segDMD;

      const i1 = s0.inc * DEG, i2 = subInc * DEG;
      const a1 = (s0.az || 0) * DEG, a2 = subAz * DEG;
      const cosDL = Math.cos(i2 - i1) - Math.sin(i1) * Math.sin(i2) * (1 - Math.cos(a2 - a1));
      const DL = Math.acos(Math.max(-1, Math.min(1, cosDL)));
      const RF = DL < 1e-10 ? 1 : (2 / DL) * Math.tan(DL / 2);

      result.push({
        md:    s0.md   + dMD,
        inc:   subInc,
        az:    subAz,
        tvd:   s0.tvd   + (dMD / 2) * (Math.cos(i1) + Math.cos(i2)) * RF,
        north: s0.north + (dMD / 2) * (Math.sin(i1) * Math.cos(a1) + Math.sin(i2) * Math.cos(a2)) * RF,
        east:  s0.east  + (dMD / 2) * (Math.sin(i1) * Math.sin(a1) + Math.sin(i2) * Math.sin(a2)) * RF,
      });
    }
  }
  return result;
}

function _niceInterval(maxVal, targetCount) {
  const rough = maxVal / targetCount;
  const mag   = Math.pow(10, Math.floor(Math.log10(rough || 1)));
  const nice  = [1, 2, 2.5, 5, 10].find(m => mag * m >= rough) || 10;
  return mag * nice;
}

function _shortFt(v) {
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(1) + 'k';
  return Math.round(v).toString();
}
