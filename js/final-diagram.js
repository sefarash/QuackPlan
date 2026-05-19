// ===== FINAL DIAGRAM =====
// Wellbore completion diagram — wellbore walls from Well Schematic (OD + ID),
// elements from Handover table sized to fit inside the inner bore at each depth.

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

// Inner diameter: use catalogue id_in when available, compute from weight, else ratio fallback.
// Open Hole has no steel wall — ID = OD.
function _fdGetID(row) {
  if (row.def === 'Open Hole') return parseFloat(row.size || 8.5);
  if (row.id_in != null && +row.id_in > 0) return +row.id_in;
  const od = parseFloat(row.size || 9.625);
  if (row.nomWt_ppf != null && +row.nomWt_ppf > 0) {
    // API formula: w = 10.69*(OD-t)*t  →  ID = sqrt(OD²− 4w/10.69)
    const disc = od * od - 4 * (+row.nomWt_ppf) / 10.69;
    if (disc > 0) return Math.sqrt(disc);
  }
  return od * 0.87; // typical API casing wall ratio fallback
}

// ── Element draw functions ─────────────────────────────────────────────────
// `hw` = inner-bore half-width in pixels.  Elements must stay within ±hw.

function _fdBPV(ctx, cx, y, hw, col) {
  // Upside-down funnel spanning full bore
  const tw = hw * 0.96, bw = Math.max(hw * 0.15, 3), h = Math.max(hw * 0.55, 14);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(cx - tw, y - h); ctx.lineTo(cx + tw, y - h);
  ctx.lineTo(cx + bw, y);     ctx.lineTo(cx - bw, y);
  ctx.closePath(); ctx.fill();
  ctx.fillRect(cx - bw, y, bw * 2, Math.max(hw * 0.18, 5));
  ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
}

function _fdPacker(ctx, cx, y1, y2, hw, col) {
  // Chevron-waisted shape spanning full bore
  const pw = hw * 0.97, mid = (y1 + y2) / 2;
  ctx.fillStyle = col + 'cc';
  ctx.beginPath();
  ctx.moveTo(cx - pw, y1); ctx.lineTo(cx + pw, y1);
  ctx.lineTo(cx + pw * 0.45, mid);
  ctx.lineTo(cx + pw, y2); ctx.lineTo(cx - pw, y2);
  ctx.lineTo(cx - pw * 0.45, mid);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
}

function _fdCement(ctx, cx, y1, y2, hw, col) {
  // Fills the full bore with cross-hatch
  const pw = hw;
  ctx.fillStyle = col + 'b0';
  ctx.fillRect(cx - pw, y1, pw * 2, y2 - y1);
  ctx.save();
  ctx.beginPath(); ctx.rect(cx - pw, y1, pw * 2, y2 - y1); ctx.clip();
  ctx.strokeStyle = col + '66'; ctx.lineWidth = 1;
  const step = 10;
  const span = y2 - y1;
  for (let x = cx - pw - span; x < cx + pw + span; x += step) {
    ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x + span, y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + span, y1); ctx.lineTo(x, y2); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = col; ctx.lineWidth = 1;
  ctx.strokeRect(cx - pw, y1, pw * 2, y2 - y1);
}

function _fdWhipstock(ctx, cx, y, hw, col) {
  // Wedge spanning full bore, angled right-down
  const w = hw * 0.96, h = Math.max(hw * 0.9, 28);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(cx - w, y); ctx.lineTo(cx + w * 0.2, y);
  ctx.lineTo(cx - w * 0.1, y + h);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke();
}

function _fdFish(ctx, cx, y1, y2, hw, col) {
  // Rounded capsule — narrower than bore
  const pw = Math.max(hw * 0.5, 6);
  const h  = Math.max(y2 - y1, pw * 2);
  ctx.fillStyle = col + 'cc';
  ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - pw, y1 + pw);
  ctx.arc(cx, y1 + pw, pw, Math.PI, 0);
  ctx.lineTo(cx + pw, y1 + h - pw);
  ctx.arc(cx, y1 + h - pw, pw, 0, Math.PI);
  ctx.closePath(); ctx.fill(); ctx.stroke();
}

function _fdTubing(ctx, cx, y1, y2, hw, col) {
  // Tube walls — outer extent = hw, wall proportional to bore size
  const pw = hw * 0.98;
  const wt = Math.max(Math.round(hw * 0.18), 3);
  ctx.fillStyle = col + '22'; ctx.fillRect(cx - pw, y1, pw * 2, y2 - y1);
  ctx.fillStyle = col;
  ctx.fillRect(cx - pw,      y1, wt, y2 - y1);  // left wall
  ctx.fillRect(cx + pw - wt, y1, wt, y2 - y1);  // right wall
  ctx.strokeStyle = col; ctx.lineWidth = 1;
  ctx.strokeRect(cx - pw, y1, pw * 2, y2 - y1);
}

function _fdPlug(ctx, cx, y, hw, col) {
  // Downward-pointing trapezoid filling the bore
  const tw = hw * 0.97, bw = Math.max(hw * 0.15, 3), h = Math.max(hw * 0.5, 14);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(cx - tw, y - h / 2); ctx.lineTo(cx + tw, y - h / 2);
  ctx.lineTo(cx + bw, y + h / 2); ctx.lineTo(cx - bw, y + h / 2);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
}

function _fdScreen(ctx, cx, y1, y2, hw, col) {
  // Fills bore with grid hatch
  const pw = hw * 0.97;
  ctx.strokeStyle = col; ctx.lineWidth = 1.2;
  ctx.strokeRect(cx - pw, y1, pw * 2, y2 - y1);
  ctx.save();
  ctx.beginPath(); ctx.rect(cx - pw, y1, pw * 2, y2 - y1); ctx.clip();
  ctx.lineWidth = 0.8;
  const s = Math.max(5, hw * 0.12);
  for (let yy = y1; yy < y2; yy += s) {
    ctx.beginPath(); ctx.moveTo(cx - pw, yy); ctx.lineTo(cx + pw, yy); ctx.stroke();
  }
  for (let xx = cx - pw; xx < cx + pw; xx += s) {
    ctx.beginPath(); ctx.moveTo(xx, y1); ctx.lineTo(xx, y2); ctx.stroke();
  }
  ctx.restore();
}

function _fdPerf(ctx, cx, y, hw, col) {
  // Bullets from bore wall outward — marks at inner wall face
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.fillStyle = col;
  for (const side of [-1, 1]) {
    const x0 = cx + side * hw * 0.65;
    const x1 = cx + side * hw * 0.98;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.beginPath(); ctx.arc(x1, y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
}

function _fdValve(ctx, cx, y, hw, col) {
  const w = hw * 0.78, h = Math.max(hw * 0.45, 12);
  ctx.fillStyle = col + 'cc'; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, y - h); ctx.lineTo(cx + w, y);
  ctx.lineTo(cx, y + h); ctx.lineTo(cx - w, y);
  ctx.closePath(); ctx.fill(); ctx.stroke();
}

function _fdGeneric(ctx, cx, y1, y2, hw, col) {
  const pw = hw * 0.95, h = Math.max(y2 - y1, 14);
  ctx.fillStyle = col + 'aa'; ctx.fillRect(cx - pw, y1, pw * 2, h);
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.strokeRect(cx - pw, y1, pw * 2, h);
}

function _fdDrawElement(ctx, cx, y1, y2, hw, element) {
  const col  = _fdColor(element);
  const name = element.toLowerCase();
  if      (name.includes('bpv'))                           _fdBPV(ctx, cx, y1, hw, col);
  else if (name.includes('packer'))                        _fdPacker(ctx, cx, y1, y2, hw, col);
  else if (name.includes('cement'))                        _fdCement(ctx, cx, y1, y2, hw, col);
  else if (name.includes('whip'))                          _fdWhipstock(ctx, cx, y1, hw, col);
  else if (name.includes('fish'))                          _fdFish(ctx, cx, y1, y2, hw, col);
  else if (name.includes('tubing'))                        _fdTubing(ctx, cx, y1, y2, hw, col);
  else if (name.includes('liner'))                         _fdTubing(ctx, cx, y1, y2, hw, col);
  else if (name.includes('bridge') || name === 'plug')     _fdPlug(ctx, cx, y1, hw, col);
  else if (name.includes('screen'))                        _fdScreen(ctx, cx, y1, y2, hw, col);
  else if (name.includes('perf'))                          _fdPerf(ctx, cx, y1, hw, col);
  else if (name.includes('valve'))                         _fdValve(ctx, cx, y1, hw, col);
  else if (name.includes('plug'))                          _fdPlug(ctx, cx, y1, hw, col);
  else                                                     _fdGeneric(ctx, cx, y1, y2, hw, col);
}

// ── Main draw ───────────────────────────────────────────────────────────────

function drawFinalDiagram() {
  const c = _chartSetup('finalDiagramCanvas');
  if (!c) return;
  const { ctx, W, H } = c;

  const hoRows = handoverGet().filter(r => r.element && r.element.trim());
  const schRows = _readSchematicRows()
    .filter(r => +(r.bot || 0) > 0)
    .sort((a, b) => +(a.bot) - +(b.bot));

  if (!hoRows.length && !schRows.length) {
    _noData(ctx, W, H, 'Add handover elements and well schematic first');
    return;
  }

  // Depth range
  const allDepths = [
    ...hoRows.flatMap(r => [r.topMD, r.botMD].filter(d => d != null && d > 0)),
    ...schRows.map(r => +(r.bot)),
  ];
  const maxDepth = allDepths.length ? Math.max(...allDepths) * 1.05 : 5000;

  const C = _qpColors();
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

  // Layout
  const lPad = 60, rPad = 145, tPad = 40, bPad = 30;
  const cx  = lPad + (W - lPad - rPad) / 2;
  const ph  = H - tPad - bPad;
  const dY  = d => tPad + (d / maxDepth) * ph;

  // Unified pixel scale — OD and ID both map through the same factor
  const maxOD  = schRows.length ? Math.max(...schRows.map(r => parseFloat(r.size) || 8.5)) : 13.375;
  const baseHW = Math.min((W - lPad - rPad) / 2 * 0.65, 72);
  const inToHW = inches => (parseFloat(inches) || 8.5) / maxOD * baseHW;

  // Precompute ID for each section
  const schWithID = schRows.map(row => ({
    ...row,
    _odHW: inToHW(row.size),
    _idHW: inToHW(_fdGetID(row)),
  }));

  const SCH_WALL = {
    'Surface Casing':       '#4a7fa8',
    'Intermediate Casing':  '#2a5f88',
    'Production Casing':    '#1a4f78',
    'Liner':                '#2a6f98',
    'Open Hole':            '#b8976a',
  };

  // ── Draw wellbore sections (OD shell + ID bore) ──────────────────
  schWithID.forEach(row => {
    const { _odHW: odHW, _idHW: idHW } = row;
    const yTop = dY(+(row.top || 0));
    const yBot = dY(+(row.bot));
    const wCol = SCH_WALL[row.def] || '#4a7fa8';
    const isOH = row.def === 'Open Hole';

    // Bore fluid fill
    ctx.fillStyle = 'rgba(180,220,255,0.10)';
    ctx.fillRect(cx - idHW, yTop, idHW * 2, yBot - yTop);

    if (isOH) {
      // Open hole: dashed wall at bore edge, no steel
      ctx.setLineDash([5, 3]);
      ctx.strokeStyle = wCol; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx - odHW, yTop); ctx.lineTo(cx - odHW, yBot); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + odHW, yTop); ctx.lineTo(cx + odHW, yBot); ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // Steel wall: fill annular gap between ID and OD
      const wallW = odHW - idHW;
      ctx.fillStyle = wCol + 'bb';
      ctx.fillRect(cx - odHW, yTop, wallW, yBot - yTop);  // left wall band
      ctx.fillRect(cx + idHW, yTop, wallW, yBot - yTop);  // right wall band
      // Outer face line
      ctx.strokeStyle = wCol; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - odHW, yTop); ctx.lineTo(cx - odHW, yBot); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + odHW, yTop); ctx.lineTo(cx + odHW, yBot); ctx.stroke();
      // Inner bore line
      ctx.strokeStyle = wCol + '99'; ctx.lineWidth = 0.75;
      ctx.beginPath(); ctx.moveTo(cx - idHW, yTop); ctx.lineTo(cx - idHW, yBot); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + idHW, yTop); ctx.lineTo(cx + idHW, yBot); ctx.stroke();
    }
  });

  // ── Depth ticks ──────────────────────────────────────────────────
  const nTicks = Math.min(10, Math.ceil(maxDepth / 500));
  ctx.fillStyle = C.dim; ctx.font = '10px sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= nTicks; i++) {
    const d = maxDepth * i / nTicks;
    const y = dY(d);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(lPad - 3, y); ctx.lineTo(cx - baseHW - 4, y); ctx.stroke();
    ctx.fillText(d.toFixed(0) + "'", lPad - 5, y);
  }

  // ── Casing labels on right ───────────────────────────────────────
  schWithID.forEach(row => {
    const { _odHW: odHW } = row;
    const yBot = dY(+(row.bot));
    const od   = parseFloat(row.size || 0);
    const id   = _fdGetID(row);
    const fmt  = v => {
      const fr = v % 1;
      const int = Math.floor(v);
      if (fr === 0) return `${int}"`;
      const map = {0.125:'1/8', 0.25:'1/4', 0.375:'3/8', 0.5:'1/2', 0.625:'5/8', 0.75:'3/4', 0.875:'7/8'};
      return `${int} ${map[fr] || fr.toFixed(3).replace(/^0\./,'')}"`;
    };
    const label = `OD ${fmt(od)} / ID ${fmt(+id.toFixed(3))} — ${row.def}`;
    const wCol  = SCH_WALL[row.def] || '#4a7fa8';

    ctx.strokeStyle = wCol; ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 2]);
    ctx.beginPath(); ctx.moveTo(cx + odHW, yBot); ctx.lineTo(cx + odHW + 8, yBot); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = wCol; ctx.font = '9px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, cx + odHW + 10, yBot);
  });

  // ── Handover elements (sized to ID bore) ─────────────────────────
  hoRows.forEach(row => {
    const topD = row.topMD != null ? row.topMD : row.botMD;
    const botD = row.botMD != null ? row.botMD : row.topMD;
    if (topD == null) return;

    const y1 = dY(topD);
    const y2 = (botD != null && botD !== topD) ? dY(botD) : y1 + 16;

    // ID half-width of the surrounding tubular at topD
    let idHW = baseHW * 0.35;
    for (const sr of schWithID) {
      if (topD <= +(sr.bot)) { idHW = sr._idHW; break; }
    }

    _fdDrawElement(ctx, cx, y1, Math.max(y2, y1 + 16), idHW, row.element);

    // Label: white inside if tall enough, else colored above
    const col   = _fdColor(row.element);
    const label = row.element + (row.size ? ' ' + row.size : '');
    const elemH = y2 - y1;
    ctx.font = `bold ${Math.min(10, Math.max(7, Math.round(idHW * 0.22)))}px sans-serif`;
    ctx.textAlign = 'center';
    if (elemH > 16) {
      ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, (y1 + y2) / 2);
    } else {
      ctx.fillStyle = col; ctx.textBaseline = 'bottom';
      ctx.fillText(label, cx, y1 - 2);
    }
  });

  // ── Title ────────────────────────────────────────────────────────
  ctx.fillStyle = C.text; ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('Final Well Diagram', W / 2, 10);

  ctx.fillStyle = C.dim; ctx.font = '9px sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.fillText('MD (ft)', lPad - 5, tPad - 14);

  CI.register('finalDiagramCanvas', {
    pad: { l: lPad, t: tPad, pw: W - lPad - rPad, ph },
    xMax: 1, yMax: maxDepth,
    xLabel: '', yLabel: 'MD (ft)',
    depthDown: true,
  });
  CI.drawAnnotations(ctx, 'finalDiagramCanvas');
}
