// ===== SURGE / SWAB REFERENCE-CASE CHECK =====
// Runs QuackPlan's surge/swab segment model (js/surge-swab.js — closed-pipe
// Burkhardt velocity, Herschel-Bulkley slot laminar solution, Bourgoyne/API 13D
// turbulent branch; pure functions) against published surge/swab cases in
// test/surge-swab-reference-cases.json and prints the deltas. Pure Node, no
// server, no browser:
//
//   npm run test:surgeswab
//
// The published numbers are simulation outputs (WellPlan / SurgeMOD / textbook),
// not PWD measurements — see the JSON _readme. Hard assertions cover the model's
// self-consistency (Newtonian and Bingham limits, monotonic in speed across the
// laminar→turbulent transition, a realistic speed fan); the published
// comparisons are printed for judgement.

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT  = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/surge-swab-reference-cases.json'), 'utf8'));

// ── Load js/surge-swab.js into a sandbox with the globals it touches at load ──
const sandbox = {
  document: { addEventListener() {}, getElementById() { return null; } },
  QP_UNITS: { onChange() {}, label() { return ''; }, toDisplay: (q, v) => v, fromDisplay: (q, v) => v, isMetric() { return false; } },
  CI: {}, qpState: {}, console,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/surge-swab.js'), 'utf8') +
  '\nthis._ssSegLoss = _ssSegLoss; this._ssSegPsi = _ssSegPsi; this._ssSlotTauW = _ssSlotTauW;',
  sandbox, { filename: 'surge-swab.js' });
const segLoss = sandbox._ssSegLoss, segPsi = sandbox._ssSegPsi;
if (typeof segLoss !== 'function') { console.error('❌ _ssSegLoss not found in js/surge-swab.js'); process.exit(1); }

// ── Helpers ──────────────────────────────────────────────────────────────────
const BP = (mw, pv, yp) => ({ mw, tauY: yp, K: pv / 478.8, n: 1 });                 // Bingham in field stress units
const HB = (mw, tauY, K100, n) => ({ mw, tauY, K: K100, n });                        // K in lb·sⁿ/100ft²

// Innermost hole/casing ID vs MD (same boundary sweep as _ssGeom in the app).
function holeSegs(geom) {
  const rows = [...(geom.casing || []), ...(geom.openHole || [])];
  const bounds = [...new Set(rows.flatMap(r => [r.top, r.bot]))].sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i], b = bounds[i + 1], mid = (a + b) / 2;
    const cov = rows.filter(r => r.top <= mid && mid < r.bot);
    if (cov.length) segs.push({ top: a, bot: b, dh: Math.min(...cov.map(r => r.id)) });
  }
  return segs;
}
// ΔP (psi) for string elements {od, top, bot} moving at v ft/min through the hole segments.
function deltaPsi(v, segs, elements, rheo) {
  let psi = 0, turb = false;
  for (const el of elements) for (const s of segs) {
    const top = Math.max(el.top, s.top), bot = Math.min(el.bot, s.bot);
    if (bot <= top) continue;
    const r = segLoss(v, s.dh, el.od, bot - top, rheo);
    psi += r.psi; turb = turb || r.turb;
  }
  return { psi, turb };
}
const ecd = (mw, psi, tvd) => mw + psi / (0.052 * tvd);
const f2 = v => v.toFixed(2), f0 = v => v.toFixed(0);
const T  = turb => (turb ? ' (turb)' : '');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
const byId = id => CASES.cases.find(c => c.id === id);

// ── Model self-consistency ───────────────────────────────────────────────────
{
  console.log('\n▶ model limits');
  // Newtonian, laminar: slot solution must reproduce Bourgoyne dp/dL = μ·v̄/(1000·gap²)
  const mu = 50, v = 20, dh = 8.5, od = 5.0, gap = dh - od, L = 1000;
  const ve = v * (0.45 + od * od / (dh * dh - od * od)) / 60;
  const expN = mu * ve * L / (1000 * gap * gap);
  const gotN = segPsi(v, dh, od, L, { mw: 10, tauY: 0, K: mu / 478.8, n: 1 });
  check('Newtonian laminar = Bourgoyne annular form (±1%)', Math.abs(gotN / expN - 1) < 0.01, `${gotN.toFixed(2)} vs ${expN.toFixed(2)} psi`);
  // Bingham, laminar: the exact Buckingham–Reiner slot solution equals Bourgoyne's
  // PV·v̄/(1000·gap²) + YP/(200·gap) when τy ≪ τw (high shear) and sits BELOW it at
  // the low annular shear rates of tripping (the 200-form is its leading-order
  // expansion and overstates the plug contribution there).
  const bpForm = (pv, yp, vv) => pv * vv * L / (1000 * gap * gap) + yp * L / (200 * gap);
  const vHi = 150, veHi = vHi * (0.45 + od * od / (dh * dh - od * od)) / 60;
  const gotHi = segPsi(vHi, dh, od, L, BP(10, 40, 2)), expHi = bpForm(40, 2, veHi);
  check('Bingham laminar, high shear (PV 40 / YP 2 @150 ft/min) = Bourgoyne PV/YP form (±2%)', Math.abs(gotHi / expHi - 1) < 0.02, `${gotHi.toFixed(2)} vs ${expHi.toFixed(2)} psi`);
  const gotLo = segPsi(v, dh, od, L, BP(10, 30, 5)), expLo = bpForm(30, 5, ve);
  check('Bingham laminar, low shear (PV 30 / YP 5 @20 ft/min) is 75–100% of the Bourgoyne form', gotLo <= expLo * 1.001 && gotLo >= 0.75 * expLo, `${gotLo.toFixed(2)} vs ${expLo.toFixed(2)} psi`);
  // Power law, τy = 0: seed is the exact solution — solver must return it
  const n = 0.6, K = 0.5;
  const gN = 144 * ve / gap * (2 * n + 1) / (3 * n);
  const expP = K * Math.pow(gN, n) / (300 * gap) * L;
  const gotP = segPsi(v, dh, od, L, { mw: 10, tauY: 0, K, n });
  check('Power-law laminar = closed-form slot result (±0.1%)', Math.abs(gotP / expP - 1) < 0.001, `${gotP.toFixed(2)} vs ${expP.toFixed(2)} psi`);
  // Monotonic in speed across the laminar→turbulent transition (narrow annulus)
  let prev = 0, mono = true, firstTurb = null;
  for (let s = 5; s <= 600; s += 5) {
    const r = segLoss(s, 8.5, 6.5, 300, BP(10, 20, 12));
    if (r.psi < prev - 1e-9) mono = false;
    if (r.turb && firstTurb == null) firstTurb = s;
    prev = r.psi;
  }
  check('ΔP non-decreasing with speed through the transition (6.5in DC in 8.5in hole)', mono, `turbulent from ${firstTurb} ft/min`);
}

// ── Case A: Rumaila 5" DP in 12¼" OH — ECD at bit vs sec/stand ──────────────
{
  const c = byId('rumaila-5in-dp-in-12.25-oh');
  const segs = holeSegs(c.geometry), bit = c.geometry.bitMD, mw = c.fluid.mw;
  const hb = c.fluid.hb;
  // Paper: HB τ₀ 12, n 0.6, K 0.03 "lb·sⁿ/ft²" → 3.0 lb·sⁿ/100ft² (the only reading
  // that gives a physical mud — as lb·sⁿ/100ft² it would be thinner than water).
  const rheoHB = HB(mw, hb.tau_y, hb.K * 100, hb.n);
  const rheoBP = BP(mw, c.fluid.pv, c.fluid.yp);
  console.log(`\n▶ ${c.id}\n  ${c.source}\n  bit ${bit} ft, stand ${c.standFt} ft, ${mw} ppg; HB τ₀ ${hb.tau_y} n ${hb.n} K ${hb.K * 100} lb·sⁿ/100ft²  |  Bingham PV ${c.fluid.pv} YP ${c.fluid.yp}\n`);
  console.log('  sec/stand  ft/min | QP HB surge / swab   | QP Bingham surge | WellPlan closed surge / swab | open surge');
  const rowsOut = [];
  for (const row of c.expected.closedEnded) {
    const v = c.standFt * 60 / row.secPerStand;
    const a = deltaPsi(v, segs, c.geometry.string, rheoHB), b = deltaPsi(v, segs, c.geometry.string, rheoBP);
    const open = c.expected.openEnded.find(o => o.secPerStand === row.secPerStand);
    rowsOut.push({ t: row.secPerStand, v, hb: ecd(mw, a.psi, bit), bp: ecd(mw, b.psi, bit), pub: row.ecdSurgeBit });
    console.log(`  ${String(row.secPerStand).padStart(9)} ${f0(v).padStart(6)} | ` +
      `${f2(ecd(mw, a.psi, bit))} / ${f2(ecd(mw, -a.psi, bit))}${T(a.turb).padEnd(9)} | ` +
      `${f2(ecd(mw, b.psi, bit))}${T(b.turb).padEnd(11)} | ` +
      `${f2(row.ecdSurgeBit)} / ${f2(row.ecdSwabBit)}                | ${open ? f2(open.ecdSurgeBit) : '  -  '}`);
  }
  const at = t => rowsOut.find(r => r.t === t);
  check('surge ECD non-increasing with slower trips', rowsOut.every((r, i) => i === 0 || r.hb <= rowsOut[i - 1].hb + 1e-9));
  check('100 sec/stand (59 ft/min) HB surge within ±0.15 ppg of WellPlan', Math.abs(at(100).hb - at(100).pub) <= 0.15, `QP ${f2(at(100).hb)} vs ${f2(at(100).pub)} ppg`);
  const fanQP = at(10).hb - at(200).hb, fanPub = at(10).pub - at(200).pub;
  check('speed fan 200→10 sec/stand opens ≥ 0.3 ppg (was 0.04 with the velocity-independent YP term)', fanQP >= 0.3,
        `QP ${f2(fanQP)} ppg, WellPlan ${f2(fanPub)} ppg`);
}

// ── Case B: Rumaila 9⅝" casing in 12¼" OH — narrow annulus ──────────────────
{
  const c = byId('rumaila-9.625-casing-in-12.25-oh');
  const a0 = byId('rumaila-5in-dp-in-12.25-oh').fluid.hb;
  const segs = holeSegs(c.geometry), bit = c.geometry.bitMD, mw = c.fluid.mw;
  const rheoHB = HB(mw, a0.tau_y, a0.K * 100, a0.n), rheoBP = BP(mw, c.fluid.pv, c.fluid.yp);
  console.log(`\n▶ ${c.id}\n  shoe ${bit} ft, annular clearance 2.625 in, same mud as case A\n`);
  console.log('  sec/stand  ft/min | QP HB surge ECD | QP Bingham | WellPlan closed surge');
  for (const row of c.expected.closedEnded) {
    const v = c.standFt * 60 / row.secPerStand;
    const a = deltaPsi(v, segs, c.geometry.string, rheoHB), b = deltaPsi(v, segs, c.geometry.string, rheoBP);
    console.log(`  ${String(row.secPerStand).padStart(9)} ${f0(v).padStart(6)} | ${(f2(ecd(mw, a.psi, bit)) + T(a.turb)).padStart(15)} | ${(f2(ecd(mw, b.psi, bit)) + T(b.turb)).padStart(10)} | ${f2(row.ecdSurgeBit)}`);
  }
}

// ── Case C: Rumaila R-A 8½" section, RIH 100 ft/min (WellPlan TRANSIENT peaks) ─
{
  const c = byId('rumaila-RA-8.5-section-100ftmin');
  const segs = holeSegs(c.geometry), { mw, pv, yp } = c.fluid, rheo = BP(mw, pv, yp);
  console.log(`\n▶ ${c.id}\n  ${c.kind}\n  ${mw} ppg, Bingham PV ${pv} YP ${yp}, 5in DP + 248 ft of 6.5in DC, 100 ft/min\n`);
  console.log('  bit MD (m)    ft | hydrostatic | QP ΔP (steady) | WellPlan transient peak ΔP (max−min)');
  for (const row of c.expected.rih100ftmin) {
    const bit = row.bitMD_m / 0.3048, hyd = 0.052 * mw * bit;
    const r = deltaPsi(100, segs, [{ od: 5, top: 0, bot: bit - 248 }, { od: 6.5, top: bit - 248, bot: bit }], rheo);
    const pub = row.surgeMinPsi != null ? row.surgeMaxPsi - row.surgeMinPsi : row.surgeMaxPsi - hyd;
    console.log(`  ${f2(row.bitMD_m).padStart(10)} ${f0(bit).padStart(5)} | ${f0(hyd).padStart(8)} psi | ${(f0(r.psi) + ' psi' + T(r.turb)).padStart(14)} | ${f0(pub)} psi${row.fracturePsi ? ' (FG ' + row.fracturePsi + ' psi)' : ''}`);
  }
  console.log('  ℹ WellPlan\'s dynamic (inertia + compressibility) peaks sit well above any steady-state model; expected, not a defect.');
}

// ── Case D: Pegasus 11¾" liner in 12.715" casing, 180 ft/min (turbulent) ─────
{
  const c = byId('pegasus-liner-run-180ftmin');
  const segs = holeSegs(c.geometry), { mw, pv, yp } = c.fluid, tvd = c.geometry.weakZoneTVD, rheo = BP(mw, pv, yp);
  const lb = c.expected.closedEnded180ftmin.linerBottomFt;
  const r = deltaPsi(180, segs, [{ od: 11.75, top: Math.max(0, lb - 5500), bot: lb }], rheo);
  console.log(`\n▶ ${c.id}\n  ${c.kind}\n  liner bottom ${lb} ft, 180 ft/min, weak zone ${tvd} ft TVD, FG 12 ppg\n`);
  console.log(`  QP (liner element)    : ΔP ${f0(r.psi)} psi${T(r.turb)} → EMW ${f2(ecd(mw, r.psi, tvd))} ppg`);
  console.log(`  SurgeMOD published    : ΔP ≥ ${c.expected.closedEnded180ftmin.deltaPsiAtWeakZone} psi → EMW ${f2(c.expected.closedEnded180ftmin.bottomholeEMW_ppg)} ppg (fractures here)`);
  check('narrow-annulus liner run resolves as turbulent and reaches ≥ 60% of the SurgeMOD ΔP',
        r.turb && r.psi >= 0.6 * c.expected.closedEnded180ftmin.deltaPsiAtWeakZone, `${f0(r.psi)} vs ${c.expected.closedEnded180ftmin.deltaPsiAtWeakZone} psi`);
}

// ── Case E: textbook 7" liner, 16.6 ppg, 93 ft/min ───────────────────────────
{
  const c = byId('textbook-7in-liner-16.6ppg');
  const segs = holeSegs(c.geometry), bit = c.geometry.bitMD, { mw, pv, yp } = c.fluid, v = c.expected.speedFtMin, rheo = BP(mw, pv, yp);
  const dp = deltaPsi(v, segs, [c.geometry.string[0]], rheo), ln = deltaPsi(v, segs, [c.geometry.string[1]], rheo);
  console.log(`\n▶ ${c.id}\n  ${c.kind}\n`);
  console.log(`  QP DP + liner elements : ${f0(dp.psi)}${T(dp.turb)} + ${f0(ln.psi)}${T(ln.turb)} = ${f0(dp.psi + ln.psi)} psi → ECD ${f2(ecd(mw, dp.psi + ln.psi, bit))} ppg`);
  console.log(`  published hand-calc    : ${c.expected.surgePsiDP} + ${c.expected.surgePsiLiner} = ${c.expected.surgePsi} psi → ECD ${c.expected.ecdBottom} ppg`);
  console.log('  ℹ The hand-calc uses drill-pipe displacement only and no clinging term (annular v 1.35 ft/s round the liner vs ~4 ft/s here). Convention gap, not a defect.');
}

console.log(`\nMeasured-PWD sources (paywalled / figures only): ${CASES.measuredPwdSources_paywalled_or_figuresOnly.length} listed in the JSON.`);
console.log(failures ? `\n❌ ${failures} check(s) failed` : '\n✅ surge/swab reference checks PASS');
process.exit(failures ? 1 : 0);
