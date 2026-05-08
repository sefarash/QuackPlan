// ===== MINIMUM CURVATURE SURVEY ENGINE =====
const DEG = Math.PI / 180;

// Main entry: takes [{md, inc, az}] (degrees), returns full survey array
function computeSurvey(stations) {
  if (!stations || stations.length === 0) return [];

  const result = [];

  // First station — origin
  result.push({
    md:    stations[0].md,
    inc:   stations[0].inc,
    az:    stations[0].az,
    north: 0,
    east:  0,
    tvd:   0,
    dls:   0,
    dl:    0
  });

  for (let i = 1; i < stations.length; i++) {
    const prev = stations[i - 1];
    const curr = stations[i];
    const last = result[i - 1];

    const dMD  = curr.md  - prev.md;
    const inc1 = prev.inc * DEG;
    const inc2 = curr.inc * DEG;
    const az1  = prev.az  * DEG;
    const az2  = curr.az  * DEG;

    // Dogleg angle (radians) — clamp argument to arccos domain
    const cosDL = Math.cos(inc2 - inc1)
                - Math.sin(inc1) * Math.sin(inc2) * (1 - Math.cos(az2 - az1));
    const DL = Math.acos(Math.max(-1, Math.min(1, cosDL)));

    // Ratio factor — guard against DL≈0 (vertical or unchanged stations)
    const RF = DL < 1e-10 ? 1 : (2 / DL) * Math.tan(DL / 2);

    // Minimum curvature increments
    const dN = (dMD / 2) * (Math.sin(inc1) * Math.cos(az1)
                           + Math.sin(inc2) * Math.cos(az2)) * RF;
    const dE = (dMD / 2) * (Math.sin(inc1) * Math.sin(az1)
                           + Math.sin(inc2) * Math.sin(az2)) * RF;
    const dV = (dMD / 2) * (Math.cos(inc1) + Math.cos(inc2)) * RF;

    // DLS in °/30 m
    const dls = dMD > 0 ? (DL / DEG / dMD) * 30 : 0;

    result.push({
      md:    curr.md,
      inc:   curr.inc,
      az:    curr.az,
      north: last.north + dN,
      east:  last.east  + dE,
      tvd:   last.tvd   + dV,
      dls:   Math.round(dls * 100) / 100,
      dl:    Math.round(DL / DEG * 1000) / 1000
    });
  }

  return result;
}

// Convenience: build synthetic survey stations from well geometry
function generateSyntheticSurvey({ kopDepth, totalMD, buildAngle, azimuth,
                                    maxDLS, profile, stationInterval = 30 }) {
  const interval = Math.max(stationInterval, 1);
  const stations = [];

  // Build section geometry
  const buildLen  = buildAngle > 0 && maxDLS > 0
                    ? (buildAngle / maxDLS) * 30  // metres to build from 0° to buildAngle
                    : 0;
  const buildEnd  = kopDepth + buildLen;

  // S-shape: drop section mirrors build section, placed after a hold
  let dropStart = Infinity, dropEnd = Infinity;
  if (profile === 'S' && buildLen > 0) {
    dropStart = Math.min(buildEnd + (totalMD - buildEnd) * 0.35,
                         totalMD - buildLen);
    dropEnd   = dropStart + buildLen;
  }

  // Generate a station at every interval, plus guaranteed endpoints
  const mds = new Set();
  for (let md = 0; md <= totalMD; md += interval) mds.add(Math.round(md * 10) / 10);
  mds.add(0);
  mds.add(kopDepth);
  mds.add(Math.min(buildEnd, totalMD));
  if (profile === 'S') { mds.add(dropStart); mds.add(dropEnd); }
  mds.add(totalMD);

  Array.from(mds).sort((a, b) => a - b).forEach(md => {
    if (md < 0 || md > totalMD + 0.001) return;

    let inc = 0;

    if (profile === 'V') {
      inc = 0;
    } else if (md <= kopDepth) {
      inc = 0;
    } else if (md <= buildEnd && buildLen > 0) {
      // Linear inclination ramp through build section
      inc = buildAngle * ((md - kopDepth) / buildLen);
    } else if (profile === 'S' && md >= dropStart && md <= dropEnd) {
      // Linear inclination drop back toward 0
      inc = buildAngle * (1 - (md - dropStart) / buildLen);
    } else if (profile === 'S' && md > dropEnd) {
      inc = 0;
    } else {
      // Hold section (J, H, ERD, or S hold)
      inc = buildAngle;
    }

    stations.push({
      md:  Math.round(md * 10) / 10,
      inc: Math.max(0, Math.round(inc * 100) / 100),
      az:  azimuth
    });
  });

  return stations;
}
