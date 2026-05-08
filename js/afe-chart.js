// ===== AFE CHART =====
// Days & Cost vs Depth — from activity plan

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

  const lumpSum = act.services.reduce((s, sv) => s + (sv.lumpSum || 0), 0);
  cumCost += lumpSum;

  const maxDepth = Math.max(...pts.map(p => p.depth), 1);
  const maxDays  = Math.max(...pts.map(p => p.days), 1);
  const maxCost  = Math.max(...pts.map(p => p.cost), 1);

  // Two-axis plot: days (left) and cost (right)
  const { t, b, l, r } = CHART_PAD;
  const rr   = 70;   // extra right margin for cost axis
  const pw   = W - l - rr;
  const ph   = H - t - b;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = '#e8f0f5'; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = t + ph * i / 5;
    ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(l + pw, y); ctx.stroke();
    // Days axis (left)
    ctx.fillStyle = '#2a7fa8'; ctx.font = '10px sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText((maxDays * (5 - i) / 5).toFixed(0), l - 5, y);
    // Cost axis (right)
    ctx.fillStyle = '#1a7a4a';
    ctx.textAlign = 'left';
    const costVal = maxCost * (5 - i) / 5;
    ctx.fillText('$' + (costVal >= 1e6 ? (costVal / 1e6).toFixed(1) + 'M'
                                        : (costVal / 1000).toFixed(0) + 'K'),
      l + pw + 4, y);
  }

  // X axis (depth)
  for (let i = 0; i <= 5; i++) {
    const x = l + pw * i / 5;
    ctx.strokeStyle = '#e8f0f5'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, t); ctx.lineTo(x, t + ph); ctx.stroke();
    ctx.fillStyle = '#5a7a8e'; ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText((maxDepth * i / 5).toFixed(0), x, t + ph + 6);
  }

  ctx.strokeStyle = '#9ecce3'; ctx.lineWidth = 1.5;
  ctx.strokeRect(l, t, pw, ph);

  // Axis labels
  ctx.fillStyle = '#2a7fa8'; ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.save(); ctx.translate(12, t + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('Cum. Days', 0, 0); ctx.restore();

  ctx.fillStyle = '#1a7a4a';
  ctx.save(); ctx.translate(W - 10, t + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('Cum. Cost ($)', 0, 0); ctx.restore();

  ctx.fillStyle = '#5a7a8e'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('Depth (ft)', l + pw / 2, H - 14);

  // Days line
  ctx.strokeStyle = '#2a7fa8'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = l + (p.depth / maxDepth) * pw;
    const y = t + (1 - p.days / maxDays) * ph;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Cost line
  ctx.strokeStyle = '#1a7a4a'; ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = l + (p.depth / maxDepth) * pw;
    const y = t + (1 - p.cost  / maxCost)  * ph;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Total summary
  ctx.fillStyle = '#1a2b38'; ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const totalCostFmt = cumCost >= 1e6
    ? '$' + (cumCost / 1e6).toFixed(2) + 'M'
    : '$' + Math.round(cumCost).toLocaleString();
  ctx.fillText(`Total: ${cumDays.toFixed(1)} days  |  ${totalCostFmt}`, l + 4, t + 4);

  _legend(ctx, W, t, ['Days', 'Cost'], ['#2a7fa8', '#1a7a4a']);
}
