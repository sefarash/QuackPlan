// ===== TRAJECTORY PLOT =====
// Two-panel view: Vertical Section (TVD vs departure) + Plan View (N vs E)

// ── Draggable shoe labels (VS panel) ─────────────────────────────────────────
const _vsDrag = { offsets: new Map(), areas: [], active: null, _sid: null };

function _vsStorageKey() { return `qp_vs_offsets_${qpState.currentScenarioId || 'none'}`; }

function _vsSave() {
  const obj = {};
  _vsDrag.offsets.forEach((v, k) => { obj[k] = v; });
  localStorage.setItem(_vsStorageKey(), JSON.stringify(obj));
}

function _vsLoad() {
  const sid = qpState.currentScenarioId || 'none';
  if (_vsDrag._sid === sid) return;
  _vsDrag._sid = sid;
  _vsDrag.offsets.clear();
  try {
    const raw = localStorage.getItem(_vsStorageKey());
    if (raw) Object.entries(JSON.parse(raw)).forEach(([k, v]) => _vsDrag.offsets.set(k, v));
  } catch (_) {}
}

function _vsInitDrag(canvas) {
  if (canvas._vsDragReady) return;
  canvas._vsDragReady = true;

  const hit = (mx, my) => _vsDrag.areas.find(
    a => mx >= a.x && mx <= a.x + a.w && my >= a.y && my <= a.y + a.h
  );

  // Casing labels are drawn in screen space (they keep their size when the plot
  // is zoomed), so hit-testing and drag offsets are plain canvas pixels.
  const pos = e => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener('mousedown', e => {
    const p = pos(e);
    const a = hit(p.x, p.y);
    if (!a) return;
    if (typeof QP_ZOOM !== 'undefined') QP_ZOOM.cancelPan();      // dragging a label, not the view
    const off = _vsDrag.offsets.get(a.key) || { dx: 0, dy: 0 };
    _vsDrag.active = { key: a.key, startX: p.x, startY: p.y, origDX: off.dx, origDY: off.dy };
  });

  canvas.addEventListener('mousemove', e => {
    const { x: mx, y: my } = pos(e);
    if (!_vsDrag.active) { canvas.style.cursor = hit(mx, my) ? 'grab' : ''; return; }
    canvas.style.cursor = 'grabbing';
    const { key, startX, startY, origDX, origDY } = _vsDrag.active;
    _vsDrag.offsets.set(key, { dx: origDX + mx - startX, dy: origDY + my - startY });
    _drawVS(qpState.survey);
  });

  canvas.addEventListener('mouseup', () => {
    if (_vsDrag.active) _vsSave();
    _vsDrag.active = null;
    canvas.style.cursor = '';
  });
  canvas.addEventListener('mouseleave', () => { _vsDrag.active = null; });

  // Double-click resets label to default position
  canvas.addEventListener('dblclick', e => {
    const p = pos(e);
    const a = hit(p.x, p.y);
    if (!a) return;
    _vsDrag.offsets.delete(a.key);
    _vsSave();
    _drawVS(qpState.survey);
  });
}

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

  // After VS draws, copy its computed canvas.height to the Plan canvas so
  // _chartSetup picks up the same number via getBoundingClientRect.
  const vsCanvas   = document.getElementById('trajVsCanvas');
  const planCanvas = document.getElementById('trajPlanCanvas');
  if (vsCanvas && planCanvas && vsCanvas.height > 0) {
    planCanvas.style.height = vsCanvas.height + 'px';
  }

  _drawPlan(survey);
}

// ── Vertical Section ──────────────────────────────────────────────────────────

function _drawVS(survey) {
  const CID = 'trajVsCanvas';
  const c = _chartSetup(CID);
  if (!c) return;
  const { ctx, W, H } = c;

  _vsInitDrag(document.getElementById(CID));
  _vsLoad();
  _vsDrag.areas = [];

  // Positions/labels shown in display units; survey stays imperial (canonical),
  // so _interpSurvey lookups below still use imperial MD.
  const toD = v => QP_UNITS.toDisplay('depth', v);
  const uD  = QP_UNITS.label('depth');

  const dense = _densify(survey, 50);
  const pts = dense.map(s => ({
    dep: toD(Math.sqrt(s.north * s.north + s.east * s.east)),
    tvd: toD(s.tvd),
    md:  toD(s.md),
  }));

  const xMax = Math.max(...pts.map(p => p.dep), 10)  * 1.18;
  const yMax = Math.max(...pts.map(p => p.tvd), 100) * 1.10;

  const g = _chartGridDepthDown(ctx, W, H, xMax, yMax, '', `TVD (${uD})`, { bottomX: true });
  const C = _qpColors();

  // Title
  ctx.fillStyle = C.text; ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Vertical View', g.l + g.pw / 2, g.t - 14);

  // Register with CI and draw frozen
  CI.storeLive(CID, [{ pts: pts.map(p => ({ x: p.dep, y: p.tvd })), color: '#1a5f7a', label: 'VS' }]);
  CI.register(CID, { pad: g, xMax, yMax, xLabel: `Departure (${uD})`, yLabel: `TVD (${uD})`, depthDown: true });
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
  // Drawn in screen space so the 3-line labels keep their size and spacing when
  // the plot is zoomed; SP maps a base point through the zoom window.
  const ZM = (typeof QP_ZOOM !== 'undefined') ? QP_ZOOM : null;
  const SP = (x, y) => ZM ? ZM.pt(CID, x, y) : { x, y };
  const LINE_H = 12;   // px per text line
  const LBL_H  = LINE_H * 3 + 4;  // total label block height (3 lines)

  const shoeItems = [];
  _readSchematicRows().forEach(row => {
    const md = +(row.bot || 0);           // imperial
    if (!md) return;
    const st  = _interpSurvey(survey, md);
    const dep = toD(Math.sqrt(st.north * st.north + st.east * st.east));
    // Screen position (through the zoom window); a shoe outside the view is skipped
    const sp  = SP(g.l + (dep / xMax) * g.pw, g.t + (toD(st.tvd) / yMax) * g.ph);
    if (ZM && !ZM.visible(CID, sp.x, sp.y, 2)) return;
    const sy  = sp.y, bx = sp.x;
    if (sy < g.t - 2 || sy > g.t + g.ph + 2) return;

    const grade = row.grade     || '';
    const wt    = row.nomWt_ppf ? `${row.nomWt_ppf}ppf` : '';
    const line1 = (grade || wt)
      ? `${row.size}" ${grade}${wt ? ' ' + wt : ''}`.trim()
      : `${row.size}" ${row.def}`;

    shoeItems.push({
      sy, bx,
      lines: [
        line1,
        `TVD: ${Math.round(toD(st.tvd)).toLocaleString()}${uD}`,
        `MD: ${Math.round(toD(md)).toLocaleString()}${uD}`,
      ],
    });
  });

  // Sort top→bottom; label-top anchors just BELOW the shoe dashed line, deconflict downward
  shoeItems.sort((a, b) => a.sy - b.sy);
  shoeItems.forEach((it, i) => {
    it.ly = it.sy + 5;                      // preferred: just below the dashed line
    if (i > 0) {
      const prev = shoeItems[i - 1];
      const prevBottom = prev.ly + LBL_H;
      if (it.ly < prevBottom + 4) it.ly = prevBottom + 4;
    }
  });
  // …and back up from the bottom, so the deepest label is never cut off by the
  // canvas edge on a short chart
  for (let i = shoeItems.length - 1; i >= 0; i--) {
    const floor = (i === shoeItems.length - 1 ? H - 3 : shoeItems[i + 1].ly - 4) - LBL_H;
    if (shoeItems[i].ly > floor) shoeItems[i].ly = Math.max(g.t + 2, floor);
  }

  // Draw dashes + triangles first (behind labels)
  if (ZM) ZM.pause(ctx);
  shoeItems.forEach(({ sy, bx }) => {
    ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
    ctx.beginPath(); ctx.moveTo(g.l, sy); ctx.lineTo(bx, sy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#2a7fa8';
    ctx.beginPath();
    ctx.moveTo(bx - 6, sy - 6); ctx.lineTo(bx + 6, sy - 6); ctx.lineTo(bx, sy + 4);
    ctx.closePath(); ctx.fill();
  });

  // Draw multi-line labels with drag offset + halo for contrast
  ctx.lineJoin = 'round';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  shoeItems.forEach(({ bx, sy, ly, lines }) => {
    const key = lines[0];
    const off = _vsDrag.offsets.get(key) || { dx: 0, dy: 0 };
    // Widest line of the label → keep the whole label on the canvas: to the
    // right of the shoe when it fits, else to its left (never clipped).
    const lblW = Math.max(...lines.map((line, li) => {
      ctx.font = (li === 0 ? 'bold ' : '') + '9px sans-serif';
      return ctx.measureText(line).width;
    }));
    let lx = bx + 9 + off.dx;
    if (lx + lblW > W - 3) lx = (bx - 9 - lblW >= 2 && !off.dx) ? bx - 9 - lblW : W - 3 - lblW;
    lx = Math.max(2, lx);
    const fy = Math.max(2, Math.min(ly + off.dy, H - 3 - LBL_H));

    // Thin vertical leader when label is displaced from its shoe line
    const displaced = fy > sy + LBL_H || off.dx !== 0 || off.dy !== 0;
    if (displaced) {
      ctx.strokeStyle = C.border; ctx.lineWidth = 0.5; ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.moveTo(bx + 2, sy + 4); ctx.lineTo(lx - 2, fy); ctx.stroke();
      ctx.setLineDash([]);
    }

    lines.forEach((line, li) => {
      const y    = fy + li * LINE_H;
      const bold = li === 0;
      ctx.font = (bold ? 'bold ' : '') + '9px sans-serif';
      ctx.strokeStyle = 'rgba(248,251,253,0.92)'; ctx.lineWidth = 3;
      ctx.strokeText(line, lx, y);
      ctx.fillStyle = bold ? C.text : C.dim;
      ctx.fillText(line, lx, y);
    });

    // Record hit area for drag detection
    _vsDrag.areas.push({ key, x: lx - 2, y: fy - 2, w: 150, h: LBL_H + 4 });
    _lblReserve(lx - 2, fy - 1, lblW + 4, LBL_H + 2, true);     // later labels keep clear of it
  });
  if (ZM) ZM.resume(ctx);

  // ── MD tick labels ── (interval nice in display units; interp stays imperial)
  const last     = pts[pts.length - 1];               // pts.md is display
  const interval = _niceInterval(last.md, 6);         // display interval
  ctx.fillStyle = C.dim; ctx.font = '9px sans-serif';
  for (let mdD = interval; mdD < last.md - interval * 0.5; mdD += interval) {
    const st  = _interpSurvey(survey, QP_UNITS.fromDisplay('depth', mdD));
    const dep = toD(Math.sqrt(st.north * st.north + st.east * st.east));
    const px  = g.l + (dep       / xMax) * g.pw;
    const py  = g.t + (toD(st.tvd) / yMax) * g.ph;
    ctx.fillStyle = C.border;
    ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fill();
    // Left of the curve when there is room inside the plot, else to its right
    const mdTxt = Math.round(mdD) + ' ' + uD;
    const onLeft = SP(px, py).x - 3 - ctx.measureText(mdTxt).width >= g.l + 2;
    _lblQueue(mdTxt, px, py,
      { dx: onLeft ? -3 : 6, dy: -12, align: onLeft ? 'right' : 'left', color: C.dim,
        bounds: { l: g.l, t: g.t, pw: W - g.l, ph: g.ph } });
  }

  // ── Surface marker ──
  ctx.fillStyle = '#2a7fa8';
  ctx.beginPath(); ctx.arc(g.l, g.t, 5, 0, Math.PI * 2); ctx.fill();
  const allCanvas = { l: 0, t: 0, pw: W, ph: H };
  _lblPending.unshift({ text: `Surface  0 ${uD} MD`, x: g.l, y: g.t,
                        opt: { dx: 8, dy: 3, bounds: { l: g.l, t: g.t, pw: W - g.l, ph: g.ph } } });

  // ── TD marker ── (last.dep/tvd/md already in display units)
  const tdx = g.l + (last.dep / xMax) * g.pw;
  const tdy = g.t  + (last.tvd / yMax) * g.ph;
  ctx.fillStyle = '#c0392b';
  ctx.beginPath(); ctx.arc(tdx, tdy, 5, 0, Math.PI * 2); ctx.fill();
  // One line, placed clear of the shoe labels and kept on the canvas (it used
  // to run off the right edge on top of the deepest shoe label)
  _lblReserve(tdx - 6, tdy - 6, 12, 12);
  const tdTxt = `TD  ${Math.round(last.tvd).toLocaleString()} ${uD} TVD · ${Math.round(last.md).toLocaleString()} ${uD} MD`;
  ctx.font = 'bold 9px sans-serif';
  const tdLeft = SP(tdx, tdy).x + 8 + ctx.measureText(tdTxt).width > W - 3;
  _lblPending.unshift({ text: tdTxt, x: tdx, y: tdy,
                        opt: { dx: tdLeft ? -8 : 8, dy: -16, align: tdLeft ? 'right' : 'left',
                               font: 'bold 9px sans-serif', bounds: allCanvas, dir: -1 } });
  _lblFlush(ctx);

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

  // Positioning stays imperial (self-scaling); only labels convert to display
  const toD = v => QP_UNITS.toDisplay('depth', v);
  const uD  = QP_UNITS.label('depth');

  // Grid — lines fixed on screen, values follow the zoom window (chart-zoom.js);
  // a plan view keeps equal scales on both axes, so its zoom is uniform.
  const ticks = 4;
  const C = _qpColors();
  const zw = _zoomWin(ctx, { l: PP.l, t: PP.t, pw, ph }, { uniform: true });
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  for (let i = 0; i <= ticks; i++) {
    const gx = PP.l + pw * i / ticks, gy = PP.t + ph * (1 - i / ticks);
    const e = E0 + zw.fx(i / ticks) * range;
    const n = N0 + (1 - zw.fy(1 - i / ticks)) * range;
    ctx.beginPath(); ctx.moveTo(gx, PP.t); ctx.lineTo(gx, PP.t + ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PP.l, gy); ctx.lineTo(PP.l + pw, gy); ctx.stroke();
    ctx.fillStyle = C.dim; ctx.font = '8px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(_shortNum(toD(e)), gx, PP.t + ph + 3);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(_shortNum(toD(n)), PP.l - 2, gy);
  }
  ctx.strokeStyle = C.border; ctx.lineWidth = 1.5;
  ctx.strokeRect(PP.l, PP.t, pw, ph);

  // Axis labels
  ctx.fillStyle = C.dim; ctx.font = '10px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(`Easting (${uD})`, PP.l + pw / 2, H - 16);
  ctx.save(); ctx.translate(13, PP.t + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText(`Northing (${uD})`, 0, 0); ctx.restore();

  // Title
  ctx.fillStyle = C.text; ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Plan View', PP.l + pw / 2, PP.t - 14);

  // Wellpath
  _zoomBegin(ctx);            // the data drawn after this goes through the zoom window
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

  // North arrow + legend: fixed on screen
  _zoomEnd(ctx);
  // North arrow (inside top-right of plot)
  const arX = PP.l + pw - 18, arY = PP.t + 26;
  ctx.strokeStyle = C.text; ctx.fillStyle = C.text; ctx.lineWidth = 1.5;
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
  ctx.fillStyle = C.text; ctx.font = '9px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('Wellhead', PP.l + 13, PP.t + ph - 18);
  ctx.fillText('TD', PP.l + 13, PP.t + ph - 6);

  // Register plan view with CI (offset coordinates so tooltip shows real E/N)
  CI.register(CID, {
    pad: { l: PP.l, t: PP.t, pw, ph },
    xMax: toD(range), yMax: toD(range),
    xLabel: `Easting (${uD})`, yLabel: `Northing (${uD})`,
    depthDown: false,
    xOffset: toD(E0), yOffset: toD(N0),
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

function _shortNum(v) {
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toFixed(1) + 'k';
  return Math.round(v).toString();
}
