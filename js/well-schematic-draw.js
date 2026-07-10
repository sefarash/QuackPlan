// ===== WELL SCHEMATIC DRAW =====
// Draws the always-visible right-panel schematic as a concentric casing diagram.

// ── Draggable label state ─────────────────────────────────────────────────────
const _schDrag = { offsets: new Map(), areas: [], active: null, _sid: null };

function _schStorageKey() { return `qp_sch_offsets_${qpState.currentScenarioId || 'none'}`; }

function _schSave() {
  const obj = {};
  _schDrag.offsets.forEach((v, k) => { obj[k] = v; });
  localStorage.setItem(_schStorageKey(), JSON.stringify(obj));
}

function _schLoad() {
  const sid = qpState.currentScenarioId || 'none';
  if (_schDrag._sid === sid) return;
  _schDrag._sid = sid;
  _schDrag.offsets.clear();
  try {
    const raw = localStorage.getItem(_schStorageKey());
    if (raw) Object.entries(JSON.parse(raw)).forEach(([k, v]) => _schDrag.offsets.set(k, v));
  } catch (_) {}
}

function _schInitDrag(canvas) {
  if (canvas._schDragReady) return;
  canvas._schDragReady = true;

  const hit = (mx, my) => _schDrag.areas.find(
    a => mx >= a.x && mx <= a.x + a.w && my >= a.y && my <= a.y + a.h
  );

  canvas.addEventListener('mousedown', e => {
    const r = canvas.getBoundingClientRect();
    const a = hit(e.clientX - r.left, e.clientY - r.top);
    if (!a) return;
    const off = _schDrag.offsets.get(a.key) || { dx: 0, dy: 0 };
    _schDrag.active = { key: a.key, startX: e.clientX - r.left, startY: e.clientY - r.top, origDX: off.dx, origDY: off.dy };
  });

  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (!_schDrag.active) { canvas.style.cursor = hit(mx, my) ? 'grab' : ''; return; }
    canvas.style.cursor = 'grabbing';
    const { key, startX, startY, origDX, origDY } = _schDrag.active;
    _schDrag.offsets.set(key, { dx: origDX + mx - startX, dy: origDY + my - startY });
    if (qpState.survey?.length > 1) drawSchematic(qpState.survey);
  });

  canvas.addEventListener('mouseup', () => {
    if (_schDrag.active) _schSave();
    _schDrag.active = null;
    canvas.style.cursor = '';
  });
  canvas.addEventListener('mouseleave', () => { _schDrag.active = null; });

  // Double-click resets label to auto position
  canvas.addEventListener('dblclick', e => {
    const r = canvas.getBoundingClientRect();
    const a = hit(e.clientX - r.left, e.clientY - r.top);
    if (!a) return;
    _schDrag.offsets.delete(a.key);
    _schSave();
    if (qpState.survey?.length > 1) drawSchematic(qpState.survey);
  });
}

function _mdToTVD(survey, md) {
  if (!survey || survey.length === 0) return md;
  if (md <= survey[0].md) return survey[0].tvd;
  for (let i = 1; i < survey.length; i++) {
    if (md <= survey[i].md) {
      const t = (md - survey[i - 1].md) / (survey[i].md - survey[i - 1].md);
      return survey[i - 1].tvd + t * (survey[i].tvd - survey[i - 1].tvd);
    }
  }
  return survey[survey.length - 1].tvd;
}

function drawSchematic(survey) {
  const canvas = document.getElementById('schematicCanvas');
  if (!canvas) return;

  const wrap = canvas.parentElement;
  canvas.width  = wrap.clientWidth  || 300;
  canvas.height = wrap.clientHeight || 600;

  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  _schInitDrag(canvas);
  _schLoad();
  _schDrag.areas = [];

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8fbfd';
  ctx.fillRect(0, 0, W, H);

  const lastSurvey = survey && survey[survey.length - 1];

  if (!lastSurvey || survey.length < 2) {
    ctx.fillStyle = '#9ecce3';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Add trajectory stations', W / 2, H / 2);
    return;
  }

  const schRows  = _readSchematicRows();
  const maxDepth = Math.max(lastSurvey.md, ...schRows.map(r => +(r.bot || 0)), 1);

  // Positions stay in imperial (self-scaling); depth LABELS convert to display
  const _toD    = v => QP_UNITS.toDisplay('depth', v);
  const _uD     = QP_UNITS.label('depth');
  const _uTick  = QP_UNITS.isMetric() ? 'm' : "'";

  // ── Layout ─────────────────────────────────────────────────────────────────
  const PAD_T = 90, PAD_B = 24, PAD_L = 46, PAD_R = 8;
  const plotH  = H - PAD_T - PAD_B;
  const scaleY = plotH / maxDepth;

  // For onshore wells, casings whose top=0 (RKB) are drawn starting at the GL line
  const _d = qpState.wellDatums;
  const _MIN_GAP = 24;
  let y_GL_casing = PAD_T; // default: no adjustment
  let glCasingMD  = 0;     // ground-level MD (seabed offshore / GL onshore); the
                           // top=0 → GL clamp only applies to casing set BELOW this,
                           // else a casing shallower than the mudline would invert.
  if (_d && _d.environment === 'offshore') {
    // Offshore: top=0 casings start at seabed (or at MSL if no water depth set)
    const seabedMD  = (_d.rkb || 0) + (_d.seaBedDepth || 0);
    glCasingMD      = seabedMD;
    const _ySB_sc   = PAD_T + Math.min(seabedMD, maxDepth) * scaleY;
    y_GL_casing = Math.max(_ySB_sc, PAD_T + _MIN_GAP);
  } else if (_d && _d.environment !== 'offshore' && (_d.rkb || 0) > 0) {
    glCasingMD      = _d.rkb;
    const _yGL_sc = PAD_T + Math.min(_d.rkb, maxDepth) * scaleY;
    y_GL_casing = Math.max(_yGL_sc, PAD_T + _MIN_GAP);
  }

  // Wellbore axis centred at 35% of the plot width
  const cx = PAD_L + (W - PAD_L - PAD_R) * 0.35;

  // OD scale: largest casing OD fills 44% of plot width (full diameter)
  const maxOD   = Math.max(...schRows.map(r => +(r.size || 0)), 13.375, 0.1);
  const odScale = ((W - PAD_L - PAD_R) * 0.44) / maxOD;   // px per inch

  // ── Depth axis ─────────────────────────────────────────────────────────────
  ctx.strokeStyle = '#ccd8e0';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_L, PAD_T);
  ctx.lineTo(PAD_L, H - PAD_B);
  ctx.stroke();

  ctx.fillStyle    = '#5a7a8e';
  ctx.font         = '9px sans-serif';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 5; i++) {
    const tvd = maxDepth * i / 5;
    const y   = PAD_T + tvd * scaleY;
    ctx.beginPath();
    ctx.moveTo(PAD_L - 3, y); ctx.lineTo(PAD_L, y);
    ctx.stroke();
    if (i > 0) ctx.fillText(Math.round(_toD(tvd)) + _uTick, PAD_L - 5, y);
  }

  // ── Casing strings ─────────────────────────────────────────────────────────
  // Sorted largest → smallest so outer casings draw first (behind inner ones)
  const sorted = [...schRows].sort((a, b) => +(b.size || 0) - +(a.size || 0));

  const WALL = {
    'Conductor':           '#3a7aaa',
    'Surface Casing':      '#2a6a9a',
    'Intermediate Casing': '#1a5a8a',
    'Production Casing':   '#0a4a7a',
    'Liner':               '#1a5f7a',
    'Open Hole':           '#b8976a',
    'Tubing':              '#4aaa6a',
  };
  const FILL = {
    'Conductor':           'rgba(58,122,170,0.09)',
    'Surface Casing':      'rgba(42,106,154,0.09)',
    'Intermediate Casing': 'rgba(26,90,138,0.09)',
    'Production Casing':   'rgba(10,74,122,0.09)',
    'Liner':               'rgba(26,95,122,0.09)',
    'Open Hole':           'rgba(184,151,106,0.14)',
    'Tubing':              'rgba(74,170,106,0.14)',
  };

  const labelData = [];

  sorted.forEach(row => {
    const size  = +(row.size || 9.625);
    const top   = +(row.top  || 0);
    const bot   = +(row.bot  || maxDepth);
    const halfW = (size / 2) * odScale;
    // Casings whose top is at/above ground level (top ≤ GL/seabed MD — e.g. run
    // from the wellhead: top 0 at RKB, or top = air-gap depth at GL) start at the
    // GL/seabed line, not at RKB. Only when their shoe is actually below that line
    // (bot > GL) — a casing entirely above it (a conductor above the mudline)
    // draws normally from RKB instead.
    const belowGL = (top <= glCasingMD && y_GL_casing > PAD_T && bot > glCasingMD);
    const yTop  = belowGL ? y_GL_casing : PAD_T + Math.max(0, top) * scaleY;
    let   yBot  = PAD_T + Math.min(maxDepth, bot) * scaleY;
    // On a very deep well the datum lines are spread apart by a min-gap, which can
    // push the GL/seabed line below a shallow below-ground casing's true pixel
    // depth — keep such a casing a thin sliver just below GL rather than inverting.
    if (belowGL && yBot < yTop + 2) yBot = yTop + 2;
    const color = WALL[row.def] || '#2a7fa8';
    const isOH  = row.def === 'Open Hole';

    // Bore fill — casing: ID span; open hole: full OD span
    const idVal  = isOH ? size : (typeof _rowID === 'function' ? _rowID(row) : size * 0.87);
    const halfID = Math.min((idVal / 2) * odScale, halfW - 0.5);
    ctx.fillStyle = FILL[row.def] || 'rgba(100,150,200,0.08)';
    ctx.fillRect(cx - halfID, yTop, halfID * 2, yBot - yTop);

    // Steel wall fill + outer stroke (skip open hole)
    if (!isOH) {
      ctx.fillStyle   = color;
      ctx.globalAlpha = 0.72;
      ctx.fillRect(cx - halfW,  yTop, halfW - halfID, yBot - yTop); // left wall
      ctx.fillRect(cx + halfID, yTop, halfW - halfID, yBot - yTop); // right wall
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(cx - halfW, yTop); ctx.lineTo(cx - halfW, yBot); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + halfW, yTop); ctx.lineTo(cx + halfW, yBot); ctx.stroke();
    }

    // Shoe triangles — never taller than the casing body, so a sliver casing's
    // shoe can't poke up above its own top (e.g. above the GL/mudline line).
    if (!isOH) {
      const sh = Math.min(11, halfW * 0.55, Math.max(2, yBot - yTop));
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx - halfW,      yBot);
      ctx.lineTo(cx - halfW,      yBot - sh);
      ctx.lineTo(cx - halfW - sh, yBot);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + halfW,      yBot);
      ctx.lineTo(cx + halfW,      yBot - sh);
      ctx.lineTo(cx + halfW + sh, yBot);
      ctx.closePath(); ctx.fill();
    }

    // Collect label metadata — draw later after deconfliction
    const sh0    = isOH ? 2 : Math.min(13, halfW * 0.55);
    const lx     = cx + halfW + sh0 + 5;
    const botMD  = +(row.bot || maxDepth);
    const tvdVal = Math.round(_mdToTVD(survey, botMD));
    const grade  = row.grade     || '';
    const wt     = row.nomWt_ppf ? `${row.nomWt_ppf}ppf` : '';
    const line1  = (grade || wt)
      ? `${size}" ${grade}${wt ? ' ' + wt : ''}`.trim()
      : `${size}" ${row.def}`;
    labelData.push({
      lx, yShoe: yBot, color,
      line1, line2: `TVD: ${Math.round(_toD(tvdVal)).toLocaleString()}${_uD}`,
      line3: `MD: ${Math.round(_toD(botMD)).toLocaleString()}${_uD}`,
    });
  });

  // ── Label deconfliction ────────────────────────────────────────────────────
  const LH = 12, BLOCK = LH * 3, GAP = 6;
  const topLimit = PAD_T + 4;
  const botLimit = H - PAD_B - BLOCK - 4;

  // Sort top → bottom by shoe depth
  labelData.sort((a, b) => a.yShoe - b.yShoe);

  // Unconstrained preferred position (just above each shoe)
  labelData.forEach(lb => { lb.ly = lb.yShoe - LH; });

  // Forward pass: push each label below the previous (no clamping)
  for (let i = 1; i < labelData.length; i++) {
    const need = labelData[i - 1].ly + BLOCK + GAP;
    if (labelData[i].ly < need) labelData[i].ly = need;
  }

  // If the last label overflows the canvas bottom, shift the ENTIRE column up
  // uniformly — this preserves spacing and avoids the backward-pass collapsing bug
  if (labelData.length > 0) {
    const overflow = labelData[labelData.length - 1].ly - botLimit;
    if (overflow > 0) labelData.forEach(lb => { lb.ly -= overflow; });
  }

  // Final top clamp (in case the column is taller than available space)
  labelData.forEach(lb => { lb.ly = Math.max(topLimit, lb.ly); });

  // ── RKB / GL / MSL datum lines — drawn before labels so labels render on top ─
  _drawDatumLines(ctx, W, H, cx, PAD_T, PAD_B, scaleY, maxDepth);

  // Draw labels with drag offset applied (after datum lines so nothing overwrites them)
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  labelData.forEach(lb => {
    const key = lb.line1;
    const off = _schDrag.offsets.get(key) || { dx: 0, dy: 0 };
    const dlx = lb.lx + off.dx;
    const dly = lb.ly + off.dy;

    // Leader line when label is far from its shoe (auto deconfliction or manual drag)
    const autoFar = Math.abs(lb.ly - (lb.yShoe - LH)) > BLOCK + GAP;
    const dragged  = off.dx !== 0 || off.dy !== 0;
    if (autoFar || dragged) {
      ctx.strokeStyle = lb.color; ctx.lineWidth = 0.5; ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.moveTo(lb.lx, lb.yShoe); ctx.lineTo(dlx, dly + BLOCK); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = lb.color;
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText(lb.line1, dlx, dly);
    ctx.font = '9px sans-serif';
    ctx.fillText(lb.line2, dlx, dly + LH);
    ctx.fillText(lb.line3, dlx, dly + LH * 2);

    // Record hit area for drag detection
    _schDrag.areas.push({ key, x: dlx - 2, y: dly - 2, w: 130, h: BLOCK + 4 });
  });

  // ── TD marker ─────────────────────────────────────────────────────────────
  const tdY = Math.min(PAD_T + lastSurvey.md * scaleY, H - PAD_B - 4);
  ctx.fillStyle = '#c0392b';
  ctx.beginPath(); ctx.arc(cx, tdY, 4, 0, Math.PI * 2); ctx.fill();
  ctx.font         = 'bold 9px sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('TD', cx + 7, tdY);

  // ── Summary labels ─────────────────────────────────────────────────────────
  ctx.fillStyle    = '#5a7a8e';
  ctx.font         = '9px sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`MD: ${Math.round(_toD(lastSurvey.md)).toLocaleString()} ${_uD}`, 4, 4);
  ctx.fillText(`TVD: ${Math.round(_toD(lastSurvey.tvd)).toLocaleString()} ${_uD}`, 4, 15);
}

function _drawDatumLines(ctx, W, H, cx, PAD_T, PAD_B, scaleY, maxDepth) {
  const datums = qpState.wellDatums;

  // Datum distances (rkb/gl/water depth) are imperial ft → display for labels
  const _bd = ft => Math.round(QP_UNITS.toDisplay('depth', ft)) + (QP_UNITS.isMetric() ? 'm' : "'");

  const X0   = 2;
  const X1   = cx - 4;
  const LBL  = X0 + 1;
  const BRKT = X0 + 14;

  const yRKB    = PAD_T;
  const MIN_GAP = 24;
  const yBot    = H - PAD_B;

  const rkb = datums?.rkb || 0;
  const env = datums?.environment || 'onshore';

  // ── Pre-compute offshore MSL / SB so water fill and rig legs can use them ─
  let yMSL_off = null, ySB_off = null;
  if (datums && env === 'offshore') {
    const yMSL_sc = PAD_T + Math.min(rkb, maxDepth) * scaleY;
    yMSL_off = Math.max(yMSL_sc, yRKB + MIN_GAP);
    const seaBed = datums.seaBedDepth || 0;
    if (seaBed > 0) {
      const ySB_sc = PAD_T + Math.min(rkb + seaBed, maxDepth) * scaleY;
      ySB_off = Math.max(ySB_sc, yMSL_off + MIN_GAP);
    }
  }

  // ── Water column fill (offshore only, drawn before rig icon & casings) ─────
  if (yMSL_off !== null && ySB_off !== null && yMSL_off < yBot) {
    const waterBot = Math.min(ySB_off, yBot);
    ctx.fillStyle = 'rgba(0, 100, 210, 0.11)';
    ctx.fillRect(0, yMSL_off, W, waterBot - yMSL_off);
    // Wave marks at MSL surface
    ctx.strokeStyle = 'rgba(0, 100, 210, 0.40)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    for (let wx = 0; wx < W; wx += 10) {
      ctx.beginPath();
      ctx.moveTo(wx, yMSL_off);
      ctx.quadraticCurveTo(wx + 5, yMSL_off - 3, wx + 10, yMSL_off);
      ctx.stroke();
    }
  }

  // ── Rig icon — legs reach MSL for offshore, GL for onshore ────────────────
  let yLegBottom = yRKB;
  if (yMSL_off !== null) {
    yLegBottom = yMSL_off;                          // offshore: legs to waterline
  } else if (datums && env !== 'offshore' && rkb > 0) {
    const yGL_sc = PAD_T + Math.min(rkb, maxDepth) * scaleY;
    yLegBottom = Math.max(yGL_sc, yRKB + MIN_GAP); // onshore: legs to ground level
  }
  _drawRigIcon(ctx, cx, yRKB, yLegBottom);

  // ── Always draw RKB marker ────────────────────────────────────────────────
  ctx.strokeStyle = '#1a5f7a'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(X0, yRKB); ctx.lineTo(X1, yRKB); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#1a5f7a'; ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('RKB', LBL, yRKB - 1);

  if (!datums) return;

  const gl     = datums.gl  || 0;
  const seaBed = datums.seaBedDepth || 0;

  if (env === 'offshore') {
    const yMSL = yMSL_off;
    const ySB  = ySB_off;

    if (yMSL !== null && yMSL < yBot) {
      ctx.strokeStyle = '#0055aa'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(X0, yMSL); ctx.lineTo(X1, yMSL); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#0055aa'; ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('MSL', LBL, yMSL - 1);
      _drawBracket(ctx, BRKT, yRKB, yMSL, _bd(rkb), '#1a5f7a');
    }
    if (ySB !== null && ySB < yBot && seaBed > 0) {
      ctx.strokeStyle = '#b8976a'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(X0, ySB); ctx.lineTo(X1, ySB); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#b8976a'; ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('SB', LBL, ySB - 1);
      if (yMSL !== null && yMSL < yBot) _drawBracket(ctx, BRKT, yMSL, ySB, _bd(seaBed), '#0055aa');
    }
  } else {
    // Onshore: RKB → GL → MSL
    const yGL_sc  = PAD_T + Math.min(rkb,      maxDepth) * scaleY;
    const yMSL_sc = PAD_T + Math.min(rkb + gl, maxDepth) * scaleY;
    const yGL  = Math.max(yGL_sc,  yRKB + MIN_GAP);
    const yMSL = Math.max(yMSL_sc, yGL  + MIN_GAP);

    if (yGL < yBot) {
      // Ground fill below GL — makes the GL line read as the ground surface
      // (the region above GL, between the rig floor/RKB and the ground, is the
      // air gap the rig substructure spans).
      ctx.fillStyle = 'rgba(150, 120, 70, 0.13)';
      ctx.fillRect(0, yGL, W, Math.min(yBot, H) - yGL);
      // Ground-surface line (solid, earth tone) + hatch ticks
      ctx.strokeStyle = '#8a7040'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(0, yGL); ctx.lineTo(W, yGL); ctx.stroke();
      ctx.lineWidth = 1;
      for (let gx = 4; gx < W; gx += 9) {
        ctx.beginPath(); ctx.moveTo(gx, yGL); ctx.lineTo(gx - 4, yGL + 4); ctx.stroke();
      }
      ctx.fillStyle = '#6f5a30'; ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('GL', LBL, yGL - 1);
      _drawBracket(ctx, BRKT, yRKB, yGL, _bd(rkb), '#1a5f7a');
    }
    if (yMSL < yBot && gl > 0) {
      ctx.strokeStyle = '#0055aa'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(X0, yMSL); ctx.lineTo(X1, yMSL); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#0055aa'; ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText('MSL', LBL, yMSL - 1);
      if (yGL < yBot) _drawBracket(ctx, BRKT, yGL, yMSL, _bd(gl), '#2a7a2a');
    }
  }
}

function _drawRigIcon(ctx, cx, yFloor, yGround) {
  const iH = 42;   // derrick height above rig floor
  const iW = 13;   // half-width at base
  const yApex = yFloor - iH;
  const col = '#1a5f7a';

  ctx.strokeStyle = col; ctx.setLineDash([]);

  // Left and right derrick legs
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - iW, yFloor); ctx.lineTo(cx, yApex); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + iW, yFloor); ctx.lineTo(cx, yApex); ctx.stroke();

  // Cross braces (two levels)
  ctx.lineWidth = 1;
  [0.38, 0.65].forEach(t => {
    const y  = yApex + t * iH;
    const hw = iW * (1 - (1 - t)); // narrows toward apex
    ctx.beginPath(); ctx.moveTo(cx - hw, y); ctx.lineTo(cx + hw, y); ctx.stroke();
  });

  // Crown block (small filled rect at apex)
  ctx.fillStyle = col;
  ctx.fillRect(cx - 3, yApex - 4, 6, 4);

  // Rig floor bar
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(cx - iW - 3, yFloor); ctx.lineTo(cx + iW + 3, yFloor); ctx.stroke();

  // Rotary table hole (circle centred on wellbore)
  ctx.lineWidth = 1;
  ctx.strokeStyle = col;
  ctx.beginPath(); ctx.arc(cx, yFloor, 3.5, 0, Math.PI * 2); ctx.stroke();

  // Sub-structure legs below rig floor — extend to GL (yGround) when provided
  ctx.lineWidth = 1;
  const legBottom = (yGround !== undefined && yGround > yFloor + 4) ? yGround : yFloor + 8;
  [cx - iW, cx + iW].forEach(lx => {
    ctx.beginPath(); ctx.moveTo(lx, yFloor); ctx.lineTo(lx, legBottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx - 3, legBottom); ctx.lineTo(lx + 3, legBottom); ctx.stroke();
  });
}

function _drawBracket(ctx, x, y1, y2, label, color) {
  const MID = (y1 + y2) / 2;
  const TS  = 4;   // tick half-size

  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([]);
  // Vertical line
  ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
  // Top tick
  ctx.beginPath(); ctx.moveTo(x - TS, y1); ctx.lineTo(x + TS, y1); ctx.stroke();
  // Bottom tick
  ctx.beginPath(); ctx.moveTo(x - TS, y2); ctx.lineTo(x + TS, y2); ctx.stroke();

  // Distance label — draw to the right of the bracket
  ctx.fillStyle = color; ctx.font = '8px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + TS + 3, MID);
}

function _readSchematicRows() {
  const rows  = [];
  const tbody = document.getElementById('schematicBody');
  if (!tbody) return rows;
  for (const tr of tbody.rows) {
    const sel    = tr.querySelector('select');
    const inputs = tr.querySelectorAll('input[type=number]');
    const spec   = tr.dataset.casingSpec ? (() => { try { return JSON.parse(tr.dataset.casingSpec); } catch (_) { return null; } })() : null;
    const wtSel  = tr.querySelector('.sch-wt');
    const grSel  = tr.querySelector('.sch-grade');
    const wtTxt  = tr.querySelector('.sch-wt-txt');
    const grTxt  = tr.querySelector('.sch-grade-txt');
    const isWtCustom = wtSel?.value === 'custom';
    const isGrCustom = grSel?.value === 'custom';
    rows.push({
      def:  sel?.value        || 'Open Hole',
      size: inputs[0]?.value  || 9.625,   // OD stays in inches (API sizes)
      // MD top/bot fields are display units → imperial (canonical) for all consumers
      top:  QP_UNITS.fromDisplay('depth', +(inputs[1]?.value || 0)),
      bot:  QP_UNITS.fromDisplay('depth', +(inputs[2]?.value || 5000)),
      ...(spec ? {
        nomWt_ppf:  spec.nomWt_ppf,
        grade:      spec.grade,
        id_in:      spec.id_in,
        collapse:   spec.collapse,
        burst:      spec.burst,
        jointYield: spec.jointYield,
      } : {
        grade:     isGrCustom ? (grTxt?.value || '') : '',
        nomWt_ppf: isWtCustom ? (wtTxt?.value ? +wtTxt.value : null)
                               : (wtSel?.value ? +wtSel.value : null),
      }),
    });
  }
  return rows;
}

// Auto-resize schematic canvas when window resizes
window.addEventListener('resize', () => {
  if (qpState.survey && qpState.survey.length > 1) drawSchematic(qpState.survey);
});
