// ===== TRAJECTORY SOLVER =====
// Converts Option 2 mixed-criteria rows → [{md, inc, az}] for computeSurvey()
// DLS display unit: °/100ft  (survey engine returns °/30ft → multiply by 100/30)

const DLS_SCALE = 100 / 30;   // °/30ft → °/100ft for display

// ── Option 2 solver ──────────────────────────────────────────────────────────
// Each row: { define, md, inc, azi, tvd, dls }
// define options: 'md_inc_azi' | 'inc_azi_tvd' | 'inc_azi_dls'
function traj2BuildStations(rows) {
  if (!rows || rows.length === 0) return [];

  const stations = [];

  // First row is always the surface station. Track accumulated TVD on each
  // station so later inc_azi_tvd rows can solve against the real previous TVD.
  const first = rows[0];
  stations.push({ md: +(first.md || 0), inc: +(first.inc || 0),
                  az: +(first.azi || 0), tvd: +(first.tvd || 0) });

  for (let i = 1; i < rows.length; i++) {
    const r    = rows[i];
    const prev = stations[stations.length - 1];

    if (r.define === 'hold') {
      // Hold: keep previous inc and az, user supplies only MD
      const md = +(r.md || 0);
      const tvdInc = _mcTVDinc(prev.inc, prev.az || 0, prev.inc, prev.az || 0, md - prev.md);
      stations.push({ md, inc: prev.inc, az: prev.az || 0, tvd: prev.tvd + tvdInc });

    } else if (r.define === 'inc_azi_tvd') {
      // Solve for MD that produces the target TVD, given Inc/Azi
      const targetTVD = +(r.tvd || 0);
      const inc2 = +(r.inc || 0);
      const az2  = +(r.azi || 0);
      const md   = _solveForMD(prev, inc2, az2, targetTVD);
      // TVD at this station is the target by construction
      stations.push({ md, inc: inc2, az: az2, tvd: targetTVD });

    } else if (r.define === 'inc_azi_dls') {
      // Solve for MD from Inc2, Azi2, DLS using min curvature dogleg angle
      const inc2 = +(r.inc || 0);
      const az2  = +(r.azi || 0);
      const dls  = +(r.dls || 0);   // °/100ft (display)
      const dl   = _computeDL(prev.inc, prev.az || 0, inc2, az2);  // degrees
      const dMD  = dls > 0 ? dl * 100 / dls : 0;
      const tvdInc = _mcTVDinc(prev.inc, prev.az || 0, inc2, az2, dMD);
      stations.push({ md: prev.md + dMD, inc: inc2, az: az2, tvd: prev.tvd + tvdInc });

    } else {
      // Default: md_inc_azi — use directly
      const md   = +(r.md || 0);
      const inc2 = +(r.inc || 0);
      const az2  = +(r.azi || 0);
      const tvdInc = _mcTVDinc(prev.inc, prev.az || 0, inc2, az2, md - prev.md);
      stations.push({ md, inc: inc2, az: az2, tvd: prev.tvd + tvdInc });
    }
  }

  return stations;
}

// Compute dogleg angle in degrees between two survey stations
function _computeDL(inc1, az1, inc2, az2) {
  const DEG = Math.PI / 180;
  const cosDL = Math.cos((inc2 - inc1) * DEG)
              - Math.sin(inc1 * DEG) * Math.sin(inc2 * DEG) * (1 - Math.cos((az2 - az1) * DEG));
  return Math.acos(Math.max(-1, Math.min(1, cosDL))) / DEG;
}

// Minimum-curvature TVD increment (ft) between two stations
function _mcTVDinc(inc1deg, az1deg, inc2deg, az2deg, dMD) {
  if (!(dMD > 0)) return 0;
  const DEG = Math.PI / 180;
  const i1 = inc1deg * DEG, i2 = inc2deg * DEG;
  const a1 = az1deg  * DEG, a2 = az2deg * DEG;
  const cosDL = Math.cos(i2 - i1) - Math.sin(i1) * Math.sin(i2) * (1 - Math.cos(a2 - a1));
  const DL = Math.acos(Math.max(-1, Math.min(1, cosDL)));
  const RF = DL < 1e-10 ? 1 : (2 / DL) * Math.tan(DL / 2);
  return 0.5 * (Math.cos(i1) + Math.cos(i2)) * RF * dMD;
}

// Closed-form MD that gives targetTVD, given known Inc2/Az2 and the previous
// station's accumulated TVD (prevStation.tvd).
function _solveForMD(prevStation, inc2, az2, targetTVD) {
  const DEG = Math.PI / 180;
  const inc1 = prevStation.inc * DEG;
  const inc2r = inc2 * DEG;
  const az1  = (prevStation.az || 0) * DEG;
  const az2r  = az2 * DEG;

  // Minimum curvature TVD increment per unit dMD
  const cosDL = Math.cos(inc2r - inc1)
              - Math.sin(inc1) * Math.sin(inc2r) * (1 - Math.cos(az2r - az1));
  const DL = Math.acos(Math.max(-1, Math.min(1, cosDL)));
  const RF = DL < 1e-10 ? 1 : (2 / DL) * Math.tan(DL / 2);
  const tvdPerFt = 0.5 * (Math.cos(inc1) + Math.cos(inc2r)) * RF;

  const prevTVD = prevStation.tvd ?? 0;
  const dTVD    = targetTVD - prevTVD;

  if (Math.abs(tvdPerFt) < 1e-10) return prevStation.md + Math.abs(dTVD);
  const dMD = dTVD / tvdPerFt;
  return Math.max(prevStation.md, prevStation.md + dMD);
}

// ── Tortuosity application ────────────────────────────────────────────────────
// intervals: [{startMD, endMD, tort, mode}]  mode: 'random' | 'sinusoidal'
// baseSurvey: [{md, inc, az}] from Option 1 or Option 2

// Deterministic PRNG (mulberry32) — a fixed seed makes the tortured survey
// reproducible across recompute cycles instead of changing on every keystroke.
function _tortRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _TORT_WAVELEN_FT = 150;   // spatial period of the sinusoidal mode (ft/cycle)

function applyTortuosity(baseSurvey, intervals) {
  if (!baseSurvey.length || !intervals.length) return baseSurvey;
  const DEG = Math.PI / 180;

  // Seed from the interval definition so identical inputs reproduce identical
  // output — deterministic, no Math.random().
  let seed = 0x9E3779B9 >>> 0;
  intervals.forEach(iv => {
    const k = Math.round((+(iv.startMD || 0)) + (+(iv.endMD || 0)) * 7 + (+(iv.tort || 0)) * 1000);
    seed = (Math.imul(seed, 31) + k) >>> 0;
  });
  const rng = _tortRng(seed);

  // Accumulated offset from the planned path (deg). Each station adds an
  // incremental dogleg of magnitude dlAdd, so the realized added DLS matches the
  // nominal `tort`, and the offset persists station-to-station (correlated
  // wander, not white noise). Random mode uses AR(1) mean-reversion so the walk
  // stays bounded around the plan instead of drifting away.
  let offInc = 0, offAz = 0;
  let toolface = rng() * 2 * Math.PI;

  return baseSurvey.map((st, idx) => {
    if (idx === 0) return st;
    const iv = intervals.find(iv =>
      st.md >= +(iv.startMD || 0) && st.md <= +(iv.endMD || 0));
    if (!iv) return st;

    const tort  = +(iv.tort || 0);            // °/100ft
    const dMD   = st.md - baseSurvey[idx - 1].md;
    const dlAdd = tort * dMD / 100;           // incremental dogleg per step (deg)

    let tf, decay;
    if (iv.mode === 'sinusoidal') {
      // Toolface rotates with MD (station-spacing independent) → smooth helical
      // wander with a fixed spatial wavelength, not an index-dependent frequency.
      tf    = 2 * Math.PI * st.md / _TORT_WAVELEN_FT;
      decay = 1.0;                            // pure oscillation, bounded by the sine
    } else {
      toolface += (rng() * 2 - 1) * 0.8;      // rad; drift sets the correlation length
      tf    = toolface;
      // Mean-reversion factor. There is a physical tradeoff: persistent dogleg in
      // one direction necessarily drifts the hole off plan, so higher fidelity to
      // the nominal DLS means more drift. 0.85 balances realized DLS (~1.5°/100ft
      // for tort=2) against bounded drift (<~7° over a 3000 ft interval).
      decay = 0.85;
    }

    // Add the step as a pure rotation of magnitude dlAdd at toolface `tf`.
    // Decomposing a rotation this way makes the incremental dogleg equal exactly
    // dlAdd — the old 50/50 inc+az split gave only ~0.6–0.71× the intended value.
    const sinI = Math.max(Math.sin(st.inc * DEG), 1e-3);
    offInc = offInc * decay + dlAdd * Math.cos(tf);
    offAz  = offAz  * decay + dlAdd * Math.sin(tf) / sinI;

    return { md: st.md, inc: Math.max(0, st.inc + offInc), az: st.az + offAz };
  });
}
