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

// Minimum yield strength (psi) per grade — covers every grade string in
// casing-catalogue.js. The trailing number of an API/proprietary grade is the
// minimum yield in ksi (e.g. P-110 → 110,000 psi). Any grade missing here would
// fall back to 80,000 and size the Von Mises ellipse badly wrong (V-150 would be
// 88% too small, P-110 27% too small).
const CASING_GRADE_YLD = {
  'H-40':  40000,
  'J-55':  55000, 'K-55':  55000, 'HCK-55': 55000,
  'LS-65': 65000,
  'L-80':  80000, 'N-80':  80000, 'HCL-80': 80000, 'HCN-80': 80000,
  'C-90':  90000, 'H2S-90': 90000,
  'C-95':  95000, 'S-95':  95000, 'T-95':  95000, 'H2S-95': 95000,
  'P-110': 110000, 'HCP-110': 110000,
  'Q-125': 125000, 'HCQ-125': 125000,
  'LS-140': 140000,
  'V-150': 150000,
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
  // Responsive top padding — gives enough room for 3 header lines on any screen
  const t = Math.max(90, Math.round(H * 0.12));
  const b = 36, l = 70, r = 20;
  const pw = W - l - r, ph = H - t - b;
  const C  = _qpColors();

  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const gx = l + pw * i / 5, gy = t + ph * i / 5;
    ctx.beginPath(); ctx.moveTo(gx, t);  ctx.lineTo(gx, t + ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(l, gy);  ctx.lineTo(l + pw, gy); ctx.stroke();
    ctx.fillStyle = C.dim; ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    // Axes are axial force (klbf) and differential pressure (psi) → display labels
    ctx.fillText(Math.round(QP_UNITS.toDisplay('force', -xR + 2 * xR * i / 5)).toLocaleString(), gx, t + ph + 4);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(QP_UNITS.toDisplay('press', yR - 2 * yR * i / 5)).toLocaleString(), l - 5, gy);
  }

  const x0 = l + pw / 2, y0 = t + ph / 2;
  ctx.strokeStyle = C.dim; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(x0, t);  ctx.lineTo(x0, t + ph); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(l, y0);  ctx.lineTo(l + pw, y0); ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = C.border; ctx.lineWidth = 1.5;
  ctx.strokeRect(l, t, pw, ph);

  // X axis title: direction embedded so no separate hints needed near data area
  ctx.fillStyle = C.text; ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(`Compression ←  Axial Load (${QP_UNITS.label('force')})  → Tension`, l + pw / 2, t - 58);

  // Y axis title: direction embedded
  ctx.save();
  ctx.translate(12, t + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillStyle = C.text;
  ctx.fillText(`↓ Collapse   Diff. Pressure (${QP_UNITS.label('press')})   Burst ↑`, 0, 0);
  ctx.restore();

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
  const sfBurst       = +(document.getElementById('cdSFBurst')?.value       || 1.10);
  const sfCollapse    = +(document.getElementById('cdSFCollapse')?.value    || 1.00);
  const sfTension     = +(document.getElementById('cdSFTension')?.value     || 1.30);
  const sfCompression = +(document.getElementById('cdSFCompression')?.value || 1.30);

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

  // ── Bending stress from max DLS along this casing section ─────────────────
  // σ_b = E × r_o_ft × DLS_rad/ft  (outer fibre, most stressed)
  // F_bend = σ_b × A_s (converts to equivalent axial load, shifts op. points ±)
  const E_STEEL = 30e6; // psi
  const DLS_max_deg = survey
    .filter(s => s.md >= topMD && s.md <= shoeMD && s.dls != null)
    .reduce((mx, s) => Math.max(mx, s.dls || 0), 0);
  const DLS_rad_ft = DLS_max_deg * Math.PI / (180 * 100); // rad/ft
  const σ_bend     = DLS_rad_ft > 0 ? E_STEEL * (od_in / 24) * DLS_rad_ft : 0; // psi (r_o in ft)
  const F_bend     = σ_bend * A / 1000; // klbf

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

  const Ai = Math.PI * r_i * r_i; // inner cross-section area (in²)
  const ν  = 0.3;                 // Poisson ratio for steel

  // Fixed Mud Drop Collapse: gas gradient (GAS_GRAD) inside, full MW outside at shoe
  // Ballooning: internal pressure drops → pipe elongates (axial tension increases)
  const Δp_fmd = -(mw * 0.052 - GAS_GRAD) * shoeTVD;
  const F_fmd  = F_above + 2 * ν * Ai * (mw * 0.052 - GAS_GRAD) * shoeTVD / 1000;

  // MASP Burst: surface pressure = (FG - MW) × 0.052 × TVD_shoe; uniform ΔP (same fluid gradients)
  // Ballooning: internal pressure rises → pipe shortens (axial compression increases)
  const Δp_masp = maxMasp;
  const F_masp  = maxMasp > 0 ? F_topHang - 2 * ν * Ai * maxMasp / 1000 : null;

  // Pressure Test: user-entered surface test pressure
  const P_test   = +(document.getElementById('cdPtest')?.value || 0);
  const Δp_ptest = P_test;
  const F_ptest  = P_test > 0 ? F_topHang - 2 * ν * Ai * P_test / 1000 : null;

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
  const burst_rating    = rr.burst       || row.burst    || 0;
  const collapse_rating = rr.collapse    || row.collapse || 0;
  const tension_rating  = rr.tension     || 0;
  const comp_rating     = rr.compression || 0;
  const hasBox          = burst_rating > 0 || collapse_rating > 0 || tension_rating > 0 || comp_rating > 0;

  // Tension capacity = min(pipe body yield, joint strength). A threaded
  // connection can fail in tension before the pipe body, so the catalogue joint
  // yield (weakest available connection) caps the tensile design limit.
  const tensionCap_klbf = (row.jointYield != null && +row.jointYield > 0)
    ? Math.min(bodyYield_klbf, +row.jointYield)
    : bodyYield_klbf;

  // API box x-extents: use user-entered ratings if available, else the capacity above
  const bx_pos = tension_rating > 0 ? tension_rating / sfTension     : tensionCap_klbf / sfTension;
  const bx_neg = comp_rating    > 0 ? comp_rating    / sfCompression : bodyYield_klbf  / sfCompression;

  // Axis range — fit ellipse + all load cases + API box + bending envelope
  let xR = Math.max(bodyYield_klbf * 1.15, (F_overpull + F_bend) * 1.1, Math.abs(F_fmd + F_bend) * 1.1, 50);
  if (F_masp  !== null) xR = Math.max(xR, Math.abs(F_masp  + F_bend) * 1.1);
  if (F_ptest !== null) xR = Math.max(xR, Math.abs(F_ptest + F_bend) * 1.1);
  let yR = Math.max(
    σy / C_h * 1.15,
    Math.abs(Δp_fmd) * 1.15,
    Δp_masp  > 0 ? Δp_masp  * 1.15 : 500,
    Δp_ptest > 0 ? Δp_ptest * 1.15 : 500,
    hasBox ? burst_rating    / sfBurst    * 1.15 : 0,
    hasBox ? collapse_rating / sfCollapse * 1.15 : 0,
    500
  );
  if (hasBox) xR = Math.max(xR, bx_pos * 1.15, bx_neg * 1.15);
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
    // tooltip in display units (linear scale preserves the pixel→value mapping)
    xMax: QP_UNITS.toDisplay('force', 2 * xR), yMax: QP_UNITS.toDisplay('press', 2 * yR),
    xLabel: `Axial Load (${QP_UNITS.label('force')})`, yLabel: `Diff. Pressure (${QP_UNITS.label('press')})`,
    depthDown: false,
    xOffset: QP_UNITS.toDisplay('force', -xR), yOffset: QP_UNITS.toDisplay('press', -yR),
  });
  CI.drawFrozen(ctx, CID);

  // ── API design box ──────────────────────────────────────────────────────────
  if (hasBox) {
    const by   = burst_rating    > 0 ? burst_rating    / sfBurst    : 0;
    const cy_b = collapse_rating > 0 ? collapse_rating / sfCollapse : 0;
    const boxPts = [
      { x: -bx_neg, y:  by }, { x: bx_pos, y:  by },
      { x:  bx_pos, y: -cy_b }, { x: -bx_neg, y: -cy_b },
      { x: -bx_neg, y:  by },
    ];
    ctx.setLineDash([6, 3]);
    _cdLine(ctx, boxPts, '#d35fb7', 1.5, g);
    ctx.setLineDash([]);

    // DF labels on each side — matches WellPlan convention
    ctx.fillStyle = '#d35fb7'; ctx.font = '9px sans-serif';
    const xMidBox = (-bx_neg + bx_pos) / 2;
    const yMidBox = (by - cy_b) / 2;

    // Burst DF — just inside top edge
    if (by > 0) {
      const pt = _cdPt({ x: xMidBox, y: by }, g);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(`DF = ${sfBurst.toFixed(2)}`, pt.cx, pt.cy + 2);
    }
    // Collapse DF — just inside bottom edge
    if (cy_b > 0) {
      const pt = _cdPt({ x: xMidBox, y: -cy_b }, g);
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(`DF = ${sfCollapse.toFixed(2)}`, pt.cx, pt.cy - 2);
    }
    // Tension DF — just inside right edge (vertical midpoint)
    const rPt = _cdPt({ x: bx_pos, y: yMidBox }, g);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(`DF = ${sfTension.toFixed(2)}`, rPt.cx - 3, rPt.cy);
    // Compression DF — just inside left edge
    const lPt = _cdPt({ x: -bx_neg, y: yMidBox }, g);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`DF = ${sfCompression.toFixed(2)}`, lPt.cx + 3, lPt.cy);
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
    { x: F_topHang,  y: 0,       label: 'Initial',  color: '#2a7fa8' },
    { x: F_overpull, y: 0,       label: 'Overpull', color: '#e07a1a' },
    { x: F_fmd,      y: Δp_fmd,  label: 'FMD',      color: '#7a4aa0' },
  ];
  if (F_masp  !== null) loadPts.push({ x: F_masp,  y: Δp_masp,  label: 'MASP',   color: '#c0392b' });
  if (F_ptest !== null) loadPts.push({ x: F_ptest, y: Δp_ptest, label: 'P-Test', color: '#e0a020' });
  // Pre-compute canvas positions, then stagger overlapping labels above/below
  const cPts = loadPts.map(pt => ({ ...pt, ...(_cdPt(pt, g)), labelAbove: true }));
  for (let a = 0; a < cPts.length; a++) {
    for (let b = a + 1; b < cPts.length; b++) {
      if (Math.abs(cPts[a].cx - cPts[b].cx) < 80 && Math.abs(cPts[a].cy - cPts[b].cy) < 24) {
        cPts[a].labelAbove = true;
        cPts[b].labelAbove = false;
      }
    }
  }
  // Lines from Initial to each loaded state (drawn first, under dots)
  const initPt = _cdPt({ x: F_topHang, y: 0 }, g);
  cPts.forEach(pt => {
    if (pt.label === 'Initial') return;
    ctx.strokeStyle = pt.color; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(initPt.cx, initPt.cy); ctx.lineTo(pt.cx, pt.cy); ctx.stroke();
  });

  // Bending envelope bars (horizontal, ±F_bend from each nominal point)
  if (F_bend > 0.1) {
    cPts.forEach(pt => {
      const pL = _cdPt({ x: pt.x - F_bend, y: pt.y }, g);
      const pR = _cdPt({ x: pt.x + F_bend, y: pt.y }, g);
      ctx.strokeStyle = pt.color; ctx.lineWidth = 2.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(pL.cx, pL.cy); ctx.lineTo(pR.cx, pR.cy); ctx.stroke();
      ctx.setLineDash([]);
      // End tick marks
      ctx.lineWidth = 1.5;
      [pL, pR].forEach(p => {
        ctx.beginPath(); ctx.moveTo(p.cx, p.cy - 5); ctx.lineTo(p.cx, p.cy + 5); ctx.stroke();
      });
    });
  }

  // Dots and labels on top of lines
  cPts.forEach(pt => {
    ctx.fillStyle = pt.color;
    ctx.beginPath(); ctx.arc(pt.cx, pt.cy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = _qpColors().text; ctx.font = '10px sans-serif';
    const textW = ctx.measureText(pt.label).width;
    const goLeft = (pt.cx + 8 + textW) > (g.l + g.pw - 4);
    ctx.textAlign = goLeft ? 'right' : 'left';
    const lx = goLeft ? pt.cx - 8 : pt.cx + 8;
    ctx.textBaseline = pt.labelAbove ? 'bottom' : 'top';
    ctx.fillText(pt.label, lx, pt.cy + (pt.labelAbove ? -12 : 12));
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
  // Display helpers: force (klbf→kN), stress (psi → kpsi | MPa), dogleg
  const _dF = v => Math.round(QP_UNITS.toDisplay('force', v)).toLocaleString();
  const _uF = QP_UNITS.label('force');
  const _met = QP_UNITS.isMetric();
  const _dStress  = psi => _met ? (psi * 0.00689476).toFixed(0) : (psi / 1000).toFixed(0);
  const _dStress1 = psi => _met ? (psi * 0.00689476).toFixed(1) : (psi / 1000).toFixed(1);
  const _uStress  = _met ? 'MPa' : 'kpsi';
  const jointStr = (row.jointYield != null && +row.jointYield > 0 && +row.jointYield < bodyYield_klbf)
    ? `  ·  Joint Yield = ${_dF(+row.jointYield)} ${_uF}`
    : '';
  ctx.fillText(
    `σ_y = ${_dStress(σy)} ${_uStress}  ·  Body Yield = ${_dF(bodyYield_klbf)} ${_uF}${jointStr}  ·  ID = ${id_in.toFixed(3)}"`,
    g.l + g.pw / 2, g.t - 28
  );
  if (F_bend > 0.1) {
    ctx.fillText(
      `Bending: Max DLS = ${QP_UNITS.toDisplay('dls', DLS_max_deg).toFixed(2)} ${QP_UNITS.label('dls')}  ·  σ_b = ${_dStress1(σ_bend)} ${_uStress}  ·  ±${_dF(F_bend)} ${_uF} (dashed bars)`,
      g.l + g.pw / 2, g.t - 46
    );
  }

  // ── Legend ──────────────────────────────────────────────────────────────────
  const legendLabels = ['DF 1.0 (yield)', 'DF 1.1 (design)'];
  const legendColors = ['#e67e22', '#1a7a4a'];
  if (hasBox) { legendLabels.push('API box'); legendColors.push('#d35fb7'); }

  _legend(ctx, W, g.t, legendLabels, legendColors);
  CI.drawAnnotations(ctx, CID);
}
