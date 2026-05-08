// ===== GLOBAL STATE =====
let qpState = {
  activeInputTab:  'trajectory',
  activeOutputTab: null,
  activeTrajOpt:   'opt1',
  currentWellId:   null,
  currentScenarioId: null,
  survey:          [],
  tdResult:        null,
  hydResult:       null,
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
}

// ── Dispatch chart redraws by panel name ────────────────────────────────────
function redrawOutputPanel(name) {
  const r = qpState.tdResult;
  const h = qpState.hydResult;
  if      (name === 'trajplot')                  drawTrajPlot();
  else if (name === 'torque'     && r)           drawTorque(r);
  else if (name === 'buckling'   && r)           drawBuckling(r);
  else if (name === 'overpull'   && r)           drawOverpull(r);
  else if (name === 'broomstick' && r)           drawBroomstick(r);
  else if (name === 'hydraulics' && h)           { drawHydSweep(h); drawHydPie(h); }
  else if (name === 'afe')                       drawAFE();
}

// ── Header context label ─────────────────────────────────────────────────────
function setHeaderContext(wellName, scenarioName) {
  const wn = document.getElementById('hdrWellName');
  const sn = document.getElementById('hdrScenarioName');
  if (wn) wn.textContent = wellName   || 'No well selected';
  if (sn) sn.textContent = scenarioName || '—';
}
