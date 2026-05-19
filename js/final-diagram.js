// ===== FINAL DIAGRAM =====
// Wellbore completion diagram — wellbore walls from Well Schematic,
// elements from Handover table, positioned at their MD depths.

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

// ── Element draw functions ──────────────────────────────────────────────────

function _fdBPV(ctx, cx, y, hw, col) {
  const tw = hw * 0.75, bw = hw * 0.18, h = 20;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(cx - tw, y - h); ctx.lineTo(cx + tw, y - h);
  ctx.lineTo(cx + bw, y);     ctx.lineTo(cx - bw, y);
  ctx.closePath(); ctx.fill();
  // stem
  ctx.fillRect(cx - bw, y, bw * 2, 6);
  ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke();
}

function _fdPacker(ctx, cx, y1, y2, hw, col) {
  // Chevron-waisted shape
  const pw = hw * 0.9, mid = (y1 + y2) / 2;
  ctx.fillStyle = col + 'cc';
  ctx.beginPath();
  ctx.moveTo(cx - pw, y1);
  ctx.lineTo(cx + pw, y1);
  ctx.lineTo(cx + pw * 0.55, mid);
  ctx.lineTo(cx + pw, y2);
  ctx.lineTo(cx - pw, y2);
  ctx.lineTo(cx - pw * 0.55, mid);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
}

function _fdCement(ctx, cx, y1, y2, hw, col) {
  const pw = hw * 0.82;
  ctx.fillStyle = col + 'b0';
  ctx.fillRect(cx - pw, y1, pw * 2, y2 - y1);
  // diagonal hatch
  ctx.save();
  ctx.beginPath(); ctx.rect(cx - pw, y1, pw * 2, y2 - y1); ctx.clip();
  ctx.strokeStyle = col + '66'; ctx.lineWidth = 1;
  const step = 9;
  for (let x = cx - pw - (y2 - y1); x < cx + pw + (y2 - y1); x += step) {
    ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x + (y2 - y1), y2); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(cx - pw, y1, pw * 2, y2 - y1);
}

function _fdWhipstock(ctx, cx, y, hw, col) {
  // Angled wedge leaning right
  const w = hw * 0.8, h = 34;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(cx - w, y);
  ctx.lineTo(cx + w * 0.25, y);
  ctx.lineTo(cx - w * 0.15, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke();
}

function _fdFish(ctx, cx, y1, y2, hw, col) {
  // Rounded capsule
  const pw = hw * 0.32, h = Math.max(y2 - y1, 20);
  const r = pw;
  ctx.fillStyle = col + 'cc';
  ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - pw, y1 + r);
  ctx.arc(cx, y1 + r, pw, Math.PI, 0);          // top cap
  ctx.lineTo(cx + pw, y1 + h - r);
  ctx.arc(cx, y1 + h - r, pw, 0, Math.PI);       // bottom cap
  ctx.closePath();
  ctx.fill(); ctx.stroke();
}

function _fdTubing(ctx, cx, y1, y2, hw, col) {
  const pw = hw * 0.42, wt = 4;
  ctx.fillStyle = col + '33';
  ctx.fillRect(cx - pw, y1, pw * 2, y2 - y1);
  ctx.fillStyle = col;
  ctx.fillRect(cx - pw, y1, wt, y2 - y1);
  ctx.fillRect(cx + pw - wt, y1, wt, y2 - y1);
  ctx.strokeStyle = col; ctx.lineWidth = 1;
  ctx.strokeRect(cx - pw, y1, pw * 2, y2 - y1);
}

function _fdPlug(ctx, cx, y, hw, col) {
  // Downward-pointing trapezoid
  const tw = hw * 0.72, bw = hw * 0.18, h = 16;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(cx - tw, y - h / 2); ctx.lineTo(cx + tw, y - h / 2);
  ctx.lineTo(cx + bw, y + h / 2); ctx.lineTo(cx - bw, y + h / 2);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
}

function _fdScreen(ctx, cx, y1, y2, hw, col) {
  const pw = hw * 0.52;
  ctx.strokeStyle = col; ctx.lineWidth = 1.2;
  ctx.strokeRect(cx - pw, y1, pw * 2, y2 - y1);
  // grid hatch
  ctx.save();
  ctx.beginPath(); ctx.rect(cx - pw, y1, pw * 2, y2 - y1); ctx.clip();
  ctx.lineWidth = 0.8;
  const s = 6;
  for (let yy = y1; yy < y2; yy += s) {
    ctx.beginPath(); ctx.moveTo(cx - pw, yy); ctx.lineTo(cx + pw, yy); ctx.stroke();
  }
  for (let xx = cx - pw; xx < cx + pw; xx += s) {
    ctx.beginPath(); ctx.moveTo(xx, y1); ctx.lineTo(xx, y2); ctx.stroke();
  }
  ctx.restore();
}

function _fdPerf(ctx, cx, y, hw, col) {
  ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  ctx.fillStyle = col;
  for (const side of [-1, 1]) {
    const bx = cx + side * hw * 0.78;
    ctx.beginPath(); ctx.moveTo(cx + side * hw * 0.5, y); ctx.lineTo(bx, y); ctx.stroke();
    ctx.beginPath(); ctx.arc(bx, y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
}

function _fdValve(ctx, cx, y, hw, col) {
  const w = hw * 0.5, h = 15;
  ctx.fillStyle = col + 'cc';
  ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, y - h); ctx.lineTo(cx + w, y);
  ctx.lineTo(cx, y + h); ctx.lineTo(cx - w, y);
  ctx.closePath(); ctx.fill(); ctx.stroke();
}

function _fdGeneric(ctx, cx, y1, y2, hw, col) {
  const pw = hw * 0.65, h = Math.max(y2 - y1, 14);
  ctx.fillStyle = col + 'aa';
  ctx.fillRect(cx - pw, y1, pw * 2, h);
  ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  ctx.strokeRect(cx - pw, y1, pw * 2, h);
}

function _fdDrawElement(ctx, cx, y1, y2, hw, element) {
  const col  = _fdColor(element);
  const name = element.toLowerCase();
  if (name.includes('bpv'))                                _fdBPV(ctx, cx, y1, hw, col);
  else if (name.includes('packer'))                        _fdPacker(ctx, cx, y1, y2, hw, col);
  else if (name.includes('cement'))                        _fdCement(ctx, cx, y1, y2, hw, col);
  else if (name.includes('whip'))                          _fdWhipstock(ctx, cx, y1, hw, col);
  else if (name.includes('fish'))                          _fdFish(ctx, cx, y1, y2, hw, col);
  else if (name.includes('tubing'))                        _fdTubing(ctx, cx, y1, y2, hw, col);
  else if (name.includes('liner'))                         _fdTubing(ctx, cx, y1, y2, hw, col);
  else if (name.includes('bridge plug') || name === 'plug') _fdPlug(ctx, cx, y1, hw, col);
  else if (name.includes('screen'))                        _fdScreen(ctx, cx, y1, y2, hw, col);
  else if (name.includes('perf'))                          _fdPerf(ctx, cx, y1, hw, col);
  else if (name.includes('valve'))                         _fdValve(ctx, cx, y1, hw, col);
  else if (name.includes('plug'))                          _fdPlug(ctx, cx, y1, hw, col);
  else                                                     _fdGeneric(ctx, cx, y1, y2, hw, col);
}

// ── Main draw function ──────────────────────────────────────────────────────

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

  // Layout — diagram centered, labels left & right
  const lPad = 60, rPad = 140, tPad = 40, bPad = 30;
  const cx  = lPad + (W - lPad - rPad) / 2;
  const ph  = H - tPad - bPad;
  const dY  = d => tPad + (d / maxDepth) * ph;

  // Wellbore half-widths proportional to casing OD
  const maxOD  = schRows.length ? Math.max(...schRows.map(r => parseFloat(r.size) || 8.5)) : 13.375;
  const baseHW = Math.min((W - lPad - rPad) / 2 * 0.65, 72);
  const odToHW = od => (parseFloat(od) || 8.5) / maxOD * baseHW;

  // ── Wellbore walls ──────────────────────────────────────────────
  const SCH_WALL = {
    'Surface Casing':       '#4a7fa8',
    'Intermediate Casing':  '#2a5f88',
    'Production Casing':    '#1a4f78',
    'Liner':                '#2a6f98',
    'Open Hole':            '#b8976a',
  };
  const SCH_FILL = {
    'Surface Casing':       'rgba(74,127,168,0.09)',
    'Intermediate Casing':  'rgba(42,95,136,0.09)',
    'Production Casing':    'rgba(26,79,120,0.09)',
    'Liner':                'rgba(42,111,152,0.09)',
    'Open Hole':            'rgba(184,151,106,0.11)',
  };

  schRows.forEach(row => {
    const hw    = odToHW(row.size);
    const yTop  = dY(+(row.top || 0));
    const yBot  = dY(+(row.bot));
    const wCol  = SCH_WALL[row.def] || '#4a7fa8';
    const fCol  = SCH_FILL[row.def] || 'rgba(100,150,200,0.08)';
    const isOH  = row.def === 'Open Hole';
    const wt    = isOH ? 1.5 : 3;

    ctx.fillStyle = fCol;
    ctx.fillRect(cx - hw, yTop, hw * 2, yBot - yTop);

    if (isOH) {
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = wCol; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx - hw, yTop); ctx.lineTo(cx - hw, yBot); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + hw, yTop); ctx.lineTo(cx + hw, yBot); ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = wCol;
      ctx.fillRect(cx - hw, yTop, wt, yBot - yTop);
      ctx.fillRect(cx + hw - wt, yTop, wt, yBot - yTop);
    }
  });

  // ── Depth ticks ─────────────────────────────────────────────────
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

  // ── Casing labels on right ──────────────────────────────────────
  schRows.forEach(row => {
    const hw   = odToHW(row.size);
    const yBot = dY(+(row.bot));
    const od   = parseFloat(row.size || 0);
    const frac = od % 1 === 0 ? od.toFixed(0)
               : od === Math.floor(od) + 0.375 ? `${Math.floor(od)} 3/8"`
               : od === Math.floor(od) + 0.625 ? `${Math.floor(od)} 5/8"`
               : od === Math.floor(od) + 0.125 ? `${Math.floor(od)} 1/8"`
               : od.toFixed(3).replace(/0+$/, '');
    const label = `${frac}" ${row.def}`;
    const wCol  = SCH_WALL[row.def] || '#4a7fa8';

    ctx.strokeStyle = wCol; ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 2]);
    ctx.beginPath(); ctx.moveTo(cx + hw, yBot); ctx.lineTo(cx + hw + 8, yBot); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = wCol; ctx.font = '9px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, cx + hw + 10, yBot);
  });

  // ── Elements from Handover ──────────────────────────────────────
  hoRows.forEach(row => {
    const topD = row.topMD != null ? row.topMD : row.botMD;
    const botD = row.botMD != null ? row.botMD : row.topMD;
    if (topD == null) return;

    const y1 = dY(topD);
    const y2 = (botD != null && botD !== topD) ? dY(botD) : y1 + 16;

    // Wellbore half-width at this depth
    let hw = baseHW * 0.5;
    for (const sr of schRows) {
      if (topD <= +(sr.bot)) { hw = odToHW(sr.size) * 0.88; break; }
    }

    _fdDrawElement(ctx, cx, y1, Math.max(y2, y1 + 16), hw, row.element);

    // Label: inside if there's room, otherwise above
    const col    = _fdColor(row.element);
    const label  = row.element + (row.size ? ' ' + row.size : '');
    const elemH  = y2 - y1;
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    if (elemH > 14) {
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, (y1 + y2) / 2);
    } else {
      ctx.fillStyle = col;
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, cx, y1 - 2);
    }
  });

  // ── Title ───────────────────────────────────────────────────────
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
