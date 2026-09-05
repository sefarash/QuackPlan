// ===== RHEOLOGY ENGINE — Bingham Plastic / Power Law / Herschel-Bulkley =====
// Field units throughout: ppg, gpm, psi, ft, inches, cP; stresses in lb/100ft².
//
// One rheology record feeds every consumer (Hydraulics, Surge/Swab, Compare,
// Report):
//   rheoParams(fluid)              → { model, tauY, K, n, pv, yp, kEq, mw } for the
//                                    SELECTED model, in Herschel-Bulkley form and
//                                    field units (τ₀ lb/100ft², K lb·sⁿ/100ft², n –)
//   rheoAnnularGrad(v̄, gap, rheo) → annular pressure gradient (psi/ft) at a mean
//                                    annular velocity v̄ (ft/s): exact HB slot
//                                    laminar solution → Bourgoyne annular Reynolds
//                                    number on the wall apparent viscosity →
//                                    API RP 13D transition band → Dodge–Metzner
//                                    turbulent friction factor
//   rheoFitBingham / rheoFitPowerLaw / rheoFitHB → model parameters from Fann
//                                    dial readings
//   computeRheology()              → unchanged contract for the hydraulics callers
//
// Stored fluid keys are unchanged (model, pv, yp, tauY, nHB, kHB — RULE #1).
// Power Law gets the NEW additive keys nPL / kPL (K in eq.cP like kHB) and falls
// back to the PV/YP dial-reading fit when they are absent, which is what every
// pre-existing scenario has.
//
// Reference checks: `npm run test:rheology` (pure Node, no server).

const RHEO_EQCP = 478.8;    // eq.cP (mPa·sⁿ) per lb·sⁿ/100ft²
const RHEO_FANN = 1.0665;   // lb/100ft² per Fann dial degree

// ── Fann dial-reading fits (θ in dial degrees; 600/300 rpm = 1022/511 s⁻¹) ──
function rheoFitBingham(t600, t300) {
  return { pv: Math.max(0, t600 - t300), yp: Math.max(0, 2 * t300 - t600) };
}
function rheoFitPowerLaw(t600, t300) {
  if (!(t600 > 0) || !(t300 > 0) || t600 <= t300) {
    return { n: 1, kEq: RHEO_EQCP * RHEO_FANN * Math.max(t600 || 0, 1) / 1022 };
  }
  const n = Math.min(1, Math.max(0.2, 3.32 * Math.log10(t600 / t300)));
  const K = RHEO_FANN * t600 / Math.pow(1022, n);          // lb·sⁿ/100ft²
  return { n, kEq: K * RHEO_EQCP };
}
// API RP 13D: τ₀ from the low-shear readings (2·θ3 − θ6), then n and K from the
// 600/300 readings with τ₀ removed. Without θ6/θ3 this reduces to Power Law.
function rheoFitHB(t600, t300, t6 = 0, t3 = 0) {
  const t0 = Math.max(0, Math.min(2 * t3 - t6, 0.9 * t300));
  const pl = rheoFitPowerLaw(t600 - t0, t300 - t0);
  return { tauY: RHEO_FANN * t0, n: pl.n, kEq: pl.kEq };
}

// ── Model resolution ──────────────────────────────────────────────────────────
function rheoParams(fluid = {}) {
  const model = fluid.model || 'HB';
  const pv = Math.max(+fluid.pv || 16, 0.1);
  const yp = Math.max(+fluid.yp || 0, 0);
  const mw = +fluid.mudWeight || 10;
  if (model === 'BP') {
    return { model, tauY: yp, K: pv / RHEO_EQCP, n: 1, pv, yp, kEq: pv, mw };
  }
  if (model === 'PL') {
    let n = +fluid.nPL, kEq = +fluid.kPL, derived = false;
    if (!(n > 0) || !(kEq > 0)) {
      const f = rheoFitPowerLaw(2 * pv + yp, pv + yp);       // θ600 = 2PV+YP, θ300 = PV+YP
      n = f.n; kEq = f.kEq; derived = true;
    }
    n = Math.min(1, Math.max(0.2, n));
    return { model, tauY: 0, K: kEq / RHEO_EQCP, n, pv, yp, kEq, derived, mw };
  }
  const n    = Math.min(1, Math.max(0.2, +fluid.nHB || 0.7));
  const tauY = Math.max(+fluid.tauY || 0, 0);
  const kEq  = Math.max(+fluid.kHB || 120, 1);
  return { model: 'HB', tauY, K: kEq / RHEO_EQCP, n, pv, yp, kEq, mw };
}

// Caption text for charts / report (yield stresses in the display unit).
function rheoLabel(r) {
  const ys = v => (typeof QP_UNITS !== 'undefined')
    ? `${(+QP_UNITS.toDisplay('yieldstress', v)).toFixed(1)} ${QP_UNITS.label('yieldstress')}`
    : `${v} lb/100ft²`;
  if (r.model === 'BP') return `Bingham PV ${r.pv} cP · YP ${ys(r.yp)}`;
  if (r.model === 'PL') return `Power law n ${r.n.toFixed(2)} · K ${Math.round(r.kEq)} eq.cP${r.derived ? ' (from PV/YP)' : ''}`;
  return `Herschel-Bulkley τ₀ ${ys(r.tauY)} · n ${r.n.toFixed(2)} · K ${Math.round(r.kEq)} eq.cP`;
}

// ── Laminar slot solution ─────────────────────────────────────────────────────
// Wall shear stress τw (lb/100ft²) of a Herschel-Bulkley fluid with mean velocity
// v̄ (ft/s) through the annulus treated as a slot of width (d2−d1)/2 (Bourgoyne's
// slot approximation, valid for d1/d2 > 0.3). Exact slot solution (central plug
// + sheared layers), solved for τw by bisection:
//   v̄ = a·(τw−τy)^(m+1) / (τw²·K^m) · [ τy/(m+1) + (τw−τy)/(m+2) ],  m = 1/n,
//   a = half slot width = (d2−d1)/48 ft.
// n = 1 gives Buckingham–Reiner, whose small-τy expansion is the familiar
// Bourgoyne Bingham form dp/dL = PV·v̄/(1000·gap²) + YP/(200·gap); τy = 0 gives
// the power-law annular result exactly (the seed below IS that solution).
function rheoSlotTauW(vbar, gap, tauY, K, n) {
  if (!(vbar > 0)) return tauY;
  const a = gap / 48, m = 1 / n;
  const vOf = tw => {
    const d = tw - tauY;
    if (d <= 0) return 0;
    return a * Math.pow(d, m + 1) / (tw * tw * Math.pow(K, m)) * (tauY / (m + 1) + d / (m + 2));
  };
  let lo = tauY;
  let hi = tauY + K * Math.pow(144 * vbar / gap * (2 * n + 1) / (3 * n), n) + 1e-6;
  for (let g = 0; g < 60 && vOf(hi) < vbar; g++) hi = tauY + (hi - tauY) * 2;
  for (let i = 0; i < 48; i++) {
    const mid = 0.5 * (lo + hi);
    if (vOf(mid) < vbar) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// ── Annular pressure gradient ─────────────────────────────────────────────────
// v̄ ft/s, gap = d2−d1 in; rheo from rheoParams() (needs tauY, K, n, mw).
// Returns { grad psi/ft, turb, re, tauW lb/100ft², muA cP }.
//   Laminar: dp/dL = τw/(300·gap)  (slot force balance).
//   Regime:  Bourgoyne annular Reynolds number Re = 757·ρ·v̄·gap/μa on the wall
//            apparent viscosity μa = τw/γw (for Bingham exactly his
//            μa = PV + 5·YP·gap/v̄). Laminar below Re1 = 3470−1370n, turbulent
//            above Re2 = 4270−1370n (API RP 13D), linear blend between, never
//            below laminar so the loss is monotonic in velocity.
//   Turbulent: Dodge–Metzner f = a/Re^b (n = 1 → Blasius 0.079/Re^0.25),
//            dp/dL = f·ρ·v̄²/(21.1·gap)  (Bourgoyne annular form, D_e = 0.816·gap).
function rheoAnnularGrad(vbar, gap, rheo) {
  if (!(vbar > 0) || !(gap > 0)) return { grad: 0, turb: false, re: 0, tauW: rheo.tauY || 0, muA: 0 };
  const tauY = rheo.tauY || 0, K = rheo.K, n = rheo.n, mw = rheo.mw || 10;
  const tw  = rheoSlotTauW(vbar, gap, tauY, K, n);
  const lam = tw / (300 * gap);
  const gw  = Math.pow(Math.max(tw - tauY, 1e-9) / K, 1 / n);   // wall shear rate, s⁻¹
  const muA = RHEO_EQCP * tw / Math.max(gw, 1e-9);              // apparent viscosity, cP
  const re  = 757 * mw * vbar * gap / muA;
  const re1 = 3470 - 1370 * n, re2 = 4270 - 1370 * n;
  let grad = lam, turb = false;
  if (re > re1) {
    const fa  = (Math.log10(n) + 3.93) / 50, fb = (1.75 - Math.log10(n)) / 7;
    const f   = fa / Math.pow(re, fb);
    const tur = f * mw * vbar * vbar / (21.1 * gap);
    const w   = Math.min(1, (re - re1) / (re2 - re1));
    grad = Math.max(lam, lam + w * (tur - lam));
    turb = grad > lam;
  }
  return { grad, turb, re, tauW: tw, muA };
}

// ── Pipe-bore apparent viscosity ─────────────────────────────────────────────
// For the drill-pipe bore friction loss (Newtonian Blasius form with an apparent
// viscosity, as Bourgoyne does for Bingham fluids with μa = PV + 6.66·YP·d/v̄).
// Generalised to the resolved model: wall shear rate γ = 96·v̄/d (v̄ ft/s, d in),
// leading-order pipe-flow wall stress τw = (4/3)·τ₀ + K·(γ·(3n+1)/(4n))ⁿ,
// μa = 478.8·τw/γ cP. For Bingham this is Bourgoyne's expression exactly.
function rheoPipeVisc(rheo, vbar, d) {
  if (!(vbar > 0) || !(d > 0)) return rheo.pv || 1;
  const g  = 96 * vbar / d;
  const n  = rheo.n || 1, K = rheo.K || 0, tauY = rheo.tauY || 0;
  const tw = (4 / 3) * tauY + K * Math.pow(g * (3 * n + 1) / (4 * n), n);
  return Math.max(RHEO_EQCP * tw / g, 1);
}

// ── Circulation helpers (legacy contract) ────────────────────────────────────

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

// ---- Master function ----
// model: 'HB' | 'BP' | 'PL'; params: the fluid record (pv, yp, tauY, nHB, kHB,
// nPL, kPL, mudWeight); geometry: { dh, dp (in), length (METRES — legacy), flowRate (gpm) }.
function computeRheology(model, params, geometry) {
  const { dh, dp, length, flowRate } = geometry;
  const length_ft = length * 3.28084;
  const v    = annularVelocity_fpm(flowRate, dh, dp);
  const gap  = dh - dp;
  const rheo = rheoParams({ ...params, model: model || params.model });
  if (gap <= 0 || v <= 0) {
    return { pressureLoss_psi: 0, effectiveViscosity_cP: rheo.pv, flowRegime: 'laminar',
             annularVelocity_fpm: v, reynolds: 0 };
  }
  const r = rheoAnnularGrad(v / 60, gap, rheo);
  return {
    pressureLoss_psi:      Math.max(0, r.grad * length_ft),
    effectiveViscosity_cP: r.muA,
    flowRegime:            r.turb ? 'turbulent' : 'laminar',
    annularVelocity_fpm:   v,
    reynolds:              r.re,
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
