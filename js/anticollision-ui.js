// ===== ANTI-COLLISION UI =====
// Reads the offset-well paste + parameters, builds the offset survey with the
// shared minimum-curvature engine, runs acCompute(), and renders a proximity
// chart: centre-to-centre distance vs reference MD, with the minimum-separation
// curves for SF = 1.0 and SF = 1.5. Where the actual-distance curve crosses to
// the left of a threshold curve, the separation factor is below that threshold.
//
// X = distance, Y = reference MD (depth increases downward) — reuses the shared
// _chartGridDepthDown / _chartLineDepthDown helpers from td-charts.js. All values
// are shown in the active unit system.

// Parse "MD Inc Azi" lines (MD entered in the active display depth unit).
function _acReadOffsetSurvey() {
  const raw = document.getElementById('acOffsetPaste')?.value || '';
  const stations = [];
  raw.split(/\r?\n/).forEach(line => {
    const p = line.trim().split(/[\s,\t]+/).map(Number);
    if (p.length >= 3 && p.every(v => !isNaN(v))) {
      stations.push({ md: QP_UNITS.fromDisplay('depth', p[0]), inc: p[1], az: p[2] });
    }
  });
  return stations;
}

function _acSetSummary(txt) {
  const el = document.getElementById('acSummary');
  if (el) el.textContent = txt;
}

// Interpolate azimuth along the shortest arc (handles the 0°/360° wrap).
function _acLerpAz(a0, a1, t) {
  let d = ((a1 - a0) % 360 + 540) % 360 - 180;   // shortest signed delta in (-180,180]
  return (a0 + t * d + 360) % 360;
}

// Densify a [{md,inc,az}] station list to ~`step` ft spacing so the closest
// approach between stations isn't missed. Inc/Az are interpolated linearly and
// the points are then run back through minimum curvature (computeSurvey) by the
// caller — consistent with the app's survey model. Original stations are kept.
function _acDensify(stations, step) {
  step = step || 100;
  const out = [];
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1], b = stations[i];
    out.push({ md: a.md, inc: a.inc, az: a.az });
    const span = b.md - a.md;
    const nseg = Math.max(1, Math.ceil(span / step));
    for (let j = 1; j < nseg; j++) {
      const t = j / nseg;
      out.push({ md: a.md + t * span, inc: a.inc + t * (b.inc - a.inc), az: _acLerpAz(a.az, b.az, t) });
    }
  }
  const last = stations[stations.length - 1];
  out.push({ md: last.md, inc: last.inc, az: last.az });
  return out;
}

function drawAntiCollision() {
  const CID = 'antiCollisionCanvas';
  const c = _chartSetup(CID);
  if (!c) return;
  const { ctx, W, H } = c;

  const ref = qpState.survey;
  if (!ref || ref.length < 2) { _noData(ctx, W, H, 'Run Compute first — no reference survey'); _acSetSummary(''); return; }

  const offStations = _acReadOffsetSurvey();
  if (offStations.length < 2) {
    _noData(ctx, W, H, 'Enter an offset well survey (MD Inc Azi per line)');
    _acSetSummary('');
    return;
  }

  // Densify both wellbores to ~100 ft so the closest approach between survey
  // stations is captured (a sparse planned survey can hide a mid-segment crossing).
  const refDense = computeSurvey(_acDensify(ref.map(s => ({ md: s.md, inc: s.inc, az: s.az }))));
  const offSurvey = computeSurvey(_acDensify(offStations));

  // Params: slot/datum offsets + err-base are depths (display → imperial);
  // err-gradient and k-sigma are dimensionless.
  const d2i = (id, def) => {
    const v = document.getElementById(id)?.value;
    return (v === '' || v == null) ? def : QP_UNITS.fromDisplay('depth', +v);
  };
  const opts = {
    wellheadN:   d2i('acWhN', 0),
    wellheadE:   d2i('acWhE', QP_UNITS.fromDisplay('depth', 50)),
    wellheadTVD: d2i('acWhTVD', 0),
    errBase_ft:  d2i('acErrBase', QP_UNITS.fromDisplay('depth', 3)),
    errGrad:     +(document.getElementById('acErrGrad')?.value || 0.0015),
    kSigma:      +(document.getElementById('acKSigma')?.value  || 2.795),
  };

  const res = acCompute(refDense, offSurvey, opts);
  if (!res) { _noData(ctx, W, H, 'Anti-collision compute failed'); _acSetSummary(''); return; }

  const toD = v => QP_UNITS.toDisplay('depth', v);
  const uD  = QP_UNITS.label('depth');
  const maxMD = refDense[refDense.length - 1].md;

  const sumR = s => s.ellipseR_ref + s.ellipseR_off;   // minimum separation at SF = 1.0
  const xMaxImp = Math.max(...res.stations.map(s => s.dist), ...res.stations.map(s => 1.5 * sumR(s)), 1) * 1.1;
  const xMax = toD(xMaxImp), yMax = toD(maxMD);

  const g = _chartGridDepthDown(ctx, W, H, xMax, yMax, `Distance (${uD})`, `Ref MD (${uD})`);

  const actual = res.stations.map(s => ({ x: toD(s.dist),          y: toD(s.md) }));
  const sf1    = res.stations.map(s => ({ x: toD(sumR(s)),         y: toD(s.md) }));
  const sf15   = res.stations.map(s => ({ x: toD(1.5 * sumR(s)),   y: toD(s.md) }));

  const curves = [
    { pts: actual, color: '#2a7fa8', label: 'Centre–centre' },
    { pts: sf1,    color: '#c0392b', label: 'Min @ SF 1.0'  },
    { pts: sf15,   color: '#e08a1e', label: 'Min @ SF 1.5'  },
  ];
  CI.storeLive(CID, curves);
  CI.register(CID, { pad: g, xMax, yMax, xLabel: `Distance (${uD})`, yLabel: `Ref MD (${uD})`, depthDown: true });
  CI.drawFrozen(ctx, CID);

  ctx.setLineDash([5, 3]);
  _chartLineDepthDown(ctx, sf1,  '#c0392b', 1.5, g, xMax, yMax);
  _chartLineDepthDown(ctx, sf15, '#e08a1e', 1.5, g, xMax, yMax);
  ctx.setLineDash([]);
  _chartLineDepthDown(ctx, actual, '#2a7fa8', 2, g, xMax, yMax);

  _legend(ctx, W, g.t, curves.map(c => c.label), curves.map(c => c.color));
  CI.drawAnnotations(ctx, CID);

  const sf = res.minSF;
  const status = sf == null ? '—' : (sf < 1 ? '⚠ COLLISION RISK' : (sf < 1.5 ? 'CAUTION (SF < 1.5)' : 'OK'));
  _acSetSummary(
    `Min distance ${n1(toD(res.minDist))} ${uD}` +
    (res.minAt ? ` @ ref MD ${Math.round(toD(res.minAt.md))} ${uD} (offset MD ${Math.round(toD(res.minAt.offMd))} ${uD})` : '') +
    `  ·  Min SF ${sf == null ? '—' : sf.toFixed(2)}  ·  ${status}`
  );
}

function n1(v) { return (v == null || isNaN(v)) ? '—' : (+v).toFixed(1); }

// Relabel the depth-unit spans on the anti-collision controls when units change.
function _acUpdateLabels() {
  ['uAcWhN', 'uAcWhE', 'uAcWhTVD', 'uAcErrBase'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = QP_UNITS.label('depth');
  });
}
document.addEventListener('DOMContentLoaded', _acUpdateLabels);
if (typeof QP_UNITS !== 'undefined') {
  QP_UNITS.onChange(() => {
    _acUpdateLabels();
    if (qpState.activeOutputTab === 'anticollision') drawAntiCollision();
  });
}
