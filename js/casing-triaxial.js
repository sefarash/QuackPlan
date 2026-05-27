// ===== CASING TRIAXIAL / VON MISES CHART =====
// Von Mises envelope in (Axial Load klbf, Differential Pressure psi) space
// X: tension right (+), compression left (-)
// Y: burst up (+), collapse down (-)
//
// Ellipse (Lamé thick-wall + Von Mises):
//   σ_a² − σ_a·σ_θ + σ_θ² = (σ_y / DF)²
//   σ_a = F / A_s    (axial stress, psi, tension +)
//   σ_θ = Δp · C_h   (hoop stress at inner wall, Lamé: C_h = (r_i²+r_o²)/(r_o²−r_i²))
//
// Parametric form (θ = 0 → 2π):
//   σ_a(θ) = R · (cos θ − sin θ / √3)
//   σ_θ(θ) = R · (cos θ + sin θ / √3),   R = σ_y / DF

const CASING_GRADE_YLD = {
  'J-55': 55000, 'K-55': 55000, 'LS-65': 65000,
  'L-80': 80000, 'N-80': 80000, 'HCL-80': 80000, 'HCN-80': 80000,
  'C-90': 90000, 'R-95': 95000, 'T-95': 95000, 'HC-95': 95000,
  'P-110': 110000, 'Q-125': 125000,
};

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
    ctx.beginPath(); ctx.moveTo(gx, t);  ctx.lineTo(gx, t + ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(l, gy);  ctx.lineTo(l + pw, gy); ctx.stroke();
    ctx.fillStyle = C.dim; ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText((-xR + 2 * xR * i / 5).toFixed(0), gx, t + ph + 4);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText((yR - 2 * yR * i / 5).toFixed(0), l - 5, gy);
  }

  const x0 = l + pw / 2, y0 = t + ph / 2;
  ctx.strokeStyle = C.dim; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(x0, t);  ctx.lineTo(x0, t + ph); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(l, y0);  ctx.lineTo(l + pw, y0); ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = C.border; ctx.lineWidth = 1.5;
  ctx.strokeRect(l, t, pw, ph);

  // Axis titles
  ctx.fillStyle = C.text; ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('Axial Load (klbf)', l + pw / 2, t - 30);
  ctx.save();
  ctx.translate(12, t + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillText('Diff. Pressure (psi)', 0, 0);
  ctx.restore();

  // Direction hints near axis extremes (not at zero-crossing where dots land)
  ctx.fillStyle = C.dim; ctx.font = '9px sans-serif';
  ctx.textAlign = 'left';  ctx.textBaseline = 'top';
  ctx.fillText('← Compression', l + 2, t + ph + 16);
  ctx.textAlign = 'right';
  ctx.fillText('Tension →', l + pw - 2, t + ph + 16);
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText('↑ Burst', l - 4, t - 6);
  ctx.textBaseline = 'top';
  ctx.fillText('↓ Collapse', l - 4, t + ph + 6);

  return { l, t, pw, ph, xR, yR };
}

function _cdPt(p, g) {
  return {
    cx: g.l + ((p.x + g.xR) / (2 * g.xR)) * g.pw,
    cy: g.t + ((g.yR - p.y) / (2 * g.yR)) * g.ph,
  };
}

function _cdLine(ctx, pts, color, lw, g) {
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => {
    const { cx, cy } = _cdPt(p, g);
    i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
  });
  ctx.stroke();
}

// ── Main chart ────────────────────────────────────────────────────────────────
function drawCasingTriaxial() {
  const CID = 'cdTriaxialCanvas';
  const c   = _chartSetup(CID);
  if (!c) return;
  const { ctx, W, H } = c;

  const survey  = qpState.survey || [];
  const mw      = fluidGet().mudWeight || 10;
  const BF      = 1 - mw / 65.5;
  const ppfgPts = _readPPFG();
  const ratings = _readCDRatings();
  const sfBurst    = +(document.getElementById('cdSFBurst')?.value    || 1.10);
  const sfCollapse = +(document.getElementById('cdSFCollapse')?.value || 1.00);

  const casingRows = _readSchematicRows()
    .filter(r => r.def !== 'Open Hole' && +(r.bot || 0) > 0)
    .sort((a, b) => +(a.bot) - +(b.bot));

  const withSpec = casingRows.filter(r => r.id_in > 0 && r.grade);
  if (!withSpec.length) {
    _noData(ctx, W, H, 'Select weight & grade in Well Schematic for triaxial'); return;
  }

  // Selected section (default to first)
  const selKey = _selectedCDKey() || _cdKey(withSpec[0]);
  const secIdx = withSpec.findIndex(r => _cdKey(r) === selKey);
  const i      = secIdx >= 0 ? secIdx : 0;
  const row    = withSpec[i];

  const od_in = +(row.size);
  const id_in = +row.id_in;
  const σy    = CASING_GRADE_YLD[row.grade] || 80000;
  const A     = Math.PI / 4 * (od_in * od_in - id_in * id_in);
  const r_o   = od_in / 2, r_i = id_in / 2;
  const C_h   = (r_i * r_i + r_o * r_o) / (r_o * r_o - r_i * r_i);
  const bodyYield_klbf = σy * A / 1000;

  const shoeMD  = +(row.bot);
  const topMD   = i === 0 ? 0 : +(withSpec[i - 1].bot);
  const shoeTVD = _tvdAt(survey, shoeMD);
  const topTVD  = _tvdAt(survey, topMD);
  const nomWt   = row.nomWt_ppf || 0;

  // Cumulative buoyant weight above this section
  let F_above = 0;
  for (let j = 0; j < i; j++) {
    const rj  = withSpec[j];
    const len = +(rj.bot) - (j === 0 ? 0 : +(withSpec[j - 1].bot));
    F_above  += len * (rj.nomWt_ppf || 0) * BF / 1000;
  }
  const F_this    = (shoeMD - topMD) * nomWt * BF / 1000;
  const F_topHang = F_above + F_this;

  // MASP from highest FG at any shoe
  const maxMasp = casingRows.reduce((mx, r2) => {
    const tvd = _tvdAt(survey, +(r2.bot));
    const fg  = _ppfgInterp(ppfgPts, tvd, 'fg');
    return Math.max(mx, Math.max(0, (fg - mw) * 0.052 * tvd));
  }, 0);

  const Δp_burst    = Math.max(0, maxMasp + GAS_GRAD * topTVD - mw * 0.052 * topTVD);
  const Δp_collapse = -(mw * 0.052 * shoeTVD);

  // Overpull: POOH surface hookload if available, else 1.3× hanging weight
  let F_overpull = F_topHang * 1.3;
  if (qpState.tdResult) {
    const poohSt = qpState.tdResult.modes?.pooh?.ffSensitivity?.mid?.stations || [];
    if (poohSt.length) {
      const surf = poohSt.reduce((mn, s) => s.md < mn.md ? s : mn, poohSt[0]);
      F_overpull = Math.max(F_overpull, surf.axialLoad_lbf / 1000);
    }
  }

  // API design box from user-entered ratings / SF
  const rr              = ratings[selKey] || {};
  const burst_rating    = rr.burst    || row.burst    || 0;
  const collapse_rating = rr.collapse || row.collapse || 0;
  const hasBox          = burst_rating > 0 || collapse_rating > 0;

  // Axis range — fit ellipse + load cases + box
  let xR = Math.max(bodyYield_klbf * 1.15, F_overpull * 1.1, 50);
  let yR = Math.max(
    σy / C_h * 1.15,
    Math.abs(Δp_collapse) * 1.15,
    Δp_burst > 0 ? Δp_burst * 1.15 : 500,
    hasBox ? burst_rating / sfBurst * 1.15 : 0,
    hasBox ? collapse_rating / sfCollapse * 1.15 : 0,
    500
  );
  xR = Math.ceil(xR / 50)  * 50;
  yR = Math.ceil(yR / 500) * 500;

  const g = _cdGrid2D(ctx, W, H, xR, yR);

  // Build ellipses
  const ell10 = _vmEllipse(od_in, id_in, σy, 1.0);
  const ell11 = _vmEllipse(od_in, id_in, σy, 1.1);

  // CI storage (shift coords so left/bottom edge = 0)
  const shift = pts => pts.map(p => ({ x: p.x + xR, y: p.y + yR }));
  CI.storeLive(CID, [
    { pts: shift(ell10), color: '#e67e22', label: 'DF 1.0' },
    { pts: shift(ell11), color: '#1a7a4a', label: 'DF 1.1' },
  ]);
  CI.register(CID, {
    pad: { l: g.l, t: g.t, pw: g.pw, ph: g.ph },
    xMax: 2 * xR, yMax: 2 * yR,
    xLabel: 'Axial Load (klbf)', yLabel: 'Diff. Pressure (psi)',
    depthDown: false, xOffset: -xR, yOffset: -yR,
  });
  CI.drawFrozen(ctx, CID);

  // ── API design box ──────────────────────────────────────────────────────────
  if (hasBox) {
    const bx = bodyYield_klbf / sfBurst;
    const by = burst_rating    / sfBurst;
    const cy_b = collapse_rating / sfCollapse;
    const boxPts = [
      { x: -bx, y:  by }, { x: bx, y:  by },
      { x:  bx, y: -cy_b }, { x: -bx, y: -cy_b },
      { x: -bx, y:  by },
    ];
    ctx.setLineDash([6, 3]);
    _cdLine(ctx, boxPts, '#d35fb7', 1.5, g);
    ctx.setLineDash([]);
    // Label bottom-right corner
    const corner = _cdPt({ x: bx, y: -cy_b }, g);
    ctx.fillStyle = '#d35fb7'; ctx.font = '9px sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(`DF ${sfBurst.toFixed(2)} / ${sfCollapse.toFixed(2)}`, corner.cx - 3, corner.cy + 3);
  }

  // ── Von Mises ellipses ──────────────────────────────────────────────────────
  // DF = 1.0 — gold/orange solid
  _cdLine(ctx, ell10, '#e67e22', 2.5, g);
  // DF = 1.1 — green dashed
  ctx.setLineDash([6, 3]);
  _cdLine(ctx, ell11, '#1a7a4a', 1.5, g);
  ctx.setLineDash([]);

  // ── Load case markers ───────────────────────────────────────────────────────
  const loadPts = [
    { x: F_topHang,  y: 0,           label: 'Initial',  color: '#2a7fa8' },
    { x: F_topHang,  y: Δp_burst,    label: 'Burst',    color: '#c0392b' },
    { x: F_above,    y: Δp_collapse, label: 'Collapse', color: '#7a4aa0' },
    { x: F_overpull, y: 0,           label: 'Overpull', color: '#e07a1a' },
  ];
  // Pre-compute canvas positions for overlap detection
  const cPts = loadPts.map(pt => ({ ...pt, ...(_cdPt(pt, g)), labelAbove: true }));
  for (let a = 0; a < cPts.length; a++) {
    for (let b = a + 1; b < cPts.length; b++) {
      if (Math.abs(cPts[a].cx - cPts[b].cx) < 70 && Math.abs(cPts[a].cy - cPts[b].cy) < 18) {
        cPts[a].labelAbove = true;
        cPts[b].labelAbove = false;
      }
    }
  }
  cPts.forEach(pt => {
    ctx.fillStyle = pt.color;
    ctx.beginPath(); ctx.arc(pt.cx, pt.cy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = _qpColors().text; ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = pt.labelAbove ? 'bottom' : 'top';
    ctx.fillText(pt.label, pt.cx + 7, pt.cy + (pt.labelAbove ? -3 : 3));
  });

  // ── Pipe spec heading ───────────────────────────────────────────────────────
  const C = _qpColors();
  ctx.fillStyle = C.text; ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const specStr = [
    `${od_in}" Casing`,
    nomWt   ? `${nomWt} ppf` : null,
    row.grade || null,
    row.def !== 'Open Hole' ? row.def : null,
  ].filter(Boolean).join('  ·  ');
  ctx.fillText(specStr, g.l + g.pw / 2, g.t - 10);

  ctx.fillStyle = C.dim; ctx.font = '10px sans-serif';
  ctx.fillText(
    `σ_y = ${(σy / 1000).toFixed(0)} kpsi  ·  Body Yield = ${bodyYield_klbf.toFixed(0)} klbf  ·  ID = ${id_in.toFixed(3)}"`,
    g.l + g.pw / 2, g.t - 10 - 14
  );

  // ── Legend ──────────────────────────────────────────────────────────────────
  const legendLabels = ['DF 1.0 (yield)', 'DF 1.1 (design)'];
  const legendColors = ['#e67e22', '#1a7a4a'];
  if (hasBox) { legendLabels.push('API box'); legendColors.push('#d35fb7'); }

  _legend(ctx, W, g.t, legendLabels, legendColors);
  CI.drawAnnotations(ctx, CID);
}
