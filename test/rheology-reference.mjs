// ===== RHEOLOGY ENGINE REFERENCE CHECK =====
// Loads js/rheology-engine.js in a sandbox and checks the shared annular-loss
// model (used by Hydraulics and Surge/Swab) against its closed-form limits and
// the Bourgoyne "Applied Drilling Engineering" forms, the Fann fits, and the
// per-model resolution in rheoParams(). Pure Node, no server:
//
//   npm run test:rheology

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sb = { console };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/rheology-engine.js'), 'utf8') +
  '\nthis.X = { rheoParams, rheoLabel, rheoAnnularGrad, rheoSlotTauW, computeRheology, rheoFitBingham, rheoFitPowerLaw, rheoFitHB, annularVelocity_fpm };',
  sb, { filename: 'rheology-engine.js' });
const { rheoParams, rheoLabel, rheoAnnularGrad, computeRheology, rheoFitBingham, rheoFitPowerLaw, rheoFitHB, annularVelocity_fpm } = sb.X;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
const near = (a, b, tol) => Math.abs(a / b - 1) <= tol;
const BP = (mw, pv, yp) => ({ mw, tauY: yp, K: pv / 478.8, n: 1 });

// ── Closed-form limits of rheoAnnularGrad ────────────────────────────────────
{
  console.log('\n▶ annular gradient limits (gap 3.5 in = 5in DP in 8.5in hole)');
  const gap = 3.5;
  // Newtonian laminar: μ·v̄/(1000·gap²)
  const gN = rheoAnnularGrad(1.0, gap, { mw: 10, tauY: 0, K: 50 / 478.8, n: 1 });
  check('Newtonian laminar = Bourgoyne μ·v̄/(1000·gap²) ±1%', near(gN.grad, 50 / (1000 * gap * gap), 0.01) && !gN.turb, `${gN.grad.toFixed(5)} psi/ft`);
  // Bingham laminar at high shear ≈ PV·v̄/(1000·gap²) + YP/(200·gap)
  const gB = rheoAnnularGrad(3.0, gap, BP(10, 40, 2));
  const eB = 40 * 3 / (1000 * gap * gap) + 2 / (200 * gap);
  check('Bingham laminar, high shear = Bourgoyne PV/YP form ±2%', near(gB.grad, eB, 0.02) && !gB.turb, `${gB.grad.toFixed(5)} vs ${eB.toFixed(5)} psi/ft`);
  // Bingham at low shear: exact Buckingham–Reiner sits below the leading-order form
  const gL = rheoAnnularGrad(0.3, gap, BP(10, 30, 5));
  const eL = 30 * 0.3 / (1000 * gap * gap) + 5 / (200 * gap);
  check('Bingham laminar, low shear is 75–100% of the Bourgoyne form', gL.grad <= eL * 1.001 && gL.grad >= 0.75 * eL, `${gL.grad.toFixed(5)} vs ${eL.toFixed(5)} psi/ft`);
  // Power law, τy = 0: closed-form slot result
  const n = 0.6, K = 0.5;
  const gw = 144 * 1.0 / gap * (2 * n + 1) / (3 * n);
  const eP = K * Math.pow(gw, n) / (300 * gap);
  const gP = rheoAnnularGrad(1.0, gap, { mw: 10, tauY: 0, K, n });
  check('Power-law laminar = closed-form slot result ±0.1%', near(gP.grad, eP, 0.001), `${gP.grad.toFixed(5)} psi/ft`);
  // Newtonian turbulent: Bourgoyne eq. 4.66b  f = 0.0791/Re^0.25, Re = 757ρv̄gap/μ, dp/dL = fρv̄²/(21.1·gap)
  const mu = 5, v = 8, rho = 10;
  const re = 757 * rho * v * gap / mu, f = 0.0791 / Math.pow(re, 0.25);
  const eT = f * rho * v * v / (21.1 * gap);
  const gT = rheoAnnularGrad(v, gap, { mw: rho, tauY: 0, K: mu / 478.8, n: 1 });
  check('Newtonian turbulent = Bourgoyne Blasius form ±2%', near(gT.grad, eT, 0.02) && gT.turb, `${gT.grad.toFixed(4)} vs ${eT.toFixed(4)} psi/ft, Re ${re.toFixed(0)}`);
  // Monotonic in velocity through the transition (narrow annulus)
  let prev = 0, mono = true, onset = null;
  for (let vv = 0.1; vv <= 15; vv += 0.1) {
    const r = rheoAnnularGrad(vv, 2.0, BP(10, 20, 12));
    if (r.grad < prev - 1e-12) mono = false;
    if (r.turb && onset == null) onset = vv;
    prev = r.grad;
  }
  check('gradient non-decreasing with velocity through the transition (gap 2 in)', mono, `turbulent from ${onset?.toFixed(1)} ft/s`);
}

// ── rheoParams: per-model resolution ─────────────────────────────────────────
{
  console.log('\n▶ rheoParams');
  const bp = rheoParams({ model: 'BP', pv: 16, yp: 13, tauY: 8, nHB: 0.7, kHB: 120, mudWeight: 10 });
  check('BP → τ₀ = YP, K = PV/478.8, n = 1 (HB fields ignored)', bp.tauY === 13 && near(bp.K, 16 / 478.8, 1e-9) && bp.n === 1);
  const hb = rheoParams({ model: 'HB', pv: 16, yp: 13, tauY: 8, nHB: 0.7, kHB: 120 });
  check('HB → τ₀, n, K from the HB fields (PV/YP ignored)', hb.tauY === 8 && hb.n === 0.7 && near(hb.K, 120 / 478.8, 1e-9));
  const plD = rheoParams({ model: 'PL', pv: 16, yp: 13 });
  const fit = rheoFitPowerLaw(45, 29);
  check('PL without nPL/kPL → derived from PV/YP dial readings (old scenarios)', plD.derived && near(plD.n, fit.n, 1e-9) && near(plD.kEq, fit.kEq, 1e-9), `n ${plD.n.toFixed(3)}, K ${plD.kEq.toFixed(0)} eq.cP`);
  const plE = rheoParams({ model: 'PL', pv: 16, yp: 13, nPL: 0.55, kPL: 900 });
  check('PL with nPL/kPL → used directly', !plE.derived && plE.n === 0.55 && near(plE.K, 900 / 478.8, 1e-9));
  check('default model is HB', rheoParams({}).model === 'HB');
  console.log('  labels: ' + [bp, hb, plD].map(rheoLabel).join(' | '));
}

// ── Fann fits ────────────────────────────────────────────────────────────────
{
  console.log('\n▶ Fann fits (θ600 60, θ300 40, θ6 8, θ3 6)');
  const b = rheoFitBingham(60, 40);
  check('Bingham: PV = θ600−θ300, YP = 2θ300−θ600', b.pv === 20 && b.yp === 20);
  const p = rheoFitPowerLaw(60, 40);
  check('Power law: n = 3.32·log(θ600/θ300), K = 1.0665·θ600/1022ⁿ', near(p.n, 3.32 * Math.log10(1.5), 1e-9) && near(p.kEq, 478.8 * 1.0665 * 60 / Math.pow(1022, p.n), 1e-9), `n ${p.n.toFixed(3)}, K ${p.kEq.toFixed(0)} eq.cP`);
  const h = rheoFitHB(60, 40, 8, 6);
  check('HB: τ₀ = 1.0665·(2θ3−θ6), n/K from θ600−τ₀θ, θ300−τ₀θ', near(h.tauY, 1.0665 * 4, 1e-9) && near(h.n, 3.32 * Math.log10(56 / 36), 1e-9), `τ₀ ${h.tauY.toFixed(2)}, n ${h.n.toFixed(3)}, K ${h.kEq.toFixed(0)} eq.cP`);
  check('HB without low-shear readings reduces to Power law', rheoFitHB(60, 40).tauY === 0);
}

// ── computeRheology (hydraulics contract) on a typical section ───────────────
{
  console.log('\n▶ computeRheology — 8.5in hole, 5in DP, 280 gpm, 10 ppg, 1000 ft');
  const geom = { dh: 8.5, dp: 5.0, length: 1000 / 3.28084, flowRate: 280 };
  const v = annularVelocity_fpm(280, 8.5, 5.0);
  const rBP = computeRheology('BP', { pv: 16, yp: 13, mudWeight: 10 }, geom);
  const eBP = (16 * (v / 60) / (1000 * 3.5 * 3.5) + 13 / (200 * 3.5)) * 1000;
  // τy/τw ≈ 0.6 here, so the exact Buckingham–Reiner solution sits ~10% under the
  // leading-order Bourgoyne hand calc (see the low-shear check above).
  check('Bingham PV 16 / YP 13: laminar, 80–100% of the Bourgoyne hand calc', rBP.flowRegime === 'laminar' && rBP.pressureLoss_psi <= eBP * 1.01 && rBP.pressureLoss_psi >= 0.8 * eBP, `${rBP.pressureLoss_psi.toFixed(1)} vs ${eBP.toFixed(1)} psi, v ${v.toFixed(0)} ft/min`);
  const rHB = computeRheology('HB', { tauY: 8, nHB: 0.7, kHB: 120, mudWeight: 10 }, geom);
  const rPL = computeRheology('PL', { pv: 16, yp: 13, mudWeight: 10 }, geom);
  console.log(`  HB τ₀ 8 / n 0.7 / K 120: ${rHB.pressureLoss_psi.toFixed(1)} psi (${rHB.flowRegime}, μa ${rHB.effectiveViscosity_cP.toFixed(0)} cP)`);
  console.log(`  PL from PV/YP        : ${rPL.pressureLoss_psi.toFixed(1)} psi (${rPL.flowRegime})`);
  const old = (16 * v / (300 * 3.5 * 3.5) + 13 / (200 * 3.5)) * 10;
  console.log(`  ℹ pre-rework engine gave ${old.toFixed(1)} psi for the Bingham case (viscous term 2× high, yield term 100× low, v in ft/min against a ft/s form)`);
  check('all three models return finite positive losses', [rBP, rHB, rPL].every(r => r.pressureLoss_psi > 0 && Number.isFinite(r.pressureLoss_psi)));
  check('regime reported for each', [rBP, rHB, rPL].every(r => ['laminar', 'turbulent'].includes(r.flowRegime)));
}

console.log(failures ? `\n❌ ${failures} check(s) failed` : '\n✅ rheology reference checks PASS');
process.exit(failures ? 1 : 0);
