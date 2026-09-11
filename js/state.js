// ===== GLOBAL STATE =====

// Returns theme-aware canvas colors, read from CSS variables at draw time.
function _qpColors() {
  const s   = getComputedStyle(document.documentElement);
  const get = v => s.getPropertyValue(v).trim();
  const dark = document.body.classList.contains('dark');
  return {
    bg:     get('--bg-card')  || '#ffffff',
    grid:   dark ? '#1e3448' : '#e8f0f5',
    border: get('--border')   || '#9ecce3',
    dim:    get('--text-dim') || '#5a7a8e',
    text:   get('--text')     || '#1a2b38',
  };
}
let qpState = {
  activeInputTab:  'trajectory',
  activeOutputTab: null,
  activeTrajOpt:   'opt1',
  trajSource:      'opt1',   // which option feeds qpState.survey (persisted as 'trajOpt')
  inherited:       {},       // borehole-level keys the open scenario is showing from its borehole
  currentWellId:      null,
  currentBoreholeId:  null,
  currentScenarioId:  null,
  wellDatums:      null,   // { rkb, gl } from the parent well node
  survey:          [],
  tdResult:        null,
  hydResult:       null,
  activePhase:     'full',   // analysis phase key ('full' = final program)
};

// ── Input tab switching ─────────────────────────────────────────────────────
function switchInputTab(name, el) {
  // Deactivate any active output panel first
  document.querySelectorAll('.output-panel.active').forEach(p => p.classList.remove('active'));

  document.querySelectorAll('.input-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');

  document.querySelectorAll('.input-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('panel-' + name);
  if (panel) panel.classList.add('active');

  qpState.activeInputTab  = name;
  qpState.activeOutputTab = null;
  if (typeof qpUpdateDataBanner === 'function') qpUpdateDataBanner();   // banner belongs to the input tables

  if (name === 'compare' && typeof compareInit === 'function') compareInit();
}

// ── Output tab switching ────────────────────────────────────────────────────
function switchOutputTab(name, el) {
  // Deactivate all input panels
  document.querySelectorAll('.input-panel.active').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.input-tab').forEach(t => t.classList.remove('active'));

  document.querySelectorAll('.output-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');

  document.querySelectorAll('.output-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('panel-' + name);
  if (panel) panel.classList.add('active');

  qpState.activeOutputTab = name;
  qpState.activeInputTab  = null;
  if (typeof qpUpdateDataBanner === 'function') qpUpdateDataBanner();   // output panels cover the top — hide it

  // Trigger chart redraw when switching to an output panel
  if (qpState.survey && qpState.survey.length > 1) {
    requestAnimationFrame(() => redrawOutputPanel(name));
  }
}

// ── Trajectory option tabs ──────────────────────────────────────────────────
function switchTrajOption(opt, el) {
  document.querySelectorAll('.opt-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');

  document.querySelectorAll('.opt-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('traj' + opt.charAt(0).toUpperCase() + opt.slice(1));
  if (panel) panel.classList.add('active');

  qpState.activeTrajOpt = opt;
  if (typeof _trajSetSource === 'function') _trajSetSource(opt);   // opt1 / opt2 only; 'tort' is a modifier
}

// ── Dispatch chart redraws by panel name ────────────────────────────────────
function redrawOutputPanel(name) {
  const r = qpState.tdResult;
  const h = qpState.hydResult;
  // A throw in any single draw function must not break tab switching or the
  // sliders that call this directly — contain it and surface a message.
  try {
    if      (name === 'trajplot')                  drawTrajPlot();
    else if (name === 'torque'     && r)           drawTorque(r);
    else if (name === 'buckling'   && r)           drawBuckling(r);
    else if (name === 'overpull'   && r)           drawOverpull(r);
    else if (name === 'broomstick' && r)           drawBroomstick(r);
    else if (name === 'hydraulics' && h)           { drawHydSweep(h); drawHydPie(h); }
    else if (name === 'surgeswab')                 drawSurgeSwab();
    else if (name === 'afe')                       drawAFE();
    else if (name === 'finaldiagram')              drawFinalDiagram();
    else if (name === 'cd')                        drawCasingDesign();
    else if (name === 'kt')                        drawKickTolerance();
  } catch (err) {
    console.error(`redrawOutputPanel('${name}') failed:`, err);
    if (typeof setStatus === 'function') {
      setStatus(`Draw error in ${name} panel (details in console)`, true);
    }
  }
}

// ── Header context label ─────────────────────────────────────────────────────
function setHeaderContext(wellName, scenarioName) {
  const wn = document.getElementById('hdrWellName');
  const sn = document.getElementById('hdrScenarioName');
  if (wn) wn.textContent = wellName   || 'No well selected';
  if (sn) sn.textContent = scenarioName || '—';
}


// ── Borehole-level data ───────────────────────────────────────────────────────
// Trajectory, schematic, PPFG, activity and handover describe the hole, not a
// design variant, so they can be built with only a BOREHOLE selected: they are
// then stored on the borehole node (additive keys) and every scenario under it
// shows them. A scenario may carry its own copy — legacy scenarios always do,
// and editing one of these tables while a scenario is open forks a copy into
// that scenario (its own key wins over the borehole's from then on). Nothing is
// ever moved or deleted: a scenario's stored keys stay exactly as they were.
const QP_BOREHOLE_KEYS = ['traj1', 'traj2', 'trajOpt', 'tort', 'schematic', 'ppfg', 'activity', 'handover'];

function _qpHasData(v) {
  if (v == null || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.values(v).some(x => Array.isArray(x) ? x.length > 0 : !!x);
  return true;
}

// Scenario data with the borehole's borehole-level keys filling the gaps.
// Returns { data, inherited } — pure, so Compare / export can use it too.
function qpMergeBoreholeData(scenarioData, boreholeData) {
  const data = { ...(scenarioData || {}) }, inherited = {};
  for (const k of QP_BOREHOLE_KEYS) {
    if (!_qpHasData(data[k]) && _qpHasData(boreholeData?.[k])) { data[k] = boreholeData[k]; inherited[k] = true; }
  }
  return { data, inherited };
}

// Where a save of `key` goes: the open scenario, else the selected borehole
// (borehole-level keys only). Saving a borehole-level key into a scenario that
// was showing the borehole's copy turns it into the scenario's own copy.
function qpSaveTarget(key) {
  if (qpState.currentScenarioId) {
    // A save during a LOAD is dropped by dbSaveScenarioData (RULE #1), so it
    // must not count as the scenario taking its own copy either.
    if (qpState.inherited[key] && !qpState.loadingScenario) {
      qpState.inherited[key] = false;
      if (typeof qpUpdateDataBanner === 'function') qpUpdateDataBanner();
    }
    return qpState.currentScenarioId;
  }
  if (qpState.currentBoreholeId && QP_BOREHOLE_KEYS.includes(key)) return qpState.currentBoreholeId;
  return null;
}
