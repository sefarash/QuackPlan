// ===== CASING DESIGN =====
// Burst (gas-to-surface) and Collapse (evacuated string) design envelopes

const GAS_GRAD = 0.1; // psi/ft — light gas gradient assumption

function drawCasingDesign() {
  const sfBurst    = +(document.getElementById('cdSFBurst')?.value    || 1.10);
  const sfCollapse = +(document.getElementById('cdSFCollapse')?.value || 1.00);

  const survey  = qpState.survey || [];
  const allRows = _readSchematicRows();
  const ppfgPts = _readPPFG();
  const fluid   = fluidGet();
  const mw      = fluid.mudWeight || 10;
  const maxTVD  = survey.length ? survey[survey.length - 1].tvd : 10000;

  const casingRows = allRows
    .filter(r => r.def !== 'Open Hole' && +(r.bot || 0) > 0)
    .sort((a, b) => +(a.bot) - +(b.bot));

  // Read ratings first so re-render can restore them
  const ratings = _readCDRatings();

  // MASP = max surface pressure from any shoe's FG
  const maxMasp = casingRows.reduce((mx, row) => {
    const shoeTVD = _tvdAt(survey, +(row.bot));
    const fg      = _ppfgInterp(ppfgPts, shoeTVD, 'fg');
    return Math.max(mx, Math.max(0, (fg - mw) * 0.052 * shoeTVD));
  }, 0);

  _renderCDRatingsTable(casingRows, survey, ratings, sfBurst, sfCollapse);
  _drawBurstChart(casingRows, survey, maxTVD, mw, maxMasp, ratings, sfBurst);
  _drawCollapseChart(casingRows, survey, maxTVD, mw, ratings, sfCollapse);
}

// ── Ratings table ─────────────────────────────────────────────────────────────

function _cdKey(row) { return `${row.size}_${row.bot}`; }

function _readCDRatings() {
  const tbody = document.getElementById('cdRatingsBody');
  if (!tbody) return {};
  const out = {};
  for (const tr of tbody.rows) {
    const key    = tr.dataset.key;
    const inputs = tr.querySelectorAll('input[type=number]');
    if (key) out[key] = { burst: +(inputs[0]?.value || 0), collapse: +(inputs[1]?.value || 0) };
  }
  return out;
}

function _renderCDRatingsTable(casingRows, survey, ratings, sfBurst, sfCollapse) {
  const div = document.getElementById('cdRatingsDiv');
  if (!div) return;

  if (!casingRows.length) {
    div.innerHTML = '<p style="color:#9ecce3;padding:8px 0">Add casing strings in Well Schematic</p>';
    return;
  }

  const rows = casingRows.map(row => {
    const key   = _cdKey(row);
    const r     = ratings[key] || {};
    const bLim  = r.burst    ? Math.round(r.burst    / sfBurst)    : '—';
    const cLim  = r.collapse ? Math.round(r.collapse / sfCollapse) : '—';
    const shoeTVD = Math.round(_tvdAt(survey, +(row.bot)));
    return `<tr data-key="${key}">
      <td>${row.size}" ${row.def}</td>
      <td style="text-align:right">${shoeTVD.toLocaleString()}</td>
      <td><input type="number" step="100" value="${r.burst    || ''}" placeholder="e.g. 5000"
          style="width:78px" onchange="drawCasingDesign()"></td>
      <td><input type="number" step="100" value="${r.collapse || ''}" placeholder="e.g. 3000"
          style="width:78px" onchange="drawCasingDesign()"></td>
      <td style="text-align:right;color:#1a7a4a;font-weight:bold">${bLim}</td>
      <td style="text-align:right;color:#7a4aa0;font-weight:bold">${cLim}</td>
    </tr>`;
  }).join('');

  div.innerHTML = `
    <div class="section-label" style="margin-bottom:6px">Casing Ratings</div>
    <table class="qp-table" style="width:100%;font-size:11px">
      <thead><tr>
        <th>Section</th>
        <th style="text-align:right">Shoe TVD (ft)</th>
        <th>Burst Rating (psi)</th>
        <th>Collapse Rating (psi)</th>
        <th style="text-align:right">Burst Limit (psi)</th>
        <th style="text-align:right">Collapse Limit (psi)</th>
      </tr></thead>
      <tbody id="cdRatingsBody">${rows}</tbody>
    </table>
    <p style="margin-top:6px;font-size:10px;color:#9ecce3">
      Burst load: gas-to-surface (MASP + ${GAS_GRAD} psi/ft gas − MW hydrostatic)
      &nbsp;|&nbsp; Collapse load: evacuated string (full MW hydrostatic external)
    </p>`;
}

// ── Burst chart ───────────────────────────────────────────────────────────────

function _drawBurstChart(casingRows, survey, maxTVD, mw, maxMasp, ratings, sfBurst) {
  const c = _chartSetup('cdBurstCanvas');
  if (!c) return;
  const { ctx, W, H } = c;

  if (!casingRows.length) { _noData(ctx, W, H, 'Add casing in Well Schematic'); return; }

  // Sample burst load at 200 points
  const N = 200;
  const loadPts = Array.from({ length: N + 1 }, (_, i) => {
    const d = maxTVD * i / N;
    return { tvd: d, psi: Math.max(0, maxMasp + GAS_GRAD * d - mw * 0.052 * d) };
  });

  const hasRatings = casingRows.some(r => (ratings[_cdKey(r)]?.burst || 0) > 0);
  const limitMax   = hasRatings
    ? Math.max(...casingRows.map(r => (ratings[_cdKey(r)]?.burst || 0) / sfBurst))
    : 0;
  const maxPsi = Math.max(500, ...loadPts.map(p => p.psi), limitMax) * 1.10;

  const g  = _chartGridDepthDown(ctx, W, H, maxPsi, maxTVD || 1, 'Burst Pressure (psi)', 'TVD (ft)');
  const px = v => g.l + (v / maxPsi) * g.pw;
  const py = d => g.t + (d / (maxTVD || 1)) * g.ph;

  CI.storeLive('cdBurstCanvas', [
    { pts: loadPts.map(p => ({ x: p.psi, y: p.tvd })), color: '#c0392b', label: 'Burst Load' },
  ]);
  CI.register('cdBurstCanvas', {
    pad: g, xMax: maxPsi, yMax: maxTVD || 1,
    xLabel: 'Burst Pressure (psi)', yLabel: 'TVD (ft)', depthDown: true,
  });
  CI.drawFrozen(ctx, 'cdBurstCanvas');

  // Burst load curve (red)
  ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  loadPts.forEach((p, i) => i === 0 ? ctx.moveTo(px(p.psi), py(p.tvd)) : ctx.lineTo(px(p.psi), py(p.tvd)));
  ctx.stroke();

  // Design limit step function (green)
  ctx.strokeStyle = '#1a7a4a'; ctx.lineWidth = 2;
  casingRows.forEach((row, i) => {
    const shoeTVD = _tvdAt(survey, +(row.bot));
    const topTVD  = i === 0 ? 0 : _tvdAt(survey, +(casingRows[i - 1].bot));
    const rating  = ratings[_cdKey(row)]?.burst || 0;
    if (!rating) return;
    const limit = rating / sfBurst;
    // Vertical bar for this section
    ctx.beginPath();
    ctx.moveTo(px(limit), py(topTVD));
    ctx.lineTo(px(limit), py(shoeTVD));
    ctx.stroke();
    // Horizontal connector to next section
    if (i < casingRows.length - 1) {
      const nextRating = ratings[_cdKey(casingRows[i + 1])]?.burst || 0;
      if (nextRating) {
        ctx.beginPath();
        ctx.moveTo(px(limit), py(shoeTVD));
        ctx.lineTo(px(nextRating / sfBurst), py(shoeTVD));
        ctx.stroke();
      }
    }
  });

  // Failure markers
  casingRows.forEach(row => {
    const shoeTVD = _tvdAt(survey, +(row.bot));
    const rating  = ratings[_cdKey(row)]?.burst || 0;
    if (!rating) return;
    const limit      = rating / sfBurst;
    const loadAtShoe = Math.max(0, maxMasp + GAS_GRAD * shoeTVD - mw * 0.052 * shoeTVD);
    if (loadAtShoe > limit) {
      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.arc(px(loadAtShoe), py(shoeTVD), 5, 0, Math.PI * 2); ctx.fill();
    }
  });

  _legend(ctx, W, g.t, ['Burst Load', 'Design Limit'], ['#c0392b', '#1a7a4a']);
  CI.drawAnnotations(ctx, 'cdBurstCanvas');
}

// ── Collapse chart ────────────────────────────────────────────────────────────

function _drawCollapseChart(casingRows, survey, maxTVD, mw, ratings, sfCollapse) {
  const c = _chartSetup('cdCollapseCanvas');
  if (!c) return;
  const { ctx, W, H } = c;

  if (!casingRows.length) { _noData(ctx, W, H, 'Add casing in Well Schematic'); return; }

  // Collapse load: evacuated string — external = MW × 0.052 × D, internal = 0
  const N = 200;
  const loadPts = Array.from({ length: N + 1 }, (_, i) => {
    const d = maxTVD * i / N;
    return { tvd: d, psi: mw * 0.052 * d };
  });

  const hasRatings = casingRows.some(r => (ratings[_cdKey(r)]?.collapse || 0) > 0);
  const limitMax   = hasRatings
    ? Math.max(...casingRows.map(r => (ratings[_cdKey(r)]?.collapse || 0) / sfCollapse))
    : 0;
  const maxPsi = Math.max(500, ...loadPts.map(p => p.psi), limitMax) * 1.10;

  const g  = _chartGridDepthDown(ctx, W, H, maxPsi, maxTVD || 1, 'Collapse Pressure (psi)', 'TVD (ft)');
  const px = v => g.l + (v / maxPsi) * g.pw;
  const py = d => g.t + (d / (maxTVD || 1)) * g.ph;

  CI.storeLive('cdCollapseCanvas', [
    { pts: loadPts.map(p => ({ x: p.psi, y: p.tvd })), color: '#7a4aa0', label: 'Collapse Load' },
  ]);
  CI.register('cdCollapseCanvas', {
    pad: g, xMax: maxPsi, yMax: maxTVD || 1,
    xLabel: 'Collapse Pressure (psi)', yLabel: 'TVD (ft)', depthDown: true,
  });
  CI.drawFrozen(ctx, 'cdCollapseCanvas');

  // Collapse load curve (purple)
  ctx.strokeStyle = '#7a4aa0'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  loadPts.forEach((p, i) => i === 0 ? ctx.moveTo(px(p.psi), py(p.tvd)) : ctx.lineTo(px(p.psi), py(p.tvd)));
  ctx.stroke();

  // Design limit step function (blue)
  ctx.strokeStyle = '#2a7fa8'; ctx.lineWidth = 2;
  casingRows.forEach((row, i) => {
    const shoeTVD = _tvdAt(survey, +(row.bot));
    const topTVD  = i === 0 ? 0 : _tvdAt(survey, +(casingRows[i - 1].bot));
    const rating  = ratings[_cdKey(row)]?.collapse || 0;
    if (!rating) return;
    const limit = rating / sfCollapse;
    ctx.beginPath();
    ctx.moveTo(px(limit), py(topTVD));
    ctx.lineTo(px(limit), py(shoeTVD));
    ctx.stroke();
    if (i < casingRows.length - 1) {
      const nextRating = ratings[_cdKey(casingRows[i + 1])]?.collapse || 0;
      if (nextRating) {
        ctx.beginPath();
        ctx.moveTo(px(limit), py(shoeTVD));
        ctx.lineTo(px(nextRating / sfCollapse), py(shoeTVD));
        ctx.stroke();
      }
    }
  });

  // Failure markers
  casingRows.forEach(row => {
    const shoeTVD    = _tvdAt(survey, +(row.bot));
    const rating     = ratings[_cdKey(row)]?.collapse || 0;
    if (!rating) return;
    const limit      = rating / sfCollapse;
    const loadAtShoe = mw * 0.052 * shoeTVD;
    if (loadAtShoe > limit) {
      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.arc(px(loadAtShoe), py(shoeTVD), 5, 0, Math.PI * 2); ctx.fill();
    }
  });

  _legend(ctx, W, g.t, ['Collapse Load', 'Design Limit'], ['#7a4aa0', '#2a7fa8']);
  CI.drawAnnotations(ctx, 'cdCollapseCanvas');
}
