// ===== FINAL DIAGRAM =====
// Well completion diagram following actual wellpath geometry (TVD vs departure).

// ── Draggable label state (mirrors the well-schematic pattern) ────────────────
const _fdDrag = { offsets: new Map(), areas: [], active: null, _sid: null };

function _fdStorageKey() { return `qp_fd_offsets_${qpState.currentScenarioId || 'none'}`; }

function _fdSave() {
  const obj = {};
  _fdDrag.offsets.forEach((v, k) => { obj[k] = v; });
  try { localStorage.setItem(_fdStorageKey(), JSON.stringify(obj)); } catch (_) {}
}

function _fdLoad() {
  const sid = qpState.currentScenarioId || 'none';
  if (_fdDrag._sid === sid) return;
  _fdDrag._sid = sid;
  _fdDrag.offsets.clear();
  try {
    const raw = localStorage.getItem(_fdStorageKey());
    if (raw) Object.entries(JSON.parse(raw)).forEach(([k, v]) => _fdDrag.offsets.set(k, v));
  } catch (_) {}
}

function _fdInitDrag(canvas) {
  if (canvas._fdDragReady) return;
  canvas._fdDragReady = true;

  // Prefer the top-most (last-drawn) label when hit-areas overlap — matches what
  // the user sees on top of the pile-up.
  const hit = (mx, my) => {
    for (let i = _fdDrag.areas.length - 1; i >= 0; i--) {
      const a = _fdDrag.areas[i];
      if (mx >= a.x && mx <= a.x + a.w && my >= a.y && my <= a.y + a.h) return a;
    }
    return null;
  };

  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;                       // left-drag only (right-click = CI)
    const r = canvas.getBoundingClientRect();
    const a = hit(e.clientX - r.left, e.clientY - r.top);
    if (!a) return;
    const off = _fdDrag.offsets.get(a.key) || { dx: 0, dy: 0 };
    _fdDrag.active = { key: a.key, startX: e.clientX - r.left, startY: e.clientY - r.top, origDX: off.dx, origDY: off.dy };
    e.preventDefault();
  });

  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (!_fdDrag.active) { if (hit(mx, my)) canvas.style.cursor = 'grab'; else if (canvas.style.cursor === 'grab') canvas.style.cursor = ''; return; }
    canvas.style.cursor = 'grabbing';
    const { key, startX, startY, origDX, origDY } = _fdDrag.active;
    _fdDrag.offsets.set(key, { dx: origDX + mx - startX, dy: origDY + my - startY });
    drawFinalDiagram();
  });

  canvas.addEventListener('mouseup', () => {
    if (_fdDrag.active) _fdSave();
    _fdDrag.active = null;
    canvas.style.cursor = '';
  });
  canvas.addEventListener('mouseleave', () => { _fdDrag.active = null; });

  // Double-click a label to reset it to the auto position.
  canvas.addEventListener('dblclick', e => {
    const r = canvas.getBoundingClientRect();
    const a = hit(e.clientX - r.left, e.clientY - r.top);
    if (!a) return;
    _fdDrag.offsets.delete(a.key);
    _fdSave();
    drawFinalDiagram();
  });
}

// Draw a callout label block anchored at (ax,ay), with its text block at
// (baseX,baseY) + the saved drag offset, a leader line following it, and a
// registered hit-area for dragging. textLines: [{text, font, color, dy}].
function _fdDrawLabel(ctx, key, ax, ay, baseX, baseY, leaderColor, textLines) {
  const off = _fdDrag.offsets.get(key) || { dx: 0, dy: 0 };
  const lx = baseX + off.dx, ly = baseY + off.dy;

  ctx.strokeStyle = leaderColor; ctx.lineWidth = 0.8; ctx.setLineDash([3, 2]);
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(lx - 4, ly); ctx.stroke();
  ctx.setLineDash([]);

  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  let maxW = 0, minDy = Infinity, maxDy = -Infinity;
  textLines.forEach(t => {
    ctx.font = t.font; ctx.fillStyle = t.color;
    ctx.fillText(t.text, lx, ly + t.dy);
    maxW = Math.max(maxW, ctx.measureText(t.text).width);
    if (t.dy < minDy) minDy = t.dy;
    if (t.dy > maxDy) maxDy = t.dy;
  });
  _fdDrag.areas.push({ x: lx - 3, y: ly + minDy - 7, w: maxW + 8, h: (maxDy - minDy) + 14, key });
}

const _FD_COLORS = {
  'BPV':          '#2a5fa8',
  'Packer':       '#1a7a4a',
  'Whipstock':    '#8b1a1a',
  'Cement':       '#777777',
  'Tubing':       '#3a7fa8',
  'Fish':         '#8b5a2b',
  'Bridge Plug':  '#444444',
  'Liner':        '#2a6f98',
  'Perforation':  '#c0392b',
  'Screen':       '#5a6b2b',
  'Valve':        '#6b2b8b',
  'Plug':         '#444444',
};

function _fdColor(element) {
  for (const [key, val] of Object.entries(_FD_COLORS)) {
    if (element.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return '#888888';
}

function _fdGetID(row) {
  if (row.def === 'Open Hole') return parseFloat(row.size || 8.5);
  if (row.id_in != null && +row.id_in > 0) return +row.id_in;
  const od = parseFloat(row.size || 9.625);
  if (row.nomWt_ppf != null && +row.nomWt_ppf > 0) {
    const disc = od * od - 4 * (+row.nomWt_ppf) / 10.69;
    if (disc > 0) return Math.sqrt(disc);
  }
  return od * 0.87;
}

// ── Path-following tube helpers ───────────────────────────────────────────────

function _fdTubeWalls(pathPts, hw) {
  const left = [], right = [];
  for (let i = 0; i < pathPts.length; i++) {
    const cur = pathPts[i];
    const nxt = i < pathPts.length - 1 ? pathPts[i + 1] : pathPts[i];
    const prv = i > 0 ? pathPts[i - 1] : pathPts[i];
    const tx = nxt.x - prv.x, ty = nxt.y - prv.y;
    const len = Math.sqrt(tx * tx + ty * ty) || 1;
    const px = -ty / len, py = tx / len; // perpendicular (left-hand side)
    left.push({ x: cur.x + px * hw, y: cur.y + py * hw });
    right.push({ x: cur.x - px * hw, y: cur.y - py * hw });
  }
  return { left, right };
}

function _fdFillBand(ctx, a, b, fillStyle) {
  ctx.fillStyle = fillStyle;
  ctx.beginPath();
  a.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  for (let i = b.length - 1; i >= 0; i--) ctx.lineTo(b[i].x, b[i].y);
  ctx.closePath(); ctx.fill();
}

function _fdStrokeLine(ctx, pts, color, lw, dash) {
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.setLineDash(dash || []);
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();
  ctx.setLineDash([]);
}

// Sample the survey at evenly-spaced MD intervals for a section
function _fdSamplePath(survey, topMD, botMD, toX, toY) {
  const n = Math.max(20, Math.ceil((botMD - topMD) / 40));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const md = topMD + (botMD - topMD) * i / n;
    const st = _interpSurvey(survey, md);
    const dep = Math.sqrt(st.north * st.north + st.east * st.east);
    pts.push({ x: toX(dep), y: toY(st.tvd), md });
  }
  return pts;
}

// ── Main draw ─────────────────────────────────────────────────────────────────

function drawFinalDiagram() {
  const c = _chartSetup('finalDiagramCanvas');
  if (!c) return;
  const { ctx, W, H } = c;

  _fdLoad();
  _fdInitDrag(c.ctx.canvas);
  _fdDrag.areas = [];        // rebuilt each draw as labels are placed

  const survey  = qpState.survey;
  const hoRows  = handoverGet().filter(r => r.element && r.element.trim());
  const schRows = _readSchematicRows()
    .filter(r => +(r.bot || 0) > 0)
    .sort((a, b) => +(a.bot) - +(b.bot));

  if (!survey || survey.length < 2 || !schRows.length) {
    _noData(ctx, W, H, 'Add trajectory + well schematic first');
    return;
  }

  const C = _qpColors();
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

  // ── Coordinate bounds ────────────────────────────────────────────────────────
  const dense = _densify(survey, 30);
  const xMax  = Math.max(...dense.map(s => Math.sqrt(s.north*s.north + s.east*s.east)), 10) * 1.18;
  const yMax  = Math.max(...dense.map(s => s.tvd), 100) * 1.08;

  const lPad = 58, rPad = 170, tPad = 44, bPad = 28;
  const pw = W - lPad - rPad, ph = H - tPad - bPad;
  // xOff shifts the surface point 10% into the plot so wide conductor ODs don't clip left
  const xOff = xMax * 0.10;
  const toX = dep => lPad + ((dep + xOff) / (xMax + xOff)) * pw;
  const toY = tvd => tPad + (tvd / yMax) * ph;

  // ── Scale: inches → perpendicular half-pixels ───────────────────────────────
  const maxOD     = Math.max(...schRows.map(r => parseFloat(r.size) || 8.5), 0.1);
  const pixPerIn  = Math.min(pw * 0.20 / maxOD, 14);
  const inToPx    = in_ => parseFloat(in_ || 0) * pixPerIn;

  const SCH_WALL = {
    'Conductor':           '#3a7aaa',
    'Surface Casing':      '#2a6a9a',
    'Intermediate Casing': '#1a5a8a',
    'Production Casing':   '#0a4a7a',
    'Liner':               '#1a5f7a',
    'Open Hole':           '#b8976a',
  };

  // ── Casing tubes, largest → smallest (outer draws behind inner) ──────────────
  const sortedSch = [...schRows].sort((a, b) => parseFloat(b.size||0) - parseFloat(a.size||0));

  sortedSch.forEach(row => {
    const topMD = +(row.top || 0);
    const botMD = +(row.bot);
    const odHW  = inToPx(row.size) / 2;
    const idHW  = inToPx(_fdGetID(row)) / 2;
    const wCol  = SCH_WALL[row.def] || '#4a7fa8';
    const isOH  = row.def === 'Open Hole';
    const pts   = _fdSamplePath(survey, topMD, botMD, toX, toY);

    // Bore fluid fill
    const { left: idL, right: idR } = _fdTubeWalls(pts, Math.max(idHW, 1));
    _fdFillBand(ctx, idL, idR, 'rgba(180,220,255,0.10)');

    if (isOH) {
      const { left: odL, right: odR } = _fdTubeWalls(pts, odHW);
      _fdStrokeLine(ctx, odL, wCol, 1.5, [5, 3]);
      _fdStrokeLine(ctx, odR, wCol, 1.5, [5, 3]);
    } else {
      const { left: odL, right: odR } = _fdTubeWalls(pts, odHW);
      // Annular steel fill (left and right bands)
      _fdFillBand(ctx, odL, idL, wCol + 'bb');
      _fdFillBand(ctx, idR, odR, wCol + 'bb');
      // Outer wall lines
      _fdStrokeLine(ctx, odL, wCol, 1.5);
      _fdStrokeLine(ctx, odR, wCol, 1.5);
      // Inner bore lines (faint)
      _fdStrokeLine(ctx, idL, wCol + '88', 0.75);
      _fdStrokeLine(ctx, idR, wCol + '88', 0.75);
    }

    // Shoe triangle at bottom
    if (!isOH) {
      const p = pts[pts.length - 1];
      const p2 = pts[pts.length - 2] || pts[0];
      const tx = p.x - p2.x, ty = p.y - p2.y;
      const len = Math.sqrt(tx*tx + ty*ty) || 1;
      const px = -ty/len * odHW, py = tx/len * odHW;
      const sh = Math.min(10, odHW * 0.8);
      const tx2 = tx/len * sh, ty2 = ty/len * sh;
      ctx.fillStyle = wCol;
      ctx.beginPath();
      ctx.moveTo(p.x + px, p.y + py);
      ctx.lineTo(p.x + px - tx2, p.y + py - ty2);
      ctx.lineTo(p.x + tx2, p.y + ty2);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(p.x - px, p.y - py);
      ctx.lineTo(p.x - px - tx2, p.y - py - ty2);
      ctx.lineTo(p.x + tx2, p.y + ty2);
      ctx.closePath(); ctx.fill();
    }
  });

  // ── Wellpath centre line (faint guide) ───────────────────────────────────────
  ctx.strokeStyle = C.dim + '44'; ctx.lineWidth = 0.5; ctx.setLineDash([]);
  ctx.beginPath();
  dense.forEach((s, i) => {
    const dep = Math.sqrt(s.north*s.north + s.east*s.east);
    const x = toX(dep), y = toY(s.tvd);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // ── Handover elements along path ─────────────────────────────────────────────
  hoRows.forEach(row => {
    const midMD = row.topMD != null ? row.topMD : row.botMD;
    if (midMD == null) return;
    const st  = _interpSurvey(survey, midMD);
    const dep = Math.sqrt(st.north*st.north + st.east*st.east);
    const x   = toX(dep), y = toY(st.tvd);

    // Inner bore half-width at this depth
    let idHW = inToPx(8.5) / 2;
    for (const sr of schRows) {
      if (midMD <= +(sr.bot)) { idHW = inToPx(_fdGetID(sr)) / 2; break; }
    }

    const col = _fdColor(row.element);
    const hw  = Math.max(idHW * 0.85, 4);

    // Draw a simple cross-bar marker at the element depth
    ctx.fillStyle = col;
    ctx.fillRect(x - hw, y - 4, hw * 2, 8);
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.strokeRect(x - hw, y - 4, hw * 2, 8);

    // Draggable label to the right
    const label = row.element + (row.size ? ' ' + row.size : '');
    _fdDrawLabel(ctx, `ho:${row.element}:${Math.round(midMD)}`, x + hw, y, x + hw + 6, y, col, [
      { text: label, font: 'bold 8px sans-serif', color: col, dy: 0 },
    ]);
  });

  // ── Casing labels (leader lines to shoe) ─────────────────────────────────────
  schRows.forEach(row => {
    const botMD = +(row.bot);
    const st    = _interpSurvey(survey, botMD);
    const dep   = Math.sqrt(st.north*st.north + st.east*st.east);
    const x     = toX(dep), y = toY(st.tvd);
    const odHW  = inToPx(row.size) / 2;
    const wCol  = SCH_WALL[row.def] || '#4a7fa8';

    const od   = parseFloat(row.size || 0);
    const id   = _fdGetID(row);
    const fmt  = v => {
      const fr = v % 1, int = Math.floor(v);
      if (fr === 0) return `${int}"`;
      const map = {0.125:'⅛',0.25:'¼',0.375:'⅜',0.5:'½',0.625:'⅝',0.75:'¾',0.875:'⅞'};
      return `${int}${map[fr] ? map[fr] : (' '+fr.toFixed(2).replace(/^0\./,'.'))}\"`;
    };
    const line1 = `${fmt(od)} OD / ${fmt(+id.toFixed(3))} ID`;
    const line2 = `${row.def}`;
    const line3 = `MD: ${Math.round(botMD).toLocaleString()}ft`;

    // Draggable callout label (leader follows it) — anchored at the shoe.
    _fdDrawLabel(ctx, `cas:${row.def}:${Math.round(botMD)}`, x + odHW, y, x + odHW + 12, y, wCol, [
      { text: line1, font: 'bold 8.5px sans-serif', color: wCol,  dy: -7 },
      { text: line2, font: '8px sans-serif',        color: C.dim, dy: 1  },
      { text: line3, font: '8px sans-serif',        color: C.dim, dy: 9  },
    ]);
  });

  // ── Depth axis (TVD) ─────────────────────────────────────────────────────────
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(lPad, tPad); ctx.lineTo(lPad, tPad + ph); ctx.stroke();

  ctx.fillStyle = C.dim; ctx.font = '10px sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 1; i <= 5; i++) {
    const tvd = yMax * i / 5;
    const y   = toY(tvd);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(lPad - 3, y); ctx.lineTo(lPad, y); ctx.stroke();
    ctx.fillText(Math.round(tvd).toLocaleString() + "'", lPad - 5, y);
  }

  // TVD label (rotated)
  ctx.save();
  ctx.fillStyle = C.dim; ctx.font = '10px sans-serif';
  ctx.translate(12, tPad + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('TVD (ft)', 0, 0);
  ctx.restore();

  // ── TD + surface markers ────────────────────────────────────────────────────
  const last    = survey[survey.length - 1];
  const lastDep = Math.sqrt(last.north*last.north + last.east*last.east);
  const tdX = toX(lastDep), tdY = toY(last.tvd);
  ctx.fillStyle = '#c0392b';
  ctx.beginPath(); ctx.arc(tdX, tdY, 5, 0, Math.PI * 2); ctx.fill();
  ctx.font = 'bold 9px sans-serif'; ctx.fillStyle = C.text;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(`TD  ${Math.round(last.tvd).toLocaleString()}' TVD`, tdX + 7, tdY - 6);
  ctx.fillText(`${Math.round(last.md).toLocaleString()}' MD`, tdX + 7, tdY + 5);

  ctx.fillStyle = '#2a7fa8';
  ctx.beginPath(); ctx.arc(toX(0), toY(0), 5, 0, Math.PI * 2); ctx.fill();

  // ── Title ───────────────────────────────────────────────────────────────────
  ctx.fillStyle = C.text; ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('Final Well Diagram', lPad + pw / 2, 10);

  ctx.fillStyle = C.dim; ctx.font = '8px sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.fillText('drag labels · double-click to reset', W - 8, 12);

  // ── CI registration ─────────────────────────────────────────────────────────
  CI.register('finalDiagramCanvas', {
    pad: { l: lPad, t: tPad, pw, ph },
    xMax, yMax,
    xLabel: 'Departure (ft)', yLabel: 'TVD (ft)',
    depthDown: true,
  });
  CI.drawAnnotations(ctx, 'finalDiagramCanvas');
}
