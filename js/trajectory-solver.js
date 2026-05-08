// ===== TRAJECTORY SOLVER =====
// Converts Option 2 mixed-criteria rows → [{md, inc, az}] for computeSurvey()
// DLS display unit: °/100ft  (survey engine returns °/30ft → multiply by 100/30)

const DLS_SCALE = 100 / 30;   // °/30ft → °/100ft for display

// ── Option 2 solver ──────────────────────────────────────────────────────────
// Each row: { define, md, inc, azi, tvd, dls }
// define options: 'md_inc_azi' | 'tvd_inc_azi' | 'md_dls_azi'
function traj2BuildStations(rows) {
  if (!rows || rows.length === 0) return [];

  const stations = [];

  // First row is always the surface station
  const first = rows[0];
  stations.push({ md: +(first.md || 0), inc: +(first.inc || 0), az: +(first.azi || 0) });

  for (let i = 1; i < rows.length; i++) {
    const r    = rows[i];
    const prev = stations[stations.length - 1];

    if (r.define === 'tvd_inc_azi') {
      // Solve for MD that produces the target TVD, given Inc/Azi
      const targetTVD = +(r.tvd || 0);
      const inc2 = +(r.inc || 0);
      const az2  = +(r.azi || 0);
      const md   = _solveForMD(prev, inc2, az2, targetTVD);
      stations.push({ md, inc: inc2, az: az2 });

    } else if (r.define === 'md_dls_azi') {
      // Solve for Inc2 from DLS, given MD2 and previous station
      const md2  = +(r.md || 0);
      const dls  = +(r.dls || 0);   // °/100ft (display)
      const dMD  = md2 - prev.md;
      const az2  = +(r.azi || 0);
      // DLS = DL_degrees / dMD * 100  →  DL_degrees = DLS * dMD / 100
      const dl   = dls * Math.abs(dMD) / 100;
      const inc2 = Math.max(0, prev.inc + dl);   // simple: azimuth change = 0
      stations.push({ md: md2, inc: inc2, az: az2 });

    } else {
      // Default: md_inc_azi — use directly
      stations.push({ md: +(r.md || 0), inc: +(r.inc || 0), az: +(r.azi || 0) });
    }
  }

  return stations;
}

// Binary-search MD that gives targetTVD, given known Inc2/Az2
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

  const prevSurvey = computeSurvey([prevStation]);
  const prevTVD    = prevSurvey[0]?.tvd ?? 0;
  const dTVD       = targetTVD - prevTVD;

  if (Math.abs(tvdPerFt) < 1e-10) return prevStation.md + Math.abs(dTVD);
  const dMD = dTVD / tvdPerFt;
  return Math.max(prevStation.md, prevStation.md + dMD);
}

// ── Tortuosity application ────────────────────────────────────────────────────
// intervals: [{startMD, endMD, tort, mode}]  mode: 'random' | 'sinusoidal'
// baseSurvey: [{md, inc, az}] from Option 1 or Option 2
function applyTortuosity(baseSurvey, intervals) {
  if (!baseSurvey.length || !intervals.length) return baseSurvey;

  return baseSurvey.map((st, idx) => {
    if (idx === 0) return st;
    const iv = intervals.find(iv =>
      st.md >= +(iv.startMD || 0) && st.md <= +(iv.endMD || 0));
    if (!iv) return st;

    const tort    = +(iv.tort || 0);           // °/100ft
    const dMD     = st.md - baseSurvey[idx - 1].md;
    const dlAdd   = tort * dMD / 100;          // additional dogleg degrees
    const delta   = iv.mode === 'sinusoidal'
                    ? dlAdd * Math.sin((idx / baseSurvey.length) * Math.PI)
                    : dlAdd * (Math.random() * 2 - 1);

    return { md: st.md, inc: Math.max(0, st.inc + delta * 0.5), az: st.az + delta * 0.5 };
  });
}
