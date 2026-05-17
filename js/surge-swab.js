// ===== SURGE / SWAB =====
// Clamp model: surge = pressure increase when running pipe in;
//              swab  = pressure decrease when pulling pipe out.
// Uses a simplified Burkhardt clamp model for a Bingham Plastic equivalent.

function _ssParams() {
  const survey = qpState.survey;
  if (!survey || survey.length < 2) return null;

  const fluid  = fluidGet();
  const bha    = bhaGet();
  const schRows = typeof _readSchematicRows === 'function' ? _readSchematicRows() : [];

  const mw    = +(document.getElementById('hydMWslider')?.value || fluid.mudWeight || 10);
  const pv    = fluid.pv  || 16;
  const yp    = fluid.yp  || 13;
  const dpOD  = bha.topDpOD_in ?? 5.0;
  const dpID  = bha.topDpID_in ?? 4.276;

  // Determine annular geometry at each station — use largest casing ID or open-hole OD
  // Fall back to a single open-hole segment if no schematic rows
  let segments = [];
  if (schRows.length) {
    for (const row of schRows) {
      const casingID = row.id_in ? +row.id_in : (+row.size * 0.88); // rough estimate if no spec
      const mdTop    = +row.top || 0;
      const mdBot    = +row.bot || survey[survey.length - 1].md;
      segments.push({ mdTop, mdBot, dh: casingID });
    }
  } else {
    segments.push({ mdTop: 0, mdBot: survey[survey.length - 1].md, dh: 8.5 });
  }

  return { survey, mw, pv, yp, dpOD, dpID, segments };
}

// Burkhardt clamp-model: delta_P (psi) for one segment
// v_pipe = trip speed (ft/min) → ft/s = v/60
// dh = hole/casing ID (in), dp = pipe OD (in), L = length (ft)
function _ssSegment(v_ftmin, dh, dpOD, mw, pv, yp, L) {
  if (L <= 0 || dh <= dpOD) return 0;
  const dh_ft  = dh  / 12;
  const dp_ft  = dpOD / 12;
  const ann_ft = (dh_ft - dp_ft) / 2;  // annular gap half-width (ft)

  // Annular velocity for closed-end pipe (clamp model factor ≈ 0.45)
  const v_ann = (v_ftmin / 60) * (dpOD * dpOD) / (dh * dh - dpOD * dpOD) * 0.45; // ft/s

  // Bingham equivalent: effective viscosity in annulus
  const mu_eff_cp = pv + yp * (ann_ft * 2 * 12) / (144 * Math.max(v_ann, 0.01));
  const mu_eff_pa_s = mu_eff_cp / 1000;

  // Pressure gradient (psi/ft) — laminar annular flow approximation
  const dP_psi_per_ft = (mu_eff_cp * v_ann * 144) / (1000 * (dh - dpOD) * (dh - dpOD));

  return Math.max(dP_psi_per_ft * L, 0);
}

function _computeSurgeSwab(speedFtMin) {
  const p = _ssParams();
  if (!p) return null;

  const { survey, mw, pv, yp, dpOD, dpID, segments } = p;
  const totalMD = survey[survey.length - 1].md;

  let surgePsi = 0, swabPsi = 0;
  for (const seg of segments) {
    const L = Math.min(seg.mdBot, totalMD) - Math.max(seg.mdTop, 0);
    if (L <= 0) continue;
    const dp = _ssSegment(speedFtMin, seg.dh, dpOD, mw, pv, yp, L);
    surgePsi += dp;
    swabPsi  += dp; // symmetric for clamp model
  }

  const bitTVD = survey[survey.length - 1].tvd;
  const emdSurge = mw + surgePsi / (0.052 * (bitTVD || 1));
  const emdSwab  = mw - swabPsi  / (0.052 * (bitTVD || 1));

  return { surgePsi: Math.round(surgePsi), swabPsi: Math.round(swabPsi),
           emdSurge: +emdSurge.toFixed(2), emdSwab: +emdSwab.toFixed(2) };
}

function drawSurgeSwab() {
  const CID = 'surgeSwabCanvas';
  const c = _chartSetup(CID);
  if (!c) return;
  const { ctx, W, H } = c;
  const C = _qpColors();

  const speedMax = +(document.getElementById('ssSpeedSlider')?.max   || 200);
  const speedCur = +(document.getElementById('ssSpeedSlider')?.value || 60);

  const p = _ssParams();
  if (!p || !p.survey || p.survey.length < 2) {
    _noData(ctx, W, H, 'Run Compute first'); return;
  }

  // Build sweep: 10 points from 0 to speedMax
  const steps = 20;
  const surgePts = [], swabPts = [];
  for (let i = 0; i <= steps; i++) {
    const v = (i / steps) * speedMax;
    const r = _computeSurgeSwab(v);
    if (!r) continue;
    surgePts.push({ x: v, y: r.surgePsi });
    swabPts.push({ x: v, y: r.swabPsi });
  }

  const yMax = Math.max(...surgePts.map(p => p.y), ...swabPts.map(p => p.y), 200) * 1.15;
  const g = _chartGrid(ctx, W, H, speedMax, yMax, 'Trip Speed (ft/min)', 'Pressure (psi)');

  CI.storeLive(CID, [
    { pts: surgePts, color: '#c0392b', label: 'Surge' },
    { pts: swabPts,  color: '#1a5f7a', label: 'Swab'  },
  ]);
  CI.register(CID, { pad: g, xMax: speedMax, yMax, xLabel: 'Trip Speed (ft/min)', yLabel: 'Pressure (psi)', depthDown: false });
  CI.drawFrozen(ctx, CID);

  _chartLine(ctx, surgePts, '#c0392b', 2.5, g.l, g.t, g.pw, g.ph, speedMax, yMax);
  _chartLine(ctx, swabPts,  '#1a5f7a', 2.5, g.l, g.t, g.pw, g.ph, speedMax, yMax);

  // Operating point
  const cur = _computeSurgeSwab(speedCur);
  if (cur) {
    [[cur.surgePsi, '#c0392b'], [cur.swabPsi, '#1a5f7a']].forEach(([val, col]) => {
      const px = g.l + (speedCur / speedMax) * g.pw;
      const py = g.t + (1 - val / yMax) * g.ph;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
    });

    // Annotation box
    ctx.fillStyle = C.text; ctx.font = '11px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(
      `@ ${speedCur} ft/min  Surge: ${cur.surgePsi} psi (EMW ${cur.emdSurge} ppg)  Swab: ${cur.swabPsi} psi (EMW ${cur.emdSwab} ppg)`,
      g.l, g.t + 4
    );
  }

  // Legend
  _legend(ctx, W, g.t, ['Surge (+ΔP)', 'Swab (−ΔP)'], ['#c0392b', '#1a5f7a']);

  CI.drawAnnotations(ctx, CID);
}
