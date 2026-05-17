// ===== AFE CHART =====
// Depth on left-Y (depth-down), Cum. Days on top-X, Cum. Cost on right-Y

function drawAFE() {
  const c = _chartSetup('afeCanvas');
  if (!c) return;
  const { ctx, W, H } = c;

  const act = activityGet();
  if (!act.activities?.length) { _noData(ctx, W, H, 'Add activities first'); return; }

  // Accumulate days and cost vs depth
  const pts = [{ depth: 0, days: 0, cost: 0 }];
  const dayRate = act.services.reduce((s, sv) => s + (sv.dayRate || 0), 0);
  let cumDays = 0, cumCost = 0;

  act.activities.forEach(a => {
    cumDays += a.days;
    cumCost += a.cost + a.days * dayRate;
    pts.push({ depth: a.depth || pts[pts.length - 1].depth, days: cumDays, cost: cumCost });
  });

  // Inject casing costs as cost steps at each casing shoe depth (length = shoe MD)
  (act.casingCosts || []).filter(c => c.total > 0 && c.length > 0).forEach(c => {
    const shoeDepth = +(c.length);
    const casCost   = +(c.total);
    pts.forEach(p => { if (p.depth >= shoeDepth) p.cost += casCost; });
    cumCost += casCost;
  });

  const lumpSum = act.services.reduce((s, sv) => s + (sv.lumpSum || 0), 0);
  cumCost += lumpSum;

  const maxDepth = Math.max(...pts.map(p => p.depth), 1);
  const maxDays  = Math.max(...pts.map(p => p.days), 1);
  const maxCost  = Math.max(...pts.map(p => p.cost), cumCost, 1);

  // Layout: Depth on left-Y (depth-down), Days on top-X, Cost on right-Y
  const { t, b, l, r } = CHART_PAD;
  const rt = 70;   // extra right margin for cost axis
  const pw = W - l - rt;
  const ph = H - t - b;

  ctx.clearRect(0, 0, W, H);
  const C = _qpColors();
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

  // Grid + axis labels
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = t + ph * i / 5;
    const x = l + pw * i / 5;

    ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(l + pw, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, t); ctx.lineTo(x, t + ph); ctx.stroke();

    // Left axis — Depth, 0 at top, maxDepth at bottom
    ctx.fillStyle = C.dim; ctx.font = '10px sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText((maxDepth * i / 5).toFixed(0), l - 5, y);

    // Top axis — Cum. Days, 0 at left, maxDays at right
    ctx.fillStyle = '#2a7fa8';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText((maxDays * i / 5).toFixed(1), x, t - 5);

    // Right axis — Cum. Cost, $0 at bottom, $maxCost at top
    ctx.fillStyle = '#1a7a4a';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const costVal = maxCost * (1 - i / 5);
    ctx.fillText('$' + (costVal >= 1e6 ? (costVal / 1e6).toFixed(1) + 'M'
                                        : (costVal / 1000).toFixed(0) + 'K'),
      l + pw + 4, y);
  }

  ctx.strokeStyle = C.border; ctx.lineWidth = 1.5;
  ctx.strokeRect(l, t, pw, ph);

  // Axis titles
  ctx.fillStyle = '#2a7fa8'; ctx.font = '11px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('Cum. Days', l + pw / 2, t - 20);

  ctx.fillStyle = C.dim;
  ctx.save(); ctx.translate(12, t + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillText('Depth (ft)', 0, 0); ctx.restore();

  ctx.fillStyle = '#1a7a4a';
  ctx.save(); ctx.translate(W - 10, t + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillText('Cum. Cost ($)', 0, 0); ctx.restore();

  // Days curve: x=days, y=depth (depth-down)
  ctx.strokeStyle = '#2a7fa8'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = l + (p.days  / maxDays)  * pw;
    const y = t + (p.depth / maxDepth) * ph;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Cost curve: x=cost (inverted — $0 at right, $maxCost at left), y=depth
  ctx.strokeStyle = '#1a7a4a'; ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = l + (1 - p.cost / maxCost) * pw;
    const y = t + (p.depth / maxDepth) * ph;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Activity phase labels — dot + name at each activity endpoint on the Days curve
  act.activities.forEach((a, i) => {
    if (!a.name) return;
    const pt = pts[i + 1];
    if (!pt) return;
    const x = l + (pt.days  / maxDays)  * pw;
    const y = t + (pt.depth / maxDepth) * ph;

    // Dot on the days curve
    ctx.fillStyle = '#2a7fa8';
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();

    // Label — flip side and above/below to reduce crowding
    const nearRight = x > l + pw * 0.6;
    ctx.fillStyle = C.text; ctx.font = '9px sans-serif';
    ctx.textAlign    = nearRight ? 'right' : 'left';
    ctx.textBaseline = i % 2 === 0 ? 'bottom' : 'top';
    ctx.fillText(a.name, nearRight ? x - 5 : x + 5, i % 2 === 0 ? y - 4 : y + 4);
  });

  // Phase callout lines — horizontal dashed lines at each casing shoe depth
  const schRows = _readSchematicRows().filter(r => r.def !== 'Open Hole' && +(r.bot || 0) > 0);
  schRows.sort((a, b) => +(a.bot) - +(b.bot));
  schRows.forEach(row => {
    const d = +(row.bot);
    if (d <= 0 || d > maxDepth) return;
    const y = t + (d / maxDepth) * ph;
    ctx.strokeStyle = '#b8976a'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(l + pw, y); ctx.stroke();
    ctx.setLineDash([]);
    // Triangle marker on left edge pointing right
    ctx.fillStyle = '#b8976a';
    ctx.beginPath(); ctx.moveTo(l, y - 5); ctx.lineTo(l, y + 5); ctx.lineTo(l + 8, y); ctx.closePath(); ctx.fill();
    // Label just above the dashed line
    ctx.fillStyle = '#7a5a2a'; ctx.font = '9px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${row.size}" ${row.def}`, l + 12, y - 2);
  });

  // Total summary
  ctx.fillStyle = C.text; ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const totalCostFmt = cumCost >= 1e6
    ? '$' + (cumCost / 1e6).toFixed(2) + 'M'
    : '$' + Math.round(cumCost).toLocaleString();
  ctx.fillText(`Total: ${cumDays.toFixed(1)} days  |  ${totalCostFmt}`, l + 4, t + 4);

  _legend(ctx, W, t, ['Days', 'Cost'], ['#2a7fa8', '#1a7a4a']);

  CI.register('afeCanvas', {
    pad: { l, t, pw, ph },
    xMax: maxDays, yMax: maxDepth,
    xLabel: 'Cum. Days', yLabel: 'Depth (ft)',
    depthDown: true,
  });
  CI.drawAnnotations(ctx, 'afeCanvas');
}
