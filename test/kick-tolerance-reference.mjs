// ===== KICK TOLERANCE REFERENCE CHECK =====
// Loads js/kick-tolerance.js in a sandbox and checks the real-gas engine's hole
// geometry (deviation, horizontal hole, gas around DP vs collars) against the
// closed-form two-section model it replaced — the one validated to within 0.3 %
// of a published kick tolerance workbook — and against hand-derived limits.
// Pure Node, no server:
//
//   npm run test:kt

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src  = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
// _tvdAt lives in compute-engine.js (DOM-bound file) — take just that function
const tvdAtSrc = src('js/compute-engine.js').match(/function _tvdAt\(survey, md\) \{[\s\S]*?\n\}/)[0];

const sb = {
  console, Math,
  QP_UNITS: { onChange() {}, isMetric: () => false, label: () => '', toDisplay: (q, v) => v, fromDisplay: (q, v) => v, convert: (q, v) => v },
  document: { addEventListener() {}, getElementById: () => null },
};
vm.createContext(sb);
vm.runInContext(tvdAtSrc + '\n' + src('js/kick-tolerance.js') +
  '\nthis.X = { _ktGasTolerance, _ktAnnulusProfile, _ktColumnVol, _ktGasDensity };', sb, { filename: 'kick-tolerance.js' });
const { _ktGasTolerance, _ktAnnulusProfile, _ktGasDensity } = sb.X;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
const near = (a, b, tol) => Math.abs(a / b - 1) <= tol;

const PPG = 0.051948, ATM = 14.7;
const tempR = tvd => 70 + 1.5 / 100 * tvd + 459.67;
const cap = (dh, od) => (dh * dh - od * od) / 1029.4;

// The previous closed-form two-section model (vertical hole, gas around DP at the weak point)
function legacy(o) {
  const Pfrac = o.fg * PPG * o.tvdWeak;
  const maasp = Pfrac - o.mw * PPG * o.tvdWeak - o.safetyPsi;
  const denWeak = _ktGasDensity(Math.max(ATM, Pfrac - o.safetyPsi + ATM), o.tempWeak_R);
  const denBottom = _ktGasDensity(o.pp * PPG * o.tvdKick + ATM, o.tempKick_R);
  const rhoK = denWeak / 144 / PPG;
  const hmax = (maasp - PPG * (o.pp - o.mw) * o.tvdKick) / (PPG * (o.mw - rhoK));
  const volBottom = hmax > o.dcLen ? o.capBHA * o.dcLen + o.capDP * (hmax - o.dcLen) : o.capBHA * hmax;
  const volCirc = o.capDP * hmax * denWeak / denBottom;
  return { hmax, volBottom, volCirc, kt: Math.min(volBottom, volCirc) };
}

const vertical = td => [{ md: 0, tvd: 0, inc: 0 }, { md: td, tvd: td, inc: 0 }];
const base = { mw: 10, fg: 15, safetyPsi: 100, influx: 'methane' };

// ── 1. Vertical well, long open hole: identical to the validated model ───────
{
  console.log('\n▶ vertical, 8½" hole 5,000 → 10,000 ft, 5" DP + 600 ft of 6½" DC');
  const sv = vertical(10000);
  for (const pp of [10, 10.5, 11]) {
    const o = { ...base, pp, tvdKick: 10000, tvdWeak: 5000, tempKick_R: tempR(10000), tempWeak_R: tempR(5000) };
    const n = _ktGasTolerance({ ...o, prof: _ktAnnulusProfile(sv, 5000, 10000, 8.5, 5, 6.5, 600) });
    const l = legacy({ ...o, capBHA: cap(8.5, 6.5), capDP: cap(8.5, 5), dcLen: 600 });
    check(`PP ${pp} ppg: shut-in = two-section closed form ±0.1 %`, near(n.volBottom, l.volBottom, 0.001), `${n.volBottom.toFixed(2)} vs ${l.volBottom.toFixed(2)} bbl`);
    check(`PP ${pp} ppg: circulating = closed form ±0.1 %`, near(n.volCirc, l.volCirc, 0.001), `${n.volCirc.toFixed(2)} vs ${l.volCirc.toFixed(2)} bbl`);
  }
}

// ── 2. Short open hole: gas at the weak point sits around the collars ────────
{
  console.log('\n▶ vertical, short open hole 9,700 → 10,000 ft (collars reach above the shoe)');
  const sv = vertical(10000);
  const o = { ...base, pp: 10, tvdKick: 10000, tvdWeak: 9700, tempKick_R: tempR(10000), tempWeak_R: tempR(9700) };
  const n = _ktGasTolerance({ ...o, prof: _ktAnnulusProfile(sv, 9700, 10000, 8.5, 5, 6.5, 600) });
  const l = legacy({ ...o, capBHA: cap(8.5, 6.5), capDP: cap(8.5, 5), dcLen: 600 });
  const hm = Math.min(n.hmax, 300);
  const ratio = _ktGasDensity(Math.max(ATM, 15 * PPG * 9700 - 100 + ATM), tempR(9700)) / _ktGasDensity(10 * PPG * 10000 + ATM, tempR(10000));
  check('circulating volume uses the collar annulus (no DP in open hole)', near(n.volCirc, cap(8.5, 6.5) * hm * ratio, 0.001),
    `${n.volCirc.toFixed(2)} bbl (old DP-annulus model ${l.volCirc.toFixed(2)})`);
}

// ── 3. Deviated hole: volume per foot of height × 1/cos(inc) ────────────────
{
  console.log('\n▶ 60° tangent from surface, no collars (single annulus)');
  const c60 = Math.cos(Math.PI / 3);
  const sv = [{ md: 0, tvd: 0, inc: 60 }, { md: 20000, tvd: 20000 * c60, inc: 60 }];
  const shoeMD = 10000, tdMD = 20000;
  const o = { ...base, pp: 10, tvdKick: tdMD * c60, tvdWeak: shoeMD * c60, tempKick_R: tempR(tdMD * c60), tempWeak_R: tempR(shoeMD * c60) };
  const n = _ktGasTolerance({ ...o, prof: _ktAnnulusProfile(sv, shoeMD, tdMD, 8.5, 5, 5, 0) });
  const v = legacy({ ...o, capBHA: cap(8.5, 5), capDP: cap(8.5, 5), dcLen: 0 });
  check('shut-in = vertical volume ÷ cos 60° ±0.1 %', near(n.volBottom, v.volBottom / c60, 0.001), `${n.volBottom.toFixed(2)} vs ${(v.volBottom / c60).toFixed(2)} bbl`);
  check('circulating = vertical volume ÷ cos 60° ±0.1 %', near(n.volCirc, v.volCirc / c60, 0.001), `${n.volCirc.toFixed(2)} vs ${(v.volCirc / c60).toFixed(2)} bbl`);
}

// ── 4. Horizontal hole at the bottom adds volume with no height ──────────────
{
  console.log('\n▶ vertical to 10,000 ft, then 2,000 ft horizontal');
  const sv = [{ md: 0, tvd: 0, inc: 0 }, { md: 10000, tvd: 10000, inc: 0 }, { md: 12000, tvd: 10000, inc: 90 }];
  const o = { ...base, pp: 10, tvdKick: 10000, tvdWeak: 5000, tempKick_R: tempR(10000), tempWeak_R: tempR(5000) };
  const n = _ktGasTolerance({ ...o, prof: _ktAnnulusProfile(sv, 5000, 12000, 8.5, 5, 5, 0) });
  const v = legacy({ ...o, capBHA: cap(8.5, 5), capDP: cap(8.5, 5), dcLen: 0 });
  check('shut-in = vertical volume + horizontal section volume', near(n.volBottom, v.volBottom + cap(8.5, 5) * 2000, 0.001),
    `${n.volBottom.toFixed(2)} vs ${(v.volBottom + cap(8.5, 5) * 2000).toFixed(2)} bbl`);
  check('circulating (gas below the weak point, vertical) unchanged', near(n.volCirc, v.volCirc, 0.001), `${n.volCirc.toFixed(2)} bbl`);
}

// ── 5. Kick intensity raises the kick-zone pressure → lower tolerance ───────
{
  console.log('\n▶ kick intensity sensitivity (vertical case 1)');
  const sv = vertical(10000);
  const prof = _ktAnnulusProfile(sv, 5000, 10000, 8.5, 5, 6.5, 600);
  const kt = ki => _ktGasTolerance({ ...base, pp: 10 + ki, tvdKick: 10000, tvdWeak: 5000, tempKick_R: tempR(10000), tempWeak_R: tempR(5000), prof }).kt;
  const a = kt(0), b = kt(0.5), c = kt(1.0);
  check('KT falls as kick intensity rises (0 → 0.5 → 1.0 ppg)', a > b && b > c, `${a.toFixed(1)} → ${b.toFixed(1)} → ${c.toFixed(1)} bbl`);
}

console.log(failures ? `\n❌ ${failures} check(s) failed` : '\n✅ PASS — kick tolerance reference checks');
process.exit(failures ? 1 : 0);
