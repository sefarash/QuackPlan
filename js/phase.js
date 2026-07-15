// ===== ANALYSIS PHASE =====
// A well is drilled in stages; the outputs should be computable for EACH stage,
// not only the finished well (how WellPlan cases / DrillPlan activities work).
// A phase = "drilling the hole for string k": every shallower string is set,
// and below its shoe there is open hole of that stage's bit size down to the
// string's setting depth.
//
// qpState.activePhase: 'full' (default — final program, identical to the
// pre-phase behaviour) or the shoe MD (as a string) of the phase-defining row.
// Everything here is DERIVED from the schematic table — no new stored geometry.

// Standard casing-OD → bit-size pairings (inches). Used to reconstruct the hole
// drilled for a casing string (the schematic stores casing OD, not hole size).
// Fallback for odd sizes: OD + typical clearance. The derived size is shown in
// the phase label so it is never a hidden assumption.
const _QP_BIT_FOR_CASING = {
  36: 42,   30: 36,    26: 32,    24: 28,     22: 26,   20: 26,
  18.625: 22, 16: 20,  13.375: 17.5, 11.75: 14.75, 10.75: 13.5,
  9.625: 12.25, 8.625: 10.625, 7.625: 9.5, 7: 8.5, 5.5: 6.75, 5: 6.125, 4.5: 5.875,
};

function _qpHoleSizeFor(casingOD) {
  if (_QP_BIT_FOR_CASING[casingOD] != null) return _QP_BIT_FOR_CASING[casingOD];
  // nearest catalogue OD within 1/8"
  for (const k of Object.keys(_QP_BIT_FOR_CASING)) {
    if (Math.abs(+k - casingOD) < 0.126) return _QP_BIT_FOR_CASING[k];
  }
  return casingOD + (casingOD >= 16 ? 4 : casingOD >= 9 ? 2.75 : 1.5);
}

function _qpFmtIn(v) {
  const fr = { 0.125: '⅛', 0.25: '¼', 0.375: '⅜', 0.5: '½', 0.625: '⅝', 0.75: '¾', 0.875: '⅞' };
  const int = Math.floor(v), f = +(v - int).toFixed(3);
  return f === 0 ? String(int) : (fr[f] ? int + fr[f] : v.toFixed(2));
}

// Ordered list of drilling phases derived from the schematic rows.
// Each: { key, label, mdLimit, holeTop, holeSize, setRows }
function qpPhaseList() {
  const rows = (typeof _readSchematicRows === 'function' ? _readSchematicRows() : [])
    .filter(r => +(r.bot || 0) > +(r.top || 0));
  const sorted = [...rows].sort((a, b) => +a.bot - +b.bot);
  const phases = [];
  let prevShoe = 0;
  sorted.forEach((r, i) => {
    const isOH = r.def === 'Open Hole';
    const hole = isOH ? +r.size : _qpHoleSizeFor(+r.size);
    phases.push({
      key:      String(+r.bot),
      label:    `Drilling ${_qpFmtIn(hole)}" hole` +
                (isOH ? ' (final section)' : ` → set ${_qpFmtIn(+r.size)}" ${r.def}`),
      mdLimit:  +r.bot,
      holeTop:  prevShoe,
      holeSize: hole,
      setRows:  sorted.slice(0, i),
    });
    prevShoe = +r.bot;
  });
  return phases;
}

function _qpActivePhase() {
  const key = (typeof qpState !== 'undefined' && qpState.activePhase) || 'full';
  if (key === 'full') return null;
  return qpPhaseList().find(p => p.key === key) || null;
}

// Schematic rows AS SEEN during the active phase: the already-set strings plus a
// synthesized open-hole section for the interval currently being drilled.
// 'full' returns the stored program untouched (pre-phase behaviour).
function qpPhaseRows() {
  const full = (typeof _readSchematicRows === 'function') ? _readSchematicRows() : [];
  const ph = _qpActivePhase();
  if (!ph) return full;
  return [
    ...ph.setRows.map(r => ({ ...r })),
    { def: 'Open Hole', size: ph.holeSize, top: ph.holeTop, bot: ph.mdLimit },
  ];
}

// The survey down to the phase's TD (interpolated end station); full otherwise.
function qpSurveyForAnalysis() {
  const survey = (typeof qpState !== 'undefined' && qpState.survey) || [];
  const ph = _qpActivePhase();
  if (!ph || survey.length < 2) return survey;
  const last = survey[survey.length - 1];
  if (ph.mdLimit >= last.md) return survey;
  const out = [];
  for (const st of survey) { if (st.md <= ph.mdLimit) out.push(st); else break; }
  const i = survey.findIndex(s => s.md > ph.mdLimit);
  const a = survey[i - 1], b = survey[i];
  if (a && b && b.md > a.md) {
    const t = (ph.mdLimit - a.md) / (b.md - a.md);
    out.push({
      md: ph.mdLimit,
      inc:   a.inc   + t * (b.inc   - a.inc),
      az:    a.az    + t * (b.az    - a.az),
      tvd:   a.tvd   + t * (b.tvd   - a.tvd),
      north: (a.north || 0) + t * ((b.north || 0) - (a.north || 0)),
      east:  (a.east  || 0) + t * ((b.east  || 0) - (a.east  || 0)),
      dls:   b.dls || 0,
    });
  }
  return out.length >= 2 ? out : survey;
}

// The fluid for the active phase: global fluid form overlaid with that
// section's row from the fluid program (MW / PV / YP / flow). 'full' returns
// the global fluid untouched.
function qpPhaseFluid() {
  const base = fluidGet();
  const ph = _qpActivePhase();
  if (!ph || typeof fluidProgramGet !== 'function') return base;
  const row = fluidProgramGet().find(r => r.key === ph.key);
  if (!row) return base;
  const out = { ...base };
  if (row.mw   > 0) out.mudWeight = row.mw;
  if (row.pv   > 0) out.pv        = row.pv;
  if (row.yp   > 0) out.yp        = row.yp;
  if (row.flow > 0) out.flowRate  = row.flow;
  return out;
}

// ── Selector UI ───────────────────────────────────────────────────────────────

function qpPhaseRebuildSelector() {
  const sel = document.getElementById('phaseSelect');
  if (!sel) return;
  const cur = (typeof qpState !== 'undefined' && qpState.activePhase) || 'full';
  const phases = qpPhaseList();
  sel.innerHTML = '<option value="full">Full well (final)</option>' +
    phases.map(p => `<option value="${p.key}">${p.label}</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'full';
  if (typeof qpState !== 'undefined') qpState.activePhase = sel.value;
}

function qpPhaseChanged(v) {
  if (typeof qpState !== 'undefined') qpState.activePhase = v;
  if (typeof fluidProgramSync === 'function') fluidProgramSync();
  if (typeof qpCompute === 'function') qpCompute();
}

document.addEventListener('DOMContentLoaded', qpPhaseRebuildSelector);
