// ===== ANTI-COLLISION ENGINE =====
// Proximity / separation-factor analysis between the reference wellbore (the
// active scenario) and an offset wellbore. Pure function — takes two surveys as
// plain arrays and returns plain objects. Imperial (feet) canonical throughout,
// like every other engine; the UI converts at the display boundary.
//
// GEOMETRY (exact): for each reference station the minimum 3-D centre-to-centre
// distance to the offset polyline is found by point-to-segment projection. The
// offset survey is shifted by the offset well's slot position relative to the
// reference wellhead (wellheadN/E) and its RKB/TVD datum difference (wellheadTVD).
//
// UNCERTAINTY (simplified — NOT the full ISCWSA MWD tool-code error model): each
// wellbore's positional uncertainty is modelled as an isotropic radius that grows
// with measured depth, r(MD) = k · sqrt(errBase² + (errGrad·MD)²). This is a
// tunable approximation, surfaced as such in the UI. The separation factor uses
// the ISCWSA definition — SF = distance / (radius_ref + radius_off) — so plugging
// a full covariance-based radius in later is a drop-in replacement.
//
//   SF < 1.0  → ellipses overlap at confidence k — collision risk
//   SF < 1.5  → common minimum-clearance caution threshold
//   SF ≥ 1.5  → acceptable separation

// Minimum distance from point p to segment a→b in 3-D. Returns {dist, t}.
function _acPointSeg(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / ab2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const fx = a.x + t * abx, fy = a.y + t * aby, fz = a.z + t * abz;
  const dx = p.x - fx, dy = p.y - fy, dz = p.z - fz;
  return { dist: Math.sqrt(dx * dx + dy * dy + dz * dz), t };
}

// refSurvey / offSurvey: [{md, north, east, tvd, ...}] (feet, from computeSurvey)
// opts: { wellheadN, wellheadE, wellheadTVD, errBase_ft, errGrad, kSigma }
function acCompute(refSurvey, offSurvey, opts) {
  if (!refSurvey || refSurvey.length < 1 || !offSurvey || offSurvey.length < 2) return null;
  const o = opts || {};
  const dN   = +o.wellheadN   || 0;
  const dE   = +o.wellheadE   || 0;
  const dTVD = +o.wellheadTVD || 0;
  const errBase = +o.errBase_ft || 0;
  const errGrad = +o.errGrad    || 0;
  const k       = +o.kSigma     || 2.795;

  // Offset polyline in the reference coordinate frame (x=East, y=North, z=TVD↓).
  const off = offSurvey.map(s => ({ x: s.east + dE, y: s.north + dN, z: s.tvd + dTVD, md: s.md }));

  // Isotropic positional-uncertainty radius at confidence k (simplified model).
  const radius = md => k * Math.sqrt(errBase * errBase + (errGrad * md) * (errGrad * md));

  const stations = [];
  let minDist = Infinity, minSF = Infinity, minAt = null;

  for (const rs of refSurvey) {
    const p = { x: rs.east, y: rs.north, z: rs.tvd };
    let bestDist = Infinity, bestOffMd = off[0].md;
    for (let i = 1; i < off.length; i++) {
      const seg = _acPointSeg(p, off[i - 1], off[i]);
      if (seg.dist < bestDist) {
        bestDist  = seg.dist;
        bestOffMd = off[i - 1].md + seg.t * (off[i].md - off[i - 1].md);
      }
    }
    const rRef = radius(rs.md), rOff = radius(bestOffMd);
    const sumR = rRef + rOff;
    const sf   = sumR > 0 ? bestDist / sumR : Infinity;

    stations.push({
      md: rs.md, dist: bestDist, offMd: bestOffMd,
      sf, ellipseR_ref: rRef, ellipseR_off: rOff,
    });
    if (bestDist < minDist) minDist = bestDist;
    if (sf < minSF) { minSF = sf; minAt = { md: rs.md, dist: bestDist, offMd: bestOffMd }; }
  }

  return {
    stations,
    minDist,
    minSF: isFinite(minSF) ? minSF : null,
    minAt,
    params: { dN, dE, dTVD, errBase, errGrad, k },
  };
}

if (typeof module !== 'undefined') module.exports = { acCompute };
