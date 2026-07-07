// ===== TORQUE & DRAG ENGINE — Johancsik Soft-String Model =====

// DP geometry / weight lookup (key = nominal OD in inches)
const DP_WEIGHT_TABLE = {
  '5.0':   { ID_in: 4.276, lb_per_ft: 19.50 },
  '5.5':   { ID_in: 4.778, lb_per_ft: 21.90 },
  '6.625': { ID_in: 5.965, lb_per_ft: 25.20 },
};

const GRADE_YIELD_PSI = {
  'E-75':  75000, 'X-95':  95000,
  'G-105':105000, 'S-135':135000,
};

const _K = {
  D2R:  Math.PI / 180,
  E:    30e6,    // Young's modulus, psi (steel)
  PPG:  65.5,    // steel density, ppg
  MU_B: 0.3,     // default bit friction factor
};

function _dpLookup(od_in) {
  const key = Object.keys(DP_WEIGHT_TABLE)
    .find(k => Math.abs(parseFloat(k) - od_in) < 0.15) || '5.0';
  return DP_WEIGHT_TABLE[key];
}

// ----- element builder -----
// dpWtOverride: optional calibrated DP weight lb/ft (replaces table lookup for DP sections)
function _buildElements(survey, bha, casingDesign, BF, dpWtOverride) {
  const tdMD_ft = survey[survey.length - 1].md;   // md already in feet

  const rawComps = (bha && bha.components) ? bha.components : [];
  const bhaComps = rawComps.filter(c => c.type !== 'Drill Pipe').reverse();
  const bhaStack = [];
  let acc = 0;
  for (const c of bhaComps) {
    const len = c.lengthFt || 30;
    bhaStack.push({ from: acc, to: acc + len, c });
    acc += len;
  }

  const dpOD   = (bha && bha.topDpOD_in) || 5.0;
  const dpProps = _dpLookup(dpOD);
  const dpID   = (bha && bha.topDpID_in) || dpProps.ID_in;
  const dpWt   = dpWtOverride || dpProps.lb_per_ft;  // calibrated or table
  const bitOD  = (bha && bha.bitOD_in)   || 8.5;

  const shoes = ((casingDesign && casingDesign.strings) || []).map(s => ({
    depth_ft: (s.setDepthMD || 0),               // setDepthMD already in feet
    id_in:    s.id   || Math.max((s.od || 9.625) - 0.816, 1),
    od_in:    s.od   || 9.625,
  }));
  const deepestShoe_ft = shoes.reduce((mx, s) => Math.max(mx, s.depth_ft), 0);

  const elements = [];
  for (let i = 0; i < survey.length - 1; i++) {
    const s0 = survey[i], s1 = survey[i + 1];
    const md0 = s0.md, md1 = s1.md;                // md already in feet
    const dL  = md1 - md0;
    if (dL < 0.01) continue;

    const i0  = (s0.inc || 0) * _K.D2R,  i1  = (s1.inc || 0) * _K.D2R;
    const a0  = (s0.az  || s0.azimuth || 0) * _K.D2R;
    const a1  = (s1.az  || s1.azimuth || 0) * _K.D2R;
    const aAvg = (i0 + i1) / 2;
    const dA   = i1 - i0;
    // Wrap azimuth change to [-π, π] so wells crossing 0°/360° (due North)
    // don't produce a spurious ~2π jump in the azimuthal contact-force term.
    let dZ = a1 - a0;
    if (dZ >  Math.PI) dZ -= 2 * Math.PI;
    if (dZ < -Math.PI) dZ += 2 * Math.PI;
    const mdMid  = (md0 + md1) / 2;
    const tvdMid = ((s0.tvd || 0) + (s1.tvd || 0)) / 2;  // tvd already in feet

    const isCased = mdMid <= deepestShoe_ft;
    let holeID_in = bitOD;
    if (isCased) {
      let smallest = Infinity;
      for (const sh of shoes) {
        if (mdMid <= sh.depth_ft && sh.od_in < smallest) {
          smallest = sh.od_in; holeID_in = sh.id_in;
        }
      }
    }

    const dfb = tdMD_ft - mdMid;
    const bm  = bhaStack.find(b => dfb >= b.from && dfb < b.to);
    let pOD, pID, wt, yld, cName;
    if (bm) {
      const c = bm.c;
      pOD   = c.od  || 6.5;
      pID   = Math.max(c.id || 0.1, 0.1);
      wt    = c.lengthFt > 0 ? c.weightLbs / c.lengthFt : 50;
      yld   = GRADE_YIELD_PSI[c.grade] || 135000;
      cName = c.type || 'BHA';
    } else {
      pOD = dpOD; pID = dpID; wt = dpWt;  // calibrated DP weight
      yld = GRADE_YIELD_PSI['S-135'];
      cName = 'DP';
    }

    const A      = Math.PI / 4 * (pOD * pOD - pID * pID);
    const I      = Math.PI / 64 * (pOD ** 4 - pID ** 4);
    const J      = 2 * I;
    const rCl_in = Math.max((holeID_in - pOD) / 2, 0.1);

    elements.push({
      md0, md1, mdMid, dL, aAvg, dA, dZ, tvdMid, isCased,
      holeID_in, pOD, pID,
      r_ft:   pOD / 24,
      A, I, J, rCl_in,
      W_buoy: wt * BF * dL,
      W_bl:   wt * BF,
      yld, cName,
    });
  }

  return { elements, bitOD };
}

// ----- soft-string march: bottom → surface -----
function _march(elements, axialSign, hasTorque, T0, tau0, ffs) {
  const n  = elements.length;
  const st = new Array(n + 1);

  st[n] = {
    md: elements[n - 1].md1, tvd: elements[n - 1].tvdMid,
    axialLoad_lbf: T0, sideForce_lbf: 0, torque_ftlbs: tau0,
  };

  let T = T0, tau = tau0;
  for (let i = n - 1; i >= 0; i--) {
    const el = elements[i];
    const ff = el.isCased ? ffs.ffCased : ffs.ffOpen;

    const N = Math.sqrt(
      (T * el.dA + el.W_buoy * Math.sin(el.aAvg)) ** 2 +
      (T * Math.sin(el.aAvg) * el.dZ)             ** 2
    );

    T   += el.W_buoy * Math.cos(el.aAvg) + axialSign * ff * N;
    tau += hasTorque ? ff * N * el.r_ft : 0;

    st[i] = {
      md: el.md0, tvd: el.tvdMid,
      axialLoad_lbf: T, sideForce_lbf: N, torque_ftlbs: tau,
    };
  }

  return {
    ffCased: ffs.ffCased, ffOpen: ffs.ffOpen,
    stations: st,
    surfaceHookload_lbf: T,
    surfaceTorque_ftlbs: tau,
  };
}

// ----- Dawson-Paslay sinusoidal + Chen helical buckling -----
// Dawson-Paslay (1984):  F_sin = 2 * sqrt(EI * w_lbf/in * sin(α) / r)
// Chen-Cheung-Cheatham (1990): F_hel = 2√2 * sqrt(…) = √2 * F_sin
function _buckling(elements, rotOnStations) {
  const bkSt = [];
  let firstSin = null, firstHel = null, overall = 'OK';

  for (let i = 0; i < elements.length; i++) {
    const el  = elements[i];
    const T   = (rotOnStations[i] || {}).axialLoad_lbf || 0;
    const Fc  = Math.max(-T, 0);
    const sinA = Math.sin(el.aAvg);
    const w_in = el.W_bl / 12;   // buoyed weight, lbf/in

    // Inclined Dawson-Paslay sinusoidal limit — degenerates to 0 as α→0.
    const fSinIncl = (sinA > 1e-4 && el.rCl_in > 0)
      ? 2 * Math.sqrt(Math.max(_K.E * el.I * w_in * sinA / el.rCl_in, 0))
      : 0;
    // Vertical buckling floor (Wu/Paslay ~2.55·(EI·w²)^⅓): bending stiffness and
    // the string's own weight resist buckling even at α=0, so the limit never
    // truly reaches zero. Using max() keeps inclined behaviour unchanged (there
    // the inclined term dominates) while giving near-vertical sections a real,
    // nonzero threshold instead of a false 'OK'.
    const fSinVert = 2.55 * Math.cbrt(Math.max(_K.E * el.I * w_in * w_in, 0));
    const fSin = Math.max(fSinIncl, fSinVert);
    const fHel = Math.SQRT2 * fSin;   // ratio = √2 per Chen et al.

    const status =
      Fc < fSin ? 'OK'
      : Fc < fHel ? 'SINUSOIDAL'
                  : 'HELICAL';

    if (status !== 'OK'     && firstSin === null) firstSin = el.md0;
    if (status === 'HELICAL' && firstHel === null) firstHel = el.md0;
    if (status === 'HELICAL') overall = 'HELICAL';
    else if (status === 'SINUSOIDAL' && overall === 'OK') overall = 'SINUSOIDAL';

    bkSt.push({
      md: el.md0, tvd: el.tvdMid, axialLoad_lbf: T,
      fSin_lbf: fSin, fHel_lbf: fHel, status,
    });
  }

  return {
    stations: bkSt,
    firstSinDepth_ft: firstSin, firstHelDepth_ft: firstHel,
    overallStatus: overall,
  };
}

// ----- overpull: minimum (yield − tension) margin across all POOH elements -----
function _overpull(elements, poohMid, required) {
  let minMargin = Infinity, critEl = null, critSt = null;

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i], st = poohMid.stations[i];
    if (!st) continue;
    const yieldLoad = el.A * el.yld;
    const margin    = yieldLoad - st.axialLoad_lbf;
    if (margin < minMargin) { minMargin = margin; critEl = el; critSt = st; }
  }

  return {
    availableMargin_lbf: isFinite(minMargin) ? minMargin : 0,
    requiredMargin_lbf:  required,
    criticalComponent: critEl ? {
      name:              critEl.cName,
      md:                critEl.mdMid,
      tension_lbf:       critSt.axialLoad_lbf,
      yield_lbf:         critEl.A * critEl.yld,
      marginToYield_lbf: minMargin,
    } : null,
    pass: minMargin >= required,
  };
}

// ----- von Mises stress (back-reaming: pull-up tension + torque combined) -----
// Back-reaming is the worst realistic case carrying BOTH high axial tension
// (pulling up) and torque (rotating) at the same time; POOH and rot-on are
// mutually exclusive and never coexist. During tripping the pipe is mud-filled
// and the annulus holds the same mud (balanced column), so internal = external
// hydrostatic — the pressure state is isotropic −P, not the large spurious hoop
// term that assuming an empty pipe (P_int = 0) produced. Lamé stresses and the
// torsional shear are both evaluated at the outer wall (where shear peaks).
function _stress(elements, combinedSt, mud_ppg) {
  const stList = [];
  let maxRatio = 0, critDepth = 0;

  for (let i = 0; i < elements.length; i++) {
    const el  = elements[i];
    const cst = combinedSt[i];
    if (!cst) continue;

    const T_axial = cst.axialLoad_lbf;
    const tau_in  = cst.torque_ftlbs * 12;
    const rExt    = el.pOD / 2, rInt = el.pID / 2;
    const ro2 = rExt * rExt, ri2 = rInt * rInt, dr = ro2 - ri2;

    // Balanced mud column: internal = external hydrostatic
    const P     = mud_ppg * 0.052 * el.tvdMid;
    const P_int = P, P_ext = P;

    const sA  = T_axial / el.A;
    // Lamé hoop/radial at the OUTER wall (balanced mud → both reduce to −P)
    const sH  = dr > 0 ? (2 * P_int * ri2 - P_ext * (ro2 + ri2)) / dr : 0;
    const sR  = -P_ext;
    const tS  = el.J > 0 ? tau_in * rExt / el.J : 0;

    const sVM = Math.sqrt(
      0.5 * ((sA - sH) ** 2 + (sH - sR) ** 2 + (sR - sA) ** 2) + 3 * tS * tS
    );

    const ratio = sVM / el.yld;
    if (ratio > maxRatio) { maxRatio = ratio; critDepth = el.mdMid; }
    stList.push({ md: el.md0, vonMises_psi: sVM, yield_psi: el.yld, ratio });
  }

  return {
    stations: stList, maxRatio,
    criticalDepth_ft: critDepth,
    pass: maxRatio < 0.9,
  };
}

// ----- Mitchell-Miska lock-up walk (TD → surface in Rot-On mode) -----
// Factors: helical=4 in denominator, sinusoidal=8 in denominator (do NOT transpose)
function _tdLockupWalk(elements, rotOnStations, bucklingStations, wob_lbf, availablePush_lbf, ff_c, ff_o) {
  let requiredPush = wob_lbf;
  let lockupMd = null, lockupReason = null;

  for (let i = elements.length - 1; i >= 0; i--) {
    const el   = elements[i];
    const st   = rotOnStations[i];
    const bkSt = bucklingStations[i];
    if (!st || !bkSt || el.dL < 0.01) continue;

    const ff = el.isCased ? ff_c : ff_o;
    const Fc = Math.max(-st.axialLoad_lbf, 0);  // compressive load, positive

    // Mitchell-Miska amplifier: result in lbf/in, multiply by 12 → lbf/ft
    let amp_lbf_per_ft = 0;
    if (Fc > 0) {
      if (bkSt.status === 'HELICAL') {
        amp_lbf_per_ft = (el.rCl_in * Fc * Fc) / (4 * _K.E * el.I) * 12;
      } else if (bkSt.status === 'SINUSOIDAL') {
        amp_lbf_per_ft = (el.rCl_in * Fc * Fc) / (8 * _K.E * el.I) * 12;
      }
    }

    // Total side force for this element (baseline + amplification)
    const N_total = st.sideForce_lbf + amp_lbf_per_ft * el.dL;
    requiredPush += ff * N_total;

    if (requiredPush > availablePush_lbf) {
      lockupMd = st.md;
      lockupReason = `Required push ${(requiredPush / 1000).toFixed(0)} klbf > available ${(availablePush_lbf / 1000).toFixed(0)} klbf`;
      break;
    }
  }

  return {
    detected:               lockupMd !== null,
    lockupMd_ft:            lockupMd,
    requiredSurfacePush_lbf: requiredPush,
    availableSurfacePush_lbf: availablePush_lbf,
    reason:                 lockupReason,
  };
}

// ===== PUBLIC ENTRY POINT =====
function tdCompute(survey, bha, casingDesign, mudWeight_ppg, inputs) {
  if (!survey || survey.length < 2) return null;

  // --- Calibration inputs ---
  const blockWeight_lbf  = (+document.getElementById('tdBlockWeight')?.value || 50) * 1000;
  const dpWtCalib_ppf    = +(inputs.dpWt_ppf) || +document.getElementById('tdDpWeight')?.value
                         || (bha?.dpNomWt_ppf > 1 ? bha.dpNomWt_ppf : 0) || 19.5;

  // MW: linked to hydraulics or override?
  const overrideEl       = document.getElementById('tdMwOverride');
  const linkedMw         = mudWeight_ppg || 9.5;
  const mwLinked         = !overrideEl || overrideEl.dataset.linked !== 'false';
  const tdMudWeight_ppg  = mwLinked
    ? linkedMw
    : +document.getElementById('tdMudWeight')?.value || linkedMw;

  const mw   = tdMudWeight_ppg;
  const BF   = 1 - mw / _K.PPG;
  const ff_c = +(inputs.ffCased            || 0.20);
  const ff_o = +(inputs.ffOpen             || 0.30);
  const WOB  = (inputs.wob_klbs != null && inputs.wob_klbs !== '' ? +inputs.wob_klbs : 25) * 1000;
  const ovpReq = +(inputs.overpullMargin_lbf || 100000);

  const { elements, bitOD } = _buildElements(survey, bha, casingDesign, BF, dpWtCalib_ppf);
  if (!elements.length) return null;

  const tauBit = WOB * _K.MU_B * (bitOD / 24);

  const SWEEPS = {
    low:  { ffCased: Math.max(0.05, ff_c - 0.05), ffOpen: Math.max(0.05, ff_o - 0.05) },
    mid:  { ffCased: ff_c, ffOpen: ff_o },
    high: { ffCased: ff_c + 0.05, ffOpen: ff_o + 0.05 },
  };

  const MODES = {
    rih:      [-1, false,   0,      0      ],
    pooh:     [+1, false,   0,      0      ],
    rotOff:   [ 0, true,    0,      0      ],
    rotOn:    [ 0, true,   -WOB,    tauBit ],  // WellPlan rotary: no axial friction, torque only
    slideOn:  [-1, false,  -WOB,    0      ],  // sliding while drilling: axial friction, WOB at bit
    backream: [+1, true,    0,      tauBit ],  // rotate while pulling out: upward pull friction (like POOH) + torque
  };

  const modes = {};
  for (const [name, [axS, hasTq, T0, tau0]] of Object.entries(MODES)) {
    const ffSensitivity = {};
    for (const [lvl, ffs] of Object.entries(SWEEPS)) {
      ffSensitivity[lvl] = _march(elements, axS, hasTq, T0, tau0, ffs);
    }
    modes[name] = { ffSensitivity };
  }

  // Add block weight to all surface hookloads
  for (const modeData of Object.values(modes)) {
    for (const ffData of Object.values(modeData.ffSensitivity)) {
      ffData.surfaceHookload_lbf += blockWeight_lbf;
    }
  }

  const midPooh     = modes.pooh.ffSensitivity.mid;
  const midRotOn    = modes.rotOn.ffSensitivity.mid;
  const midBackream = modes.backream.ffSensitivity.mid;
  const buckling = _buckling(elements, midRotOn.stations);

  // Pipe yield capacity for available push limit
  let pipeYield_lbf = Infinity;
  for (const el of elements) {
    const y = el.A * el.yld;
    if (y < pipeYield_lbf) pipeYield_lbf = y;
  }
  if (!isFinite(pipeYield_lbf)) pipeYield_lbf = 1000000;
  const availablePush_lbf = Math.min(pipeYield_lbf, 1000000);  // cap at 1000 klbs rig limit

  const lockup = _tdLockupWalk(
    elements, midRotOn.stations, buckling.stations,
    WOB, availablePush_lbf, ff_c, ff_o
  );

  const overpullRaw = _overpull(elements, midPooh, ovpReq);
  const overpull = {
    ...overpullRaw,
    pass:   lockup.detected ? null : overpullRaw.pass,
    status: lockup.detected ? 'N/A — LOCK-UP' : (overpullRaw.pass ? 'PASS' : 'FAIL'),
  };

  return {
    modes,
    buckling,
    overpull,
    lockup,
    stress:   _stress(elements, midBackream.stations, mw),
    calibration: {
      blockWeight_lbf,
      dpWeight_ppf:          dpWtCalib_ppf,
      tdMudWeight_ppg:       mw,
      mwLinkedToHydraulics:  mwLinked,
    },
    inputs: {
      wob_klbs:           +(inputs.wob_klbs  || 25),
      surfaceRPM:         +(inputs.surfaceRPM || 120),
      ffCased: ff_c, ffOpen: ff_o,
      overpullMargin_lbf: ovpReq,
    },
    warnings: [],
  };
}

if (typeof module !== 'undefined') module.exports = { tdCompute };
