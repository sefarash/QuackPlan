// ===== WELL SCHEMATIC DRAW =====
// Draws the always-visible right-panel schematic from survey + schematic rows

function drawSchematic(survey) {
  const canvas = document.getElementById('schematicCanvas');
  if (!canvas) return;

  // Size canvas to its CSS container
  const wrap = canvas.parentElement;
  canvas.width  = wrap.clientWidth  || 300;
  canvas.height = wrap.clientHeight || 600;

  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8fbfd';
  ctx.fillRect(0, 0, W, H);

  if (!survey || survey.length < 2) {
    ctx.fillStyle = '#9ecce3';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Add trajectory stations', W / 2, H / 2);
    return;
  }

  const maxTVD = Math.max(...survey.map(s => s.tvd), 1);
  const maxDep = Math.max(...survey.map(s => Math.sqrt((s.north||0)**2 + (s.east||0)**2)), 1);

  // Layout constants
  const PAD_TOP = 30, PAD_BOT = 20, PAD_L = 50, PAD_R = 20;
  const plotH = H - PAD_TOP - PAD_BOT;
  const plotW = W - PAD_L - PAD_R;

  // Scale: TVD maps to Y, horizontal departure maps to X offset from centre
  const scaleY = plotH / maxTVD;
  // Keep departure scale proportional but cap so it fits
  const scaleX = Math.min(plotW * 0.4 / Math.max(maxDep, 1), scaleY);

  const cx = PAD_L + plotW * 0.35;   // wellhead X
  const cy = PAD_TOP;                 // surface Y

  function toScreen(tvd, dep) {
    return { x: cx + dep * scaleX, y: cy + tvd * scaleY };
  }

  // ── Depth axis ──────────────────────────────────────────────────────────────
  ctx.strokeStyle = '#ccc';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_L, PAD_TOP);
  ctx.lineTo(PAD_L, H - PAD_BOT);
  ctx.stroke();

  const nTicks = 5;
  ctx.fillStyle   = '#5a7a8e';
  ctx.font        = '10px sans-serif';
  ctx.textAlign   = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= nTicks; i++) {
    const tvd = maxTVD * i / nTicks;
    const y   = cy + tvd * scaleY;
    ctx.beginPath();
    ctx.moveTo(PAD_L - 4, y);
    ctx.lineTo(PAD_L, y);
    ctx.stroke();
    ctx.fillText(Math.round(tvd) + "'", PAD_L - 6, y);
  }

  // ── Casing strings from schematic table ────────────────────────────────────
  const schRows = _readSchematicRows();
  const CASING_COLORS = {
    'Conductor':           'rgba(100,160,200,0.25)',
    'Surface Casing':      'rgba(80,140,190,0.22)',
    'Intermediate Casing': 'rgba(60,120,170,0.18)',
    'Production Casing':   'rgba(40,100,150,0.15)',
    'Liner':               'rgba(30,80,130,0.12)',
    'Open Hole':           'rgba(210,180,140,0.3)',
    'Tubing':              'rgba(150,200,150,0.2)',
  };

  schRows.forEach(row => {
    const size   = +(row.size || 9.625);
    const top    = +(row.top  || 0);
    const bot    = +(row.bot  || maxTVD);
    const halfW  = Math.max(size * scaleX * 0.5, 4);
    const yTop   = cy + top * scaleY;
    const yBot   = cy + bot * scaleY;
    const color  = CASING_COLORS[row.def] || 'rgba(100,150,200,0.15)';

    ctx.fillStyle   = color;
    ctx.strokeStyle = '#1a5f7a';
    ctx.lineWidth   = 1.5;

    // Left wall
    ctx.beginPath();
    ctx.moveTo(cx - halfW, yTop);
    ctx.lineTo(cx - halfW, yBot);
    ctx.stroke();
    // Right wall
    ctx.beginPath();
    ctx.moveTo(cx + halfW, yTop);
    ctx.lineTo(cx + halfW, yBot);
    ctx.stroke();
    // Fill
    ctx.fillRect(cx - halfW, yTop, halfW * 2, yBot - yTop);

    // Shoe marker
    ctx.strokeStyle = '#1a5f7a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - halfW - 4, yBot);
    ctx.lineTo(cx - halfW,     yBot);
    ctx.lineTo(cx - halfW,     yBot - 6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + halfW + 4, yBot);
    ctx.lineTo(cx + halfW,     yBot);
    ctx.lineTo(cx + halfW,     yBot - 6);
    ctx.stroke();
  });

  // ── Trajectory path ─────────────────────────────────────────────────────────
  // Project onto TVD vs horizontal departure (north as primary)
  const path = survey.map(s => toScreen(s.tvd, s.north || 0));

  // Glow
  ctx.strokeStyle = 'rgba(26,95,122,0.2)';
  ctx.lineWidth   = 6;
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  path.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();

  // Main line
  ctx.strokeStyle = '#1a5f7a';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  path.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();

  // ── Surface marker (RKB) ────────────────────────────────────────────────────
  ctx.fillStyle   = '#1a5f7a';
  ctx.strokeStyle = '#1a5f7a';
  ctx.lineWidth   = 2;
  // Derrick symbol
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy);
  ctx.lineTo(cx,     cy - 14);
  ctx.lineTo(cx + 8, cy);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = 'rgba(26,95,122,0.15)';
  ctx.fill();

  ctx.fillStyle = '#1a2b38';
  ctx.font      = 'bold 10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('RKB', cx + 10, PAD_TOP - 10);

  // ── TD marker ───────────────────────────────────────────────────────────────
  const last = path[path.length - 1];
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle    = '#c0392b';
  ctx.font         = '10px sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('TD', last.x + 6, last.y);

  // ── Summary label ────────────────────────────────────────────────────────────
  const lastSurvey = survey[survey.length - 1];
  const dep = Math.sqrt((lastSurvey.north||0)**2 + (lastSurvey.east||0)**2);
  ctx.fillStyle = '#5a7a8e';
  ctx.font      = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`MD: ${Math.round(lastSurvey.md).toLocaleString()} ft`, 4, 4);
  ctx.fillText(`TVD: ${Math.round(lastSurvey.tvd).toLocaleString()} ft`, 4, 16);
}

function _readSchematicRows() {
  const rows = [];
  const tbody = document.getElementById('schematicBody');
  if (!tbody) return rows;
  for (const tr of tbody.rows) {
    const sel    = tr.querySelector('select');
    const inputs = tr.querySelectorAll('input[type=number]');
    rows.push({
      def:  sel?.value || 'Open Hole',
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
