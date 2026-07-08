// ===== POSITIONAL ERROR MODEL (ISCWSA-style, reduced) =====
// Builds a 3×3 positional covariance matrix per survey station in the (N, E, V)
// frame, used by the anti-collision engine to size ellipses of uncertainty and
// compute a proper direction-projected separation factor.
//
// This is a REDUCED, SYSTEMATIC error model — the three dominant survey error
// sources, each treated as fully correlated along the hole (systematic):
//   • depth scale        σ_D  (fractional, e.g. 0.0005 = 500 ppm of measured depth)
//   • inclination         σ_I  (degrees, sensor + misalignment lumped)
//   • azimuth             σ_A  (degrees, reference + sensor lumped)
//   • base                σ_B  (feet, isotropic random floor — represents the
//                               unmodelled/random component and, importantly,
//                               keeps the ellipsoid non-degenerate for a vertical
//                               well, whose azimuth reference is otherwise
//                               indeterminate so its cross-azimuth uncertainty
//                               would collapse to zero)
// It is NOT the full ISCWSA MWD Rev-4 tool-code model (~15 weighted sources with
// random/systematic/global propagation). The structure is the same, so the full
// model is a drop-in later: emCovariance just needs more source terms summed in.
//
// Method (Williamson-style): a systematic error ε contributes a position-error
// vector that is the sum, over every leg drilled so far, of ∂(leg displacement)/∂ε.
// Covariance is the outer product of that accumulated vector (perfect correlation
// along hole). Independent sources add their covariances. Feet canonical.

const _EM_DEG = Math.PI / 180;

// survey: [{md, inc, az}] (inc/az in degrees). params: {sigD, sigI_deg, sigA_deg}
// Returns per-station covariance: [{nn, ee, vv, ne, nv, ev}] (symmetric, ft²).
function emCovariance(survey, params) {
  const p = params || {};
  const sigD = +p.sigD || 0;                       // fractional depth scale
  const sigI = (+p.sigI_deg || 0) * _EM_DEG;       // rad
  const sigA = (+p.sigA_deg || 0) * _EM_DEG;       // rad
  const b2   = (+p.sigBase_ft || 0) ** 2;          // isotropic random floor (ft²)

  const cov = [];
  // Accumulated systematic position-error vectors (N,E,V) for each source.
  let eD = { n: 0, e: 0, v: 0 };
  let eI = { n: 0, e: 0, v: 0 };
  let eA = { n: 0, e: 0, v: 0 };

  const outer = v => ({
    nn: v.n * v.n, ee: v.e * v.e, vv: v.v * v.v,
    ne: v.n * v.e, nv: v.n * v.v, ev: v.e * v.v,
  });

  for (let k = 0; k < survey.length; k++) {
    if (k > 0) {
      const s0 = survey[k - 1], s1 = survey[k];
      const dMD = s1.md - s0.md;
      // Balanced-tangential leg direction (average of the two station angles).
      const I = ((s0.inc + s1.inc) / 2) * _EM_DEG;
      const A = ((s0.az + s1.az) / 2) * _EM_DEG;
      const sI = Math.sin(I), cI = Math.cos(I), sA = Math.sin(A), cA = Math.cos(A);

      // Depth scale: the whole leg stretches → error along the tangent.
      eD.n += sigD * dMD * (sI * cA);
      eD.e += sigD * dMD * (sI * sA);
      eD.v += sigD * dMD * (cI);

      // Inclination: ∂tangent/∂I = (cI·cA, cI·sA, −sI) → high-side rotation.
      eI.n += sigI * dMD * (cI * cA);
      eI.e += sigI * dMD * (cI * sA);
      eI.v += sigI * dMD * (-sI);

      // Azimuth: ∂tangent/∂A = (−sI·sA, sI·cA, 0) → lateral rotation about vertical.
      eA.n += sigA * dMD * (-sI * sA);
      eA.e += sigA * dMD * (sI * cA);
      // eA.v += 0
    }
    const a = outer(eD), b = outer(eI), c = outer(eA);
    cov.push({
      nn: a.nn + b.nn + c.nn + b2, ee: a.ee + b.ee + c.ee + b2, vv: a.vv + b.vv + c.vv + b2,
      ne: a.ne + b.ne + c.ne, nv: a.nv + b.nv + c.nv, ev: a.ev + b.ev + c.ev,
    });
  }
  return cov;
}

// Variance of the covariance C projected onto unit direction u=(uN,uE,uV):
//   σ² = uᵀ C u
function emProject(C, uN, uE, uV) {
  if (!C) return 0;
  return uN * uN * C.nn + uE * uE * C.ee + uV * uV * C.vv
       + 2 * (uN * uE * C.ne + uN * uV * C.nv + uE * uV * C.ev);
}

// Lateral (horizontal) 1-σ semi-axes of the N–E sub-covariance — handy for
// reporting the ellipse of uncertainty. Returns {major, minor, azimuth_deg}.
function emLateralEllipse(C) {
  if (!C) return { major: 0, minor: 0, azimuth_deg: 0 };
  const a = C.nn, b = C.ee, c = C.ne;
  const tr = a + b, det = a * b - c * c;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
  const major = Math.sqrt(Math.max(0, l1)), minor = Math.sqrt(Math.max(0, l2));
  // Orientation of the major axis (from North, toward East).
  const azimuth_deg = 0.5 * Math.atan2(2 * c, a - b) / _EM_DEG;
  return { major, minor, azimuth_deg };
}

if (typeof module !== 'undefined') module.exports = { emCovariance, emProject, emLateralEllipse };
