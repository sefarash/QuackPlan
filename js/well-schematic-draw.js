// ===== WELL SCHEMATIC DRAW =====
// Draws the always-visible right-panel schematic as a concentric casing diagram.

function _mdToTVD(survey, md) {
  if (!survey || survey.length === 0) return md;
  if (md <= survey[0].md) return survey[0].tvd;
  for (let i = 1; i < survey.length; i++) {
    if (md <= survey[i].md) {
      const t = (md - survey[i - 1].md) / (survey[i].md - survey[i - 1].md);
      return survey[i - 1].tvd + t * (survey[i].tvd - survey[i - 1].tvd);
    }
  }
  return survey[survey.length - 1].tvd;
}

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

    // Label on right side of right wall — 3 lines anchored at shoe
    const sh0 = isOH ? 2 : Math.min(13, halfW * 0.55);
    const lx  = cx + halfW + sh0 + 5;
    const LH  = 11;  // line height px

    const botMD  = +(row.bot  || maxDepth);
    const tvdVal = Math.round(_mdToTVD(survey, botMD));
    const grade  = row.grade      || '';
    const wt     = row.nomWt_ppf  ? `${row.nomWt_ppf}ppf` : '';
    const line1  = grade || wt
      ? `${size}" ${grade}${wt ? ' ' + wt : ''}`.trim()
      : `${size}" ${row.def}`;
    const line2  = `TVD: ${tvdVal.toLocaleString()}ft`;
    const line3  = `MD: ${Math.round(botMD).toLocaleString()}ft`;

    // Clamp block so it stays within canvas
    const blockH = LH * 3;
    const lyBase = Math.max(PAD_T + 2, Math.min(H - PAD_B - blockH - 2, yBot - LH));

    ctx.fillStyle    = color;
    ctx.font         = 'bold 9px sans-serif';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(line1, lx, lyBase);
    ctx.font = '9px sans-serif';
    ctx.fillText(line2, lx, lyBase + LH);
    ctx.fillText(line3, lx, lyBase + LH * 2);
  });


  // ── RKB / GL / MSL datum lines ────────────────────────────────────────────
  _drawDatumLines(ctx, W, H, cx, PAD_T, PAD_B, scaleY, maxDepth);

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

function _drawDatumLines(ctx, W, H, cx, PAD_T, PAD_B, scaleY, maxDepth) {
  const datums = qpState.wellDatums;

  // Horizontal lines run from left edge to just left of the wellbore centre
  const X0   = 2;          // left start of datum lines
  const X1   = cx - 4;     // right end (just left of pipe)
  const LBL  = X0 + 1;     // label x
  const BRKT = X0 + 14;    // x of the vertical bracket between labels

  const yRKB = PAD_T;      // depth 0 = RKB

  // ── Always draw RKB marker ────────────────────────────────────────────────
  ctx.strokeStyle = '#1a5f7a'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(X0, yRKB); ctx.lineTo(X1, yRKB); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#1a5f7a'; ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('RKB', LBL, yRKB - 1);

  if (!datums) return;                     // no well selected — stop here

  const rkb = datums.rkb;                  // ft above ground
  const gl  = datums.gl;                   // ft above MSL

  const yGL  = PAD_T + Math.min(rkb,          maxDepth) * scaleY;
  const yMSL = PAD_T + Math.min(rkb + gl,     maxDepth) * scaleY;
  const yBot = H - PAD_B;

  // ── GL line ────────────────────────────────────────────────────────────────
  if (yGL > yRKB + 4 && yGL < yBot) {
    ctx.strokeStyle = '#2a7a2a'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(X0, yGL); ctx.lineTo(X1, yGL); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#2a7a2a'; ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('GL', LBL, yGL - 1);

    // Bracket between RKB and GL with distance label
    _drawBracket(ctx, BRKT, yRKB, yGL, `${rkb}'`, '#1a5f7a');
  }

  // ── MSL line ───────────────────────────────────────────────────────────────
  if (yMSL > yGL + 4 && yMSL < yBot) {
    ctx.strokeStyle = '#0055aa'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(X0, yMSL); ctx.lineTo(X1, yMSL); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#0055aa'; ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('MSL', LBL, yMSL - 1);

    // Bracket between GL and MSL with distance label
    if (yGL < yBot) _drawBracket(ctx, BRKT, yGL, yMSL, `${gl}'`, '#2a7a2a');
  }
}

function _drawBracket(ctx, x, y1, y2, label, color) {
  const MID = (y1 + y2) / 2;
  const TS  = 4;   // tick half-size

  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([]);
  // Vertical line
  ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
  // Top tick
  ctx.beginPath(); ctx.moveTo(x - TS, y1); ctx.lineTo(x + TS, y1); ctx.stroke();
  // Bottom tick
  ctx.beginPath(); ctx.moveTo(x - TS, y2); ctx.lineTo(x + TS, y2); ctx.stroke();

  // Distance label — draw to the right of the bracket
  ctx.fillStyle = color; ctx.font = '8px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + TS + 3, MID);
}

function _readSchematicRows() {
  const rows  = [];
  const tbody = document.getElementById('schematicBody');
  if (!tbody) return rows;
  for (const tr of tbody.rows) {
    const sel    = tr.querySelector('select');
    const inputs = tr.querySelectorAll('input[type=number]');
    const spec   = tr.dataset.casingSpec ? (() => { try { return JSON.parse(tr.dataset.casingSpec); } catch (_) { return null; } })() : null;
    rows.push({
      def:  sel?.value        || 'Open Hole',
      size: inputs[0]?.value  || 9.625,
      top:  inputs[1]?.value  || 0,
      bot:  inputs[2]?.value  || 5000,
      ...(spec ? {
        nomWt_ppf: spec.nomWt_ppf,
        grade:     spec.grade,
        id_in:     spec.id_in,
        collapse:  spec.collapse,
        burst:     spec.burst,
      } : {}),
    });
  }
  return rows;
}

// Auto-resize schematic canvas when window resizes
window.addEventListener('resize', () => {
  if (qpState.survey && qpState.survey.length > 1) drawSchematic(qpState.survey);
});
