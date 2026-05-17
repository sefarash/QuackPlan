// ===== HYDRAULICS UI =====
// drawHydSweep — SPP vs flow rate
// drawHydPie   — pressure breakdown donut

function drawHydSweep(h) {
  const CID = 'hydSweepCanvas';
  const c = _chartSetup(CID);
  if (!c) return;
  const { ctx, W, H } = c;

  if (!h?.sweep?.length) { _noData(ctx, W, H, 'Run Compute first'); return; }

  const xMax   = h.sweepXmax || Math.max(...h.sweep.map(s => s.q), 1);
  const maxSPP = Math.max(...h.sweep.map(s => s.spp), h.sppLimit || 3500) * 1.1;

  const g = _chartGrid(ctx, W, H, xMax, maxSPP, 'Flow Rate (gpm)', 'SPP (psi)');

  // SPP limit line
  const limitY = g.t + (1 - h.sppLimit / maxSPP) * g.ph;
  ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 1;
  ctx.setLineDash([6, 3]);
  ctx.beginPath(); ctx.moveTo(g.l, limitY); ctx.lineTo(g.l + g.pw, limitY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#c0392b'; ctx.font = '10px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('SPP limit', g.l + 4, limitY - 2);

  const sweepPts = h.sweep.map(s => ({ x: s.q, y: s.spp }));
  CI.storeLive(CID, [{ pts: sweepPts, color: '#1a5f7a', label: 'SPP' }]);
  CI.register(CID, { pad: g, xMax, yMax: maxSPP, xLabel: 'Flow Rate (gpm)', yLabel: 'SPP (psi)', depthDown: false });
  CI.drawFrozen(ctx, CID);

  // SPP curve
  _chartLine(ctx, sweepPts, '#1a5f7a', 2.5, g.l, g.t, g.pw, g.ph, xMax, maxSPP);

  // Operating point marker
  const opX = g.l + (h.flowRate / xMax) * g.pw;
  const opY = g.t + (1 - h.pumpPressure / maxSPP) * g.ph;
  ctx.fillStyle = '#f0a500';
  ctx.beginPath(); ctx.arc(opX, opY, 5, 0, Math.PI * 2); ctx.fill();
  const C = _qpColors();
  ctx.fillStyle = C.text; ctx.font = '10px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText(`${h.flowRate} gpm / ${h.pumpPressure} psi`, opX + 8, opY - 2);

  ctx.fillStyle = C.text; ctx.font = '11px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(`ECD at bit: ${h.ecdAtBit} ppg   HSI: ${h.hsi?.toFixed(2) ?? '—'}`, g.l, g.t + 4);

  CI.drawAnnotations(ctx, CID);
}

function drawHydPie(h) {
  const c = _chartSetup('hydPieCanvas');
  if (!c) return;
  const { ctx, W, H } = c;
  const C = _qpColors();

  if (!h?.pumpPressure) { _noData(ctx, W, H, '—'); return; }

  const slices = [
    { label: 'Annular', val: h.totalAnnLoss, color: '#2a7fa8' },
    { label: 'Pipe',    val: h.pipeLoss,     color: '#1a7a4a' },
    { label: 'Bit',     val: h.bitDrop,      color: '#f0a500' },
    { label: 'MWD/DS',  val: h.mwdDrop,      color: '#9ecce3' },
    { label: 'Surface', val: 50,             color: '#ddd'    },
  ].filter(s => s.val > 0);

  const total  = slices.reduce((s, x) => s + x.val, 0);
  const cx     = W / 2, cy = H * 0.42;
  const radius = Math.min(W, H) * 0.34;

  let angle = -Math.PI / 2;
  slices.forEach(sl => {
    const sweep = (sl.val / total) * Math.PI * 2;
    ctx.fillStyle = sl.color;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle, angle + sweep);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.bg; ctx.lineWidth = 2; ctx.stroke();

    // Label for slices > 10%
    if (sl.val / total > 0.08) {
      const mid  = angle + sweep / 2;
      const lx   = cx + radius * 0.68 * Math.cos(mid);
      const ly   = cy + radius * 0.68 * Math.sin(mid);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(Math.round(sl.val) + ' psi', lx, ly);
    }
    angle += sweep;
  });

  // Centre hole
  ctx.fillStyle = C.bg;
  ctx.beginPath(); ctx.arc(cx, cy, radius * 0.42, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.text; ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(h.pumpPressure + ' psi', cx, cy - 6);
  ctx.font = '9px sans-serif'; ctx.fillStyle = C.dim;
  ctx.fillText('Total SPP', cx, cy + 8);

  // Legend below
  let lx = 4, ly = H - 46;
  slices.forEach(sl => {
    ctx.fillStyle = sl.color;
    ctx.fillRect(lx, ly, 10, 10);
    ctx.fillStyle = C.text; ctx.font = '9px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(sl.label, lx + 13, ly);
    lx += Math.max(sl.label.length * 6 + 20, 52);
    if (lx > W - 60) { lx = 4; ly += 16; }
  });

  // Warnings
  if (h.warnings?.length) {
    ctx.fillStyle = '#c0392b'; ctx.font = '9px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    h.warnings.forEach((w, i) => ctx.fillText('⚠ ' + w, 4, H - 2 - i * 12));
  }
}
