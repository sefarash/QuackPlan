// ===== ANALYSIS PHASE =====
// A well is drilled in stages; the outputs should be computable for EACH stage,
// not only the finished well (how WellPlan cases / DrillPlan activities work).
// A phase = "drilling the hole for string k": every shallower string is set,
// and below its shoe there is open hole of that stage's bit size down to the
// string's setting depth.
//
// qpState.activePhase:
//   'auto'       (default) — the DEEPEST section of the scenario's casing program:
//                a scenario runs to the bottom of its own casing program, not to
//                the trajectory's TD (the trajectory beyond it is ignored)
//   'trajectory' — the final program down to the trajectory TD (the old 'full')
//   <shoe MD>    — an explicitly chosen section
// A legacy stored 'full' is read as 'auto'. Everything here is DERIVED from the
// schematic table (the scenario's casing program) — no new stored geometry.

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
    const hole = isOH ? +r.size : (r.hole > 0 ? +r.hole : _qpHoleSizeFor(+r.size));   // manual hole size wins
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

function qpPhaseMode() {
  const k = (typeof qpState !== 'undefined' && qpState.activePhase) || 'auto';
  return k === 'full' ? 'auto' : k;            // legacy stored value
}

function _qpActivePhase() {
  const key = qpPhaseMode();
  if (key === 'trajectory') return null;
  const phases = qpPhaseList();
  if (!phases.length) return null;
  if (key === 'auto') return phases[phases.length - 1];                 // deepest section
  return phases.find(p => p.key === key) || phases[phases.length - 1];  // stale key → auto
}

// Analysis TD in MD (ft, imperial): the resolved phase's limit — capped at the
// trajectory TD, since the survey cannot be extended — else the trajectory TD.
function qpPhaseTD() {
  const sv = (typeof qpState !== 'undefined' && qpState.survey) || [];
  const trajTD = sv.length ? sv[sv.length - 1].md : 0;
  const ph = _qpActivePhase();
  if (!ph) return trajTD;
  return trajTD > 0 ? Math.min(ph.mdLimit, trajTD) : ph.mdLimit;
}

// One sentence for the UI: how deep this scenario's analysis runs and why.
function qpPhaseTDText() {
  const dep = md => `${Math.round(QP_UNITS.toDisplay('depth', md)).toLocaleString()} ${QP_UNITS.label('depth')}`;
  const sv = (typeof qpState !== 'undefined' && qpState.survey) || [];
  const trajTD = sv.length ? sv[sv.length - 1].md : 0;
  const mode = qpPhaseMode(), ph = _qpActivePhase();
  if (!ph) return trajTD > 0 ? `Scenario runs to ${dep(trajTD)} — the trajectory TD (footer selector to change).` : '';
  if (trajTD > 0 && trajTD < ph.mdLimit)
    return `Scenario runs to ${dep(trajTD)} — the trajectory ends above the bottom of this program (${dep(ph.mdLimit)}).`;
  if (mode === 'auto') return `Scenario runs to ${dep(ph.mdLimit)} — the bottom of this casing program (footer selector to change).`;
  return `Scenario runs to ${dep(ph.mdLimit)} — the section selected in the footer.`;
}

// Schematic rows AS SEEN during the active phase: the already-set strings plus a
// synthesized open-hole section for the interval currently being drilled.
// 'trajectory' mode (or no program) returns the stored program untouched.
function qpPhaseRows() {
  const full = (typeof _readSchematicRows === 'function') ? _readSchematicRows() : [];
  const ph = _qpActivePhase();
  if (!ph) return full;
  return [
    ...ph.setRows.map(r => ({ ...r })),
    { def: 'Open Hole', size: ph.holeSize, top: ph.holeTop, bot: ph.mdLimit },
  ];
}

// The survey cut at mdLimit with an interpolated end station (the bit at that
// depth). Used by the analysis phases and by the broomstick (bit at every depth).
function qpTruncateSurvey(survey, mdLimit) {
  if (!survey || survey.length < 2) return survey || [];
  const last = survey[survey.length - 1];
  if (mdLimit >= last.md) return survey;
  const out = [];
  for (const st of survey) { if (st.md <= mdLimit) out.push(st); else break; }
  const i = survey.findIndex(s => s.md > mdLimit);
  const a = survey[i - 1], b = survey[i];
  if (a && b && b.md > a.md) {
    const t = (mdLimit - a.md) / (b.md - a.md);
    out.push({
      md: mdLimit,
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

// The survey down to the phase's TD (interpolated end station); full otherwise.
function qpSurveyForAnalysis() {
  const survey = (typeof qpState !== 'undefined' && qpState.survey) || [];
  const ph = _qpActivePhase();
  if (!ph || survey.length < 2) return survey;
  return qpTruncateSurvey(survey, ph.mdLimit);
}

// The fluid for the active phase: that section's row from the fluid program
// over the well default. 'trajectory' mode (or no program) returns the well
// default untouched.
function qpPhaseFluid() {
  const ph = _qpActivePhase();
  // fluid-input.js resolves a section's fluid (own record over the well default,
  // including its own rheology model); the overlay below is the fallback.
  if (ph && typeof fluidForSection === 'function') return fluidForSection(ph.key);
  const base = (typeof fluidBase === 'function') ? fluidBase() : fluidGet();
  if (!ph || typeof fluidProgramGet !== 'function') return base;
  const row = fluidProgramGet().find(r => r.key === ph.key);
  if (!row) return base;
  const out = { ...base };
  if (row.mw   > 0) out.mudWeight = row.mw;
  if (row.pv   > 0) out.pv        = row.pv;
  if (row.yp   > 0) out.yp        = row.yp;
  if (row.flow > 0) out.flowRate  = row.flow;
  // Model-specific rheology columns (additive keys; blank = inherit the form).
  // The model itself is global, so n/K feed whichever model is selected.
  if (row.tauY > 0) out.tauY = row.tauY;
  if (row.n    > 0) { out.nHB = row.n; out.nPL = row.n; }
  if (row.K    > 0) { out.kHB = row.K; out.kPL = row.K; }
  return out;
}

// ── Selector UI ───────────────────────────────────────────────────────────────

function qpPhaseRebuildSelector() {
  const sel = document.getElementById('phaseSelect');
  if (!sel) return;
  const cur = qpPhaseMode();
  const phases = qpPhaseList();
  const dep = md => `${Math.round(QP_UNITS.toDisplay('depth', md)).toLocaleString()} ${QP_UNITS.label('depth')}`;
  const sv = (typeof qpState !== 'undefined' && qpState.survey) || [];
  const trajTD = sv.length ? sv[sv.length - 1].md : 0;
  const deepest = phases[phases.length - 1];
  sel.innerHTML =
    `<option value="auto">Casing program TD${deepest ? ` — ${dep(deepest.mdLimit)}` : ''} (auto)</option>` +
    `<option value="trajectory">Full trajectory TD${trajTD ? ` — ${dep(trajTD)}` : ''}</option>` +
    phases.map(p => `<option value="${p.key}">${p.label} — ${dep(p.mdLimit)}</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'auto';
  if (typeof qpState !== 'undefined') qpState.activePhase = sel.value;
}

function qpPhaseChanged(v) {
  if (typeof qpState !== 'undefined') qpState.activePhase = v;
  if (typeof qpUpdateDataBanner === 'function') qpUpdateDataBanner();   // "runs to" note follows the mode
  if (typeof fluidProgramSync === 'function') fluidProgramSync();
  if (typeof qpCompute === 'function') qpCompute();
}

document.addEventListener('DOMContentLoaded', qpPhaseRebuildSelector);

// The selector labels and the "runs to" note carry depths in display units.
if (typeof QP_UNITS !== 'undefined' && QP_UNITS.onChange) {
  QP_UNITS.onChange(() => {
    qpPhaseRebuildSelector();
    if (typeof qpUpdateDataBanner === 'function') qpUpdateDataBanner();
  });
}
