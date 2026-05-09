// ===== COMPUTE ENGINE =====
// Master orchestrator: reads all inputs → T&D + Hydraulics → stores results → triggers redraws

function qpCompute() {
  const survey = qpState.survey;
  if (!survey || survey.length < 2) {
    setStatus('No trajectory — add stations first'); return;
  }

  setStatus('Computing…');

  const fluid = fluidGet();
  const bha   = bhaGet();

  // ── Torque & Drag ────────────────────────────────────────────────────────────
  const torqWOB  = +(document.getElementById('torqWOB')?.value  || 15);
  const ffLo     = +(document.getElementById('torqFFlo')?.value || 0.20);
  const ffMid    = +(document.getElementById('torqFFmid')?.value|| 0.30);
  const ffHi     = +(document.getElementById('torqFFhi')?.value || 0.40);

  const tdResult = tdCompute(survey, bha, null, fluid.mudWeight, {
    ffCased: ffMid, ffOpen: ffMid,
    wob_klbs: torqWOB,
    overpullMargin_lbf: 100000,
  });
  qpState.tdResult = tdResult;

  // ── Hydraulics ───────────────────────────────────────────────────────────────
  const hydResult = _computeHyd(survey, fluid, bha);
  qpState.hydResult = hydResult;

  // ── Redraw active output panel ────────────────────────────────────────────────
  if (qpState.activeOutputTab) redrawOutputPanel(qpState.activeOutputTab);

  setStatus('Ready');
}

// ── Simplified hydraulics (field units, feet canonical) ──────────────────────
function _computeHyd(survey, fluid, bha) {
  const { model = 'HB', mudWeight = 10, pv = 16, yp = 13,
          tauY = 8, nHB = 0.7, kHB = 120, flowRate = 280,
          pumpEff = 90 } = fluid;

  // Override flow rate from hydraulics slider if active
  const activeFlow = +(document.getElementById('hydFlowSlider')?.value || flowRate);
  const activeMW   = +(document.getElementById('hydMWslider')?.value   || mudWeight);

  const dpOD       = bha.topDpOD_in   ?? 5.0;
  const dpID       = bha.topDpID_in   ?? 4.276;
  const tfa        = bha.tfa_in2      ?? 0.220;
  const mwdDrop    = bha.mwdDeltaP_psi ?? 1150;
  const totalMD_ft = survey[survey.length - 1].md;
  const bitTVD_ft  = survey[survey.length - 1].tvd;

  const rheolParams = { pv, yp, n: 0.65, K: 180, tauY, nHB, kHB,
                        mudWeight: activeMW };

  // Annular sections — use schematic rows if available, else 3-section fallback
  const schRows  = _readSchematicRows();
  const sections = [];
  let cumAnn     = 0;

  if (schRows.length) {
    const sorted = [...schRows].sort((a, b) => +(a.bot||0) - +(b.bot||0));
    let prevMD   = 0;
    sorted.forEach(row => {
      const dh     = +(row.size || 8.5);
      const bot    = +(row.bot  || totalMD_ft);
      const length = Math.max(0, bot - prevMD);
      if (length < 1) return;
      const r = computeRheology(model, rheolParams,
        { dh, dp: dpOD, length: length / 3.28084, flowRate: activeFlow });
      const tvdShoe = _tvdAt(survey, bot);
      const ecd = activeMW + (cumAnn + r.pressureLoss_psi) / (0.052 * (tvdShoe || 1));
      sections.push({ name: row.def, dh, annPressLoss: Math.round(r.pressureLoss_psi),
                      annVel_fpm: Math.round(r.annularVelocity_fpm),
                      ecdAtShoe: +ecd.toFixed(2), flowRegime: r.flowRegime });
      cumAnn += r.pressureLoss_psi;
      prevMD  = bot;
    });
  } else {
    // 3-section fallback
    const segs = [
      { name: 'Upper', dh: 13.375, mdBot: totalMD_ft * 0.4 },
      { name: 'Middle', dh: 9.625, mdBot: totalMD_ft * 0.75 },
      { name: 'Open Hole', dh: 8.5,   mdBot: totalMD_ft },
    ];
    let prev = 0;
    segs.forEach(seg => {
      const len = Math.max(0, seg.mdBot - prev);
      if (len < 1) return;
      const r = computeRheology(model, rheolParams,
        { dh: seg.dh, dp: dpOD, length: len / 3.28084, flowRate: activeFlow });
      const tvdShoe = _tvdAt(survey, seg.mdBot);
      const ecd = activeMW + (cumAnn + r.pressureLoss_psi) / (0.052 * (tvdShoe || 1));
      sections.push({ name: seg.name, dh: seg.dh,
                      annPressLoss: Math.round(r.pressureLoss_psi),
                      annVel_fpm: Math.round(r.annularVelocity_fpm),
                      ecdAtShoe: +ecd.toFixed(2), flowRegime: r.flowRegime });
      cumAnn += r.pressureLoss_psi;
      prev    = seg.mdBot;
    });
  }

  // Pipe loss (Fanning friction)
  const vPipe  = activeFlow / (2.448 * dpID * dpID);
  const rePipe = 928 * activeMW * vPipe * dpID / (pv || 1);
  const fPipe  = 0.0791 / Math.pow(Math.max(rePipe, 100), 0.25);
  const pipeLoss = fPipe * activeMW * vPipe * vPipe / (21.1 * dpID) * totalMD_ft / 100;

  // Bit pressure drop
  const nozzVel = tfa > 0 ? activeFlow / (3.117 * tfa) : 0;
  const bitDrop = activeMW * nozzVel * nozzVel / 1120;
  const hsi     = tfa > 0
    ? (bitDrop * activeFlow) / (1714 * Math.PI * (bha.bitOD_in/2 || 4.25) ** 2)
    : 0;

  const pumpPressure = Math.round(pipeLoss + bitDrop + cumAnn + 50 + mwdDrop);
  const pumpHP       = Math.round((pumpPressure * activeFlow) / (1714 * (pumpEff / 100)));
  const ecdAtBit     = +( activeMW + cumAnn / (0.052 * (bitTVD_ft || 1)) ).toFixed(2);

  // Build sweep (SPP vs flow rate) for chart — range = (flowMin−50) to (flowMax+50)
  const flowMin    = +(document.getElementById('hydFlowMin')?.value || 100);
  const flowMax    = +(document.getElementById('hydFlowMax')?.value || 600);
  const sweepLo    = Math.max(1, flowMin - 50);
  const sweepHi    = flowMax + 50;
  const nPts       = 14;
  const sweepRates = Array.from({ length: nPts }, (_, i) =>
    Math.round(sweepLo + (sweepHi - sweepLo) * i / (nPts - 1)));
  if (!sweepRates.includes(activeFlow)) { sweepRates.push(activeFlow); sweepRates.sort((a, b) => a - b); }
  const sweep      = sweepRates.map(q => {
    const vP  = q / (2.448 * dpID * dpID);
    const reP = 928 * activeMW * vP * dpID / (pv || 1);
    const fP  = 0.0791 / Math.pow(Math.max(reP, 100), 0.25);
    const pL  = fP * activeMW * vP * vP / (21.1 * dpID) * totalMD_ft / 100;
    const nV  = tfa > 0 ? q / (3.117 * tfa) : 0;
    const bD  = activeMW * nV * nV / 1120;
    let ann   = 0;
    sections.forEach(s => {
      const rh = computeRheology(model, rheolParams,
        { dh: s.dh, dp: dpOD, length: 100 / 3.28084, flowRate: q });
      ann += rh.pressureLoss_psi * (s.annPressLoss / Math.max(cumAnn, 1));
    });
    ann = cumAnn * (q / activeFlow) ** 1.75;  // simplified scaling
    return { q, spp: Math.round(pL + bD + ann + 50 + mwdDrop) };
  });

  const warnings = [];
  const sppLimit = fluid.rigSppLimit || 3500;
  if (pumpPressure > sppLimit) warnings.push(`SPP ${pumpPressure} psi exceeds rig limit ${sppLimit} psi`);
  if (ecdAtBit > 13.5)         warnings.push('ECD at bit may exceed fracture gradient');
  if (hsi < 1.0)               warnings.push('Bit HSI below 1.0 — poor hole cleaning');

  return {
    sections, sweep,
    totalAnnLoss: Math.round(cumAnn),
    pipeLoss:     Math.round(pipeLoss),
    bitDrop:      Math.round(bitDrop),
    mwdDrop:      Math.round(mwdDrop),
    pumpPressure, pumpHP, ecdAtBit, hsi,
    nozzVel:      Math.round(nozzVel),
    mudWeight:    activeMW,
    flowRate:     activeFlow,
    sppLimit,
    warnings,
  };
}

function _tvdAt(survey, md) {
  if (!survey || !survey.length) return md;
  let best = survey[0];
  for (const s of survey) {
    if (Math.abs(s.md - md) < Math.abs(best.md - md)) best = s;
  }
  return best.tvd;
}

function setStatus(msg) {
  const el = document.getElementById('footerStatus');
  if (el) el.textContent = msg;
}
