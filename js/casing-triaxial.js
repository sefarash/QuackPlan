// ===== CASING TRIAXIAL / VON MISES CHART =====
// Von Mises ellipse in (Axial Load klbf, Differential Pressure psi) space
// X: tension right (+), compression left (-)
// Y: burst up (+), collapse down (-)
//
// Ellipse derivation (Lamé + Von Mises):
//   σ_a² - σ_a·σ_θ + σ_θ² = (σ_y / DF)²
//   σ_a = F / A        (axial stress, psi)
//   σ_θ = Δp · C_h     (hoop stress at inner wall, Lamé)
//   C_h = (r_i² + r_o²) / (r_o² - r_i²)
//
// Parametric solution (θ = 0 → 2π):
//   σ_a(θ) = R·(cos θ  −  sin θ / √3)
//   σ_θ(θ) = R·(cos θ  +  sin θ / √3),  R = σ_y / DF

const CASING_GRADE_YLD = {
  'J-55': 55000, 'K-55': 55000, 'LS-65': 65000,
  'L-80': 80000, 'N-80': 80000, 'HCL-80': 80000, 'HCN-80': 80000,
  'C-90': 90000, 'R-95': 95000, 'T-95': 95000, 'HC-95': 95000,
  'P-110': 110000, 'Q-125': 125000,
};

// Build Von Mises ellipse points in physical (F_klbf, Δp_psi) space
function _vmEllipse(od_in, id_in, σy, DF) {
  const r_o = od_in / 2, r_i = id_in / 2;
  const A   = Math.PI / 4 * (od_in * od_in - id_in * id_in);
  const C_h = (r_i * r_i + r_o * r_o) / (r_o * r_o - r_i * r_i);
  const R   = σy / DF;
  const K   = 1 / Math.sqrt(3);
  const pts = [];
  for (let k = 0; k <= 180; k++) {
    const t  = 2 * Math.PI * k / 180;
    const sa = R * (Math.cos(t) - K * Math.sin(t));
    const st = R * (Math.cos(t) + K * Math.sin(t));
    pts.push({ x: sa * A / 1000, y: st / C_h });
  }
  return pts;
}

// 2D symmetric grid: x ∈ [-xR, +xR], y ∈ [-yR, +yR]
function _cdGrid2D(ctx, W, H, xR, yR) {
  const t = 62, b = 36, l = 70, r = 20;
  const pw = W - l - r, ph = H - t - b;
  const C  = _qpColors();

  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const gx = l + pw * i / 5, gy = t + ph * i / 5;
    ctx.beginPath(); ctx.moveTo(gx, t);      ctx.lineTo(gx, t + ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(l, gy);      ctx.lineTo(l + pw, gy); ctx.stroke();
    ctx.fillStyle = C.dim; ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText((-xR + 2 * xR * i / 5).toFixed(0), gx, t + ph + 4);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText((yR - 2 * yR * i / 5).toFixed(0), l - 5, gy);
  }

  // Zero lines
  const x0 = l + pw / 2, y0 = t + ph / 2;
  ctx.strokeStyle = C.dim; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(x0, t);  ctx.lineTo(x0, t + ph); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(l, y0);  ctx.lineTo(l + pw, y0); ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = C.border; ctx.lineWidth = 1.5;
  ctx.strokeRect(l, t, pw, ph);

  // Quadrant labels
  ctx.fillStyle = C.dim; ctx.font = '9px sans-serif';
  ctx.textAlign = 'left';  ctx.textBaseline = 'middle';
  ctx.fillText('← Compression', l + 4, t + ph / 2 - 10);
  ctx.textAlign = 'right';
  ctx.fillText('Tension →', l + pw - 4, t + ph / 2 - 10);
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('↑ Burst', x0, t + ph / 2 - 2);
  ctx.textBaseline = 'top';
  ctx.fillText('↓ Collapse', x0, t + ph / 2 + 2);

  // Axis titles
  ctx.fillStyle = C.text; ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('Axial Load (klbf)', l + pw / 2, t - 30);
  ctx.save();
  ctx.translate(12, t + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillText('Differential Pressure (psi)', 0, 0);
  ctx.restore();

  return { l, t, pw, ph, xR, yR };
}

// Map physical (F_klbf, Δp_psi) → canvas pixel
function _cdPt(p, g) {
  return {
    cx: g.l + ((p.x + g.xR) / (2 * g.xR)) * g.pw,
    cy: g.t + ((g.yR - p.y) / (2 * g.yR)) * g.ph,
  };
}

// Draw a curve in physical coords
function _cdLine(ctx, pts, color, lw, g) {
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => {
    const { cx, cy } = _cdPt(p, g);
    i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
  });
  ctx.stroke();
}

// ── Main draw function ────────────────────────────────────────────────────────
function drawCasingTriaxial() {
  const CID = 'cdTriaxialCanvas';
  const c   = _chartSetup(CID);
  if (!c) return;
  const { ctx, W, H } = c;

  const survey  = qpState.survey || [];
  const mw      = fluidGet().mudWeight || 10;
  const BF      = 1 - mw / 65.5;
  const ppfgPts = _readPPFG();

  const casingRows = _readSchematicRows()
    .filter(r => r.def !== 'Open Hole' && +(r.bot || 0) > 0)
    .sort((a, b) => +(a.bot) - +(b.bot));

  const withSpec = casingRows.filter(r => r.id_in > 0 && r.grade);
  if (!withSpec.length) {
    _noData(ctx, W, H, 'Select weight & grade in Well Schematic for triaxial'); return;
  }

  // MASP from highest FG at any shoe
  const maxMasp = casingRows.reduce((mx, row) => {
    const shoeTVD = _tvdAt(survey, +(row.bot));
    const fg      = _ppfgInterp(ppfgPts, shoeTVD, 'fg');
    return Math.max(mx, Math.max(0, (fg - mw) * 0.052 * shoeTVD));
  }, 0);

  const COLORS = ['#2a7fa8', '#1a7a4a', '#e67e22', '#8e44ad', '#c0392b', '#16a085'];

  // Build section data and determine axis range
  let xR = 50, yR = 500;
  const sections = withSpec.map((row, i) => {
    const od_in = +(row.size);
    const id_in = +row.id_in;
    const σy    = CASING_GRADE_YLD[row.grade] || 80000;
    const A     = Math.PI / 4 * (od_in * od_in - id_in * id_in);
    const r_o   = od_in / 2, r_i = id_in / 2;
    const C_h   = (r_i * r_i + r_o * r_o) / (r_o * r_o - r_i * r_i);
    const shoeMD  = +(row.bot);
    const topMD   = i === 0 ? 0 : +(withSpec[i - 1].bot);
    const shoeTVD = _tvdAt(survey, shoeMD);
    const topTVD  = _tvdAt(survey, topMD);
    const nomWt   = row.nomWt_ppf || 0;

    // Cumulative buoyant weight of sections above this one
    let F_above = 0;
    for (let j = 0; j < i; j++) {
      const rj  = withSpec[j];
      const len = +(rj.bot) - (j === 0 ? 0 : +(withSpec[j - 1].bot));
      F_above  += len * (rj.nomWt_ppf || 0) * BF / 1000;
    }
    const F_this    = (shoeMD - topMD) * nomWt * BF / 1000;
    const F_topHang = F_above + F_this;   // tension at top when freely hanging

    // Burst differential at top of section (gas-to-surface scenario)
    const Δp_burst    = Math.max(0, maxMasp + GAS_GRAD * topTVD - mw * 0.052 * topTVD);
    // Collapse at shoe (evacuated string — worst case)
    const Δp_collapse = -(mw * 0.052 * shoeTVD);

    const loadPts = [
      { x: F_topHang, y: 0,           label: 'Initial'  },
      { x: F_topHang, y: Δp_burst,    label: 'Burst'    },
      { x: F_above,   y: Δp_collapse, label: 'Collapse' },
    ];

    // Expand axis to fit ellipse extremes
    xR = Math.max(xR, σy * A / 1000 * 1.15);
    yR = Math.max(yR, σy / C_h * 1.15, Math.abs(Δp_collapse) * 1.15, Δp_burst * 1.15);

    return {
      ell10: _vmEllipse(od_in, id_in, σy, 1.0),
      ell11: _vmEllipse(od_in, id_in, σy, 1.1),
      loadPts,
      color: COLORS[i % COLORS.length],
      label: `${od_in}" ${row.grade}`,
      σy, A, C_h,
    };
  });

  // Round axis up to nice numbers
  xR = Math.ceil(xR / 50)  * 50;
  yR = Math.ceil(yR / 500) * 500;

  const g = _cdGrid2D(ctx, W, H, xR, yR);

  // CI storage — shift coords so 0 → left/bottom edge (CI assumes 0-based)
  const shift = pts => pts.map(p => ({ x: p.x + xR, y: p.y + yR }));
  CI.storeLive(CID, sections.map(s => ({ pts: shift(s.ell10), color: s.color, label: s.label })));
  CI.register(CID, {
    pad: { l: g.l, t: g.t, pw: g.pw, ph: g.ph },
    xMax: 2 * xR, yMax: 2 * yR,
    xLabel: 'Axial Load (klbf)', yLabel: 'Diff. Pressure (psi)',
    depthDown: false, xOffset: -xR, yOffset: -yR,
  });
  CI.drawFrozen(ctx, CID);

  sections.forEach(sec => {
    // DF = 1.0 ellipse — solid
    _cdLine(ctx, sec.ell10, sec.color, 2, g);
    // DF = 1.1 ellipse — dashed
    ctx.setLineDash([5, 3]);
    _cdLine(ctx, sec.ell11, sec.color, 1.2, g);
    ctx.setLineDash([]);

    // Load case markers
    const MARKERS = { 'Initial': '●', 'Burst': '▲', 'Collapse': '▼' };
    sec.loadPts.forEach(pt => {
      const { cx, cy } = _cdPt(pt, g);
      ctx.fillStyle = sec.color;
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = _qpColors().text; ctx.font = '9px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(pt.label, cx + 6, cy - 2);
    });
  });

  // Legend + DF note
  _legend(ctx, W, g.t, sections.map(s => s.label), sections.map(s => s.color));
  const C = _qpColors();
  ctx.fillStyle = C.dim; ctx.font = '9px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('Solid = DF 1.0 · Dashed = DF 1.1', g.l + 4, g.t + 4);

  CI.drawAnnotations(ctx, CID);
}
