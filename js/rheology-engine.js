// ===== RHEOLOGY ENGINE — BP / Power Law / Herschel-Bulkley =====
// All calculations in field units: ppg, gpm, psi, ft, inches, cP

// Annular velocity in ft/min
function annularVelocity_fpm(flowRate_gpm, dh_in, dp_in) {
  const area = dh_in * dh_in - dp_in * dp_in;
  if (area <= 0) return 0;
  return (flowRate_gpm * 24.51) / area;
}

// Critical velocity for Bingham Plastic (Bourgoyne equation), ft/min
function criticalVelocity_BP(pv, yp, mudWeight, dh, dp) {
  const gap = dh - dp;
  if (gap <= 0) return Infinity;
  const disc = pv * pv + 6.2 * yp * gap * gap;
  return 97 * ((pv + Math.sqrt(disc)) / (mudWeight * gap));
}

// ---- Bingham Plastic annular pressure loss (psi) ----
function _bp_annular(pv, yp, mudWeight, dh, dp, length_ft, flowRate_gpm) {
  const v    = annularVelocity_fpm(flowRate_gpm, dh, dp);
  const gap  = dh - dp;
  if (gap <= 0) return 0;
  const vc   = criticalVelocity_BP(pv, yp, mudWeight, dh, dp);

  let dPper100;
  if (v <= vc) {
    // Laminar
    dPper100 = (pv * v) / (300 * gap * gap) + yp / (200 * gap);
  } else {
    // Turbulent (API RP 13D simplified)
    const Re = 109 * mudWeight * v * gap / pv;
    const f  = 0.0791 / Math.pow(Re, 0.25);
    dPper100 = f * mudWeight * v * v / (21.1 * gap * 100);
  }
  return dPper100 * length_ft / 100;
}

// ---- Power Law annular pressure loss (psi) ----
function _pl_annular(n, K, mudWeight, dh, dp, length_ft, flowRate_gpm) {
  const v   = annularVelocity_fpm(flowRate_gpm, dh, dp);
  const gap = dh - dp;
  if (gap <= 0 || v <= 0) return 0;
  const shearRate = 144 * v / gap;
  const mu_e      = K * Math.pow(shearRate, n - 1);
  // Reynolds number check
  const Re = 109 * mudWeight * v * gap / mu_e;
  let dPper100;
  if (Re < 3470) {
    // Laminar
    dPper100 = (K * Math.pow(144 * v, n) * 144)
               / (300 * Math.pow(gap, n + 1))
               * Math.pow((2 + 1 / n) / 0.0208, n);
  } else {
    // Turbulent
    const f  = 0.0791 / Math.pow(Re, 0.25);
    dPper100 = f * mudWeight * v * v / (21.1 * gap * 100);
  }
  return dPper100 * length_ft / 100;
}

// ---- Herschel-Bulkley annular pressure loss (psi, simplified) ----
function _hb_annular(tauY, K, n, mudWeight, dh, dp, length_ft, flowRate_gpm) {
  const v   = annularVelocity_fpm(flowRate_gpm, dh, dp);
  const gap = dh - dp;
  if (gap <= 0 || v <= 0) return 0;
  // Approximate shear rate
  const gamma  = Math.max(144 * v / gap, 0.01);
  const tau    = tauY + K * Math.pow(gamma, n);
  const mu_e   = tau / gamma;
  const Re     = 109 * mudWeight * v * gap / mu_e;
  let dPper100;
  if (Re < 3470) {
    // Laminar: use effective viscosity in BP formula
    dPper100 = (mu_e * v) / (300 * gap * gap) + tauY / (200 * gap);
  } else {
    const f  = 0.0791 / Math.pow(Re, 0.25);
    dPper100 = f * mudWeight * v * v / (21.1 * gap * 100);
  }
  return dPper100 * length_ft / 100;
}

// ---- Master function ----
function computeRheology(model, params, geometry) {
  const { pv = 28, yp = 18, n = 0.65, K = 180, tauY = 8,
          nHB = 0.7, kHB = 120, mudWeight = 10.5 } = params;
  const { dh, dp, length, flowRate } = geometry;

  const length_ft = length * 3.28084;   // metres → feet
  const v         = annularVelocity_fpm(flowRate, dh, dp);

  let pressureLoss_psi = 0;
  let effectiveViscosity_cP = pv;
  let flowRegime = 'laminar';

  if (model === 'BP') {
    pressureLoss_psi    = _bp_annular(pv, yp, mudWeight, dh, dp, length_ft, flowRate);
    const vc            = criticalVelocity_BP(pv, yp, mudWeight, dh, dp);
    flowRegime          = v > vc ? 'turbulent' : 'laminar';
    effectiveViscosity_cP = pv + (yp * v) / 144;
  } else if (model === 'PL') {
    pressureLoss_psi    = _pl_annular(n, K, mudWeight, dh, dp, length_ft, flowRate);
    const gap           = Math.max(dh - dp, 0.01);
    effectiveViscosity_cP = K * Math.pow(144 * v / gap, n - 1);
    flowRegime          = 109 * mudWeight * v * gap / effectiveViscosity_cP > 3470
                          ? 'turbulent' : 'laminar';
  } else {
    pressureLoss_psi    = _hb_annular(tauY, kHB, nHB, mudWeight, dh, dp, length_ft, flowRate);  // kHB=K, nHB=n
    const gap           = Math.max(dh - dp, 0.01);
    const gamma         = Math.max(144 * v / gap, 0.01);
    effectiveViscosity_cP = (tauY + kHB * Math.pow(gamma, nHB)) / gamma;
    flowRegime          = 109 * mudWeight * v * gap / effectiveViscosity_cP > 3470
                          ? 'turbulent' : 'laminar';
  }

  return {
    pressureLoss_psi: Math.max(0, pressureLoss_psi),
    effectiveViscosity_cP,
    flowRegime,
    annularVelocity_fpm: v,
  };
}

// ── Active mud recipe tracking ─────────────────────────────────────────────────

let mlActiveFluidId = null;

function rheSetActiveRecipe(id) {
  mlActiveFluidId = id;
}

function rheoClearActiveRecipe() {
  mlActiveFluidId = null;
}
