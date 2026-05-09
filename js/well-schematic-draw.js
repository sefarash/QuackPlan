// ===== WELL SCHEMATIC DRAW =====
// Draws the always-visible right-panel schematic as a concentric casing diagram.

function drawSchematic(survey) {
  const canvas = document.getElementById('schematicCanvas');
  if (!canvas) return;

  const wrap = canvas.parentElement;
  canvas.width  = wrap.clientWidth  || 300;
  canvas.height = wrap.clientHeight || 600;

  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8fbfd';
  ctx.fillRect(0, 0, W, H);

  const lastSurvey = survey && survey[survey.length - 1];

  if (!lastSurvey || survey.length < 2) {
    ctx.fillStyle = '#9ecce3';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Add trajectory stations', W / 2, H / 2);
    return;
  }

  const schRows  = _readSchematicRows();
  const maxDepth = Math.max(lastSurvey.md, ...schRows.map(r => +(r.bot || 0)), 1);

  // ── Layout ─────────────────────────────────────────────────────────────────
  const PAD_T = 54, PAD_B = 24, PAD_L = 46, PAD_R = 8;
  const plotH  = H - PAD_T - PAD_B;
  const scaleY = plotH / maxDepth;

  // Wellbore axis centred at 35% of the plot width
  const cx = PAD_L + (W - PAD_L - PAD_R) * 0.35;

  // OD scale: largest casing OD fills 44% of plot width (full diameter)
  const maxOD   = Math.max(...schRows.map(r => +(r.size || 0)), 13.375, 0.1);
  const odScale = ((W - PAD_L - PAD_R) * 0.44) / maxOD;   // px per inch

  // ── Depth axis ─────────────────────────────────────────────────────────────
  ctx.strokeStyle = '#ccd8e0';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_L, PAD_T);
  ctx.lineTo(PAD_L, H - PAD_B);
  ctx.stroke();

  ctx.fillStyle    = '#5a7a8e';
  ctx.font         = '9px sans-serif';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 5; i++) {
    const tvd = maxDepth * i / 5;
    const y   = PAD_T + tvd * scaleY;
    ctx.beginPath();
    ctx.moveTo(PAD_L - 3, y); ctx.lineTo(PAD_L, y);
    ctx.stroke();
    ctx.fillText(Math.round(tvd) + "'", PAD_L - 5, y);
  }

  // ── Casing strings ─────────────────────────────────────────────────────────
  // Sorted largest → smallest so outer casings draw first (behind inner ones)
  const sorted = [...schRows].sort((a, b) => +(b.size || 0) - +(a.size || 0));

  const WALL = {
    'Conductor':           '#3a7aaa',
    'Surface Casing':      '#2a6a9a',
    'Intermediate Casing': '#1a5a8a',
    'Production Casing':   '#0a4a7a',
    'Liner':               '#1a5f7a',
    'Open Hole':           '#b8976a',
    'Tubing':              '#4aaa6a',
  };
  const FILL = {
    'Conductor':           'rgba(58,122,170,0.09)',
    'Surface Casing':      'rgba(42,106,154,0.09)',
    'Intermediate Casing': 'rgba(26,90,138,0.09)',
    'Production Casing':   'rgba(10,74,122,0.09)',
    'Liner':               'rgba(26,95,122,0.09)',
    'Open Hole':           'rgba(184,151,106,0.14)',
    'Tubing':              'rgba(74,170,106,0.14)',
  };

  sorted.forEach(row => {
    const size  = +(row.size || 9.625);
    const top   = +(row.top  || 0);
    const bot   = +(row.bot  || maxDepth);
    const halfW = (size / 2) * odScale;
    const yTop  = PAD_T + Math.max(0, top)       * scaleY;
    const yBot  = PAD_T + Math.min(maxDepth, bot) * scaleY;
    const color = WALL[row.def] || '#2a7fa8';
    const isOH  = row.def === 'Open Hole';

    // Interior fill
    ctx.fillStyle = FILL[row.def] || 'rgba(100,150,200,0.08)';
    ctx.fillRect(cx - halfW, yTop, halfW * 2, yBot - yTop);

    // Walls (skip open hole — its boundaries are implied by the innermost casing)
    if (!isOH) {
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2;
      ctx.beginPath(); ctx.moveTo(cx - halfW, yTop); ctx.lineTo(cx - halfW, yBot); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + halfW, yTop); ctx.lineTo(cx + halfW, yBot); ctx.stroke();
    }

    // Shoe triangles — point outward (not for Open Hole)
    if (!isOH) {
      const sh = Math.min(11, halfW * 0.55);
      ctx.fillStyle = color;
      // Left shoe
      ctx.beginPath();
      ctx.moveTo(cx - halfW,      yBot);
      ctx.lineTo(cx - halfW,      yBot - sh);
      ctx.lineTo(cx - halfW - sh, yBot);
      ctx.closePath(); ctx.fill();
      // Right shoe
      ctx.beginPath();
      ctx.moveTo(cx + halfW,      yBot);
      ctx.lineTo(cx + halfW,      yBot - sh);
      ctx.lineTo(cx + halfW + sh, yBot);
      ctx.closePath(); ctx.fill();

    }

    // Label on right side of right wall
    const sh0 = isOH ? 2 : Math.min(13, halfW * 0.55);
    const lx  = cx + halfW + sh0 + 5;
    const ly  = Math.max(PAD_T + 8, Math.min(H - PAD_B - 8, (yTop + yBot) / 2));
    ctx.fillStyle    = color;
    ctx.font         = '9px sans-serif';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${size}" ${row.def}`, lx, ly);
  });


  // ── RKB marker (triangle pointing up) ─────────────────────────────────────
  ctx.strokeStyle = '#1a5f7a';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 9, PAD_T);
  ctx.lineTo(cx + 9, PAD_T);
  ctx.lineTo(cx,     PAD_T - 14);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = 'rgba(26,95,122,0.18)';
  ctx.fill();

  ctx.fillStyle    = '#1a2b38';
  ctx.font         = 'bold 9px sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('RKB', cx + 12, PAD_T - 7);

  // ── TD marker ─────────────────────────────────────────────────────────────
  const tdY = Math.min(PAD_T + lastSurvey.md * scaleY, H - PAD_B - 4);
  ctx.fillStyle = '#c0392b';
  ctx.beginPath(); ctx.arc(cx, tdY, 4, 0, Math.PI * 2); ctx.fill();
  ctx.font         = 'bold 9px sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('TD', cx + 7, tdY);

  // ── Summary labels ─────────────────────────────────────────────────────────
  ctx.fillStyle    = '#5a7a8e';
  ctx.font         = '9px sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`MD: ${Math.round(lastSurvey.md).toLocaleString()} ft`, 4, 4);
  ctx.fillText(`TVD: ${Math.round(lastSurvey.tvd).toLocaleString()} ft`, 4, 15);
}

function _readSchematicRows() {
  const rows  = [];
  const tbody = document.getElementById('schematicBody');
  if (!tbody) return rows;
  for (const tr of tbody.rows) {
    const sel    = tr.querySelector('select');
    const inputs = tr.querySelectorAll('input[type=number]');
    rows.push({
      def:  sel?.value   || 'Open Hole',
      size: inputs[0]?.value || 9.625,
      top:  inputs[1]?.value || 0,
      bot:  inputs[2]?.value || 5000,
    });
  }
  return rows;
}

// Auto-resize schematic canvas when window resizes
window.addEventListener('resize', () => {
  if (qpState.survey && qpState.survey.length > 1) drawSchematic(qpState.survey);
});
