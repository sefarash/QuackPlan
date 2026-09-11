// ===== PROJECT HIERARCHY UI =====
// Renders the left-panel tree; drives the name modal for create/rename/delete.

const NODE_TYPES = ['project', 'field', 'well', 'borehole', 'scenario'];
const NODE_LABELS = {
  project:  '📁',
  field:    '🗺',
  well:     '🛢',
  borehole: '🔩',
  scenario: '📄',
};

let _modalCallback = null;   // fn(name) called on OK
let _editNodeId    = null;   // non-null when renaming

// ── Gate: controls input access based on selection level ─────────────────────
//
//  Levels:
//    locked   — nothing / project / field / well selected
//               → full overlay, Run disabled, all tabs inaccessible
//    borehole — borehole selected (no scenario)
//               → overlay hidden, Trajectory / Well Schematic / PPFG / Activity active
//               → Casing/BHA + Drilling Fluid grayed out, Run disabled
//    scenario — scenario selected
//               → all tabs active, Run enabled
//
function _updateGate() {
  const hasScenario = !!qpState.currentScenarioId;
  const hasBorehole = !!qpState.currentBoreholeId;
  const locked      = !hasBorehole && !hasScenario;

  // ── Overlay ──
  const overlay = document.getElementById('gateOverlay');
  const center  = document.getElementById('centerPanel');
  if (overlay) overlay.classList.toggle('active', locked);
  if (center) {
    center.classList.toggle('locked', locked);
    if (locked) center.scrollTop = 0;
  }

  qpUpdateDataBanner();
  qpPlaceSchematicEditor();

  // ── Run button ──
  const runBtn = document.querySelector('.hdr-btn.primary');
  if (runBtn) {
    const runLocked = !hasScenario;
    runBtn.disabled          = runLocked;
    runBtn.style.opacity     = runLocked ? '0.35' : '';
    runBtn.style.cursor      = runLocked ? 'not-allowed' : '';
  }

  // ── Per-tab access ──
  _setTabDisabled('tabBha',   !hasScenario);
  _setTabDisabled('tabFluid', !hasScenario);

  // If the active tab just became disabled, fall back to Trajectory
  const activeTab = qpState.activeInputTab;
  if (!hasScenario && (activeTab === 'bha' || activeTab === 'fluid')) {
    const trajBtn = document.querySelector('#inputTabs .input-tab');
    if (trajBtn) switchInputTab('trajectory', trajBtn);
  }
}

function _setTabDisabled(id, disabled) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = disabled;
  btn.classList.toggle('tab-disabled', disabled);
}

// Collapsed node IDs persisted in localStorage
const _collapsed = new Set(
  JSON.parse(localStorage.getItem('qp_collapsed') || '[]')
);
function _saveCollapsed() {
  localStorage.setItem('qp_collapsed', JSON.stringify([..._collapsed]));
}

// ── Tree rendering ────────────────────────────────────────────────────────────

let _treeRetryTimer = null;
function hierarchyRefresh() {
  return dbRoots().then(roots => {
    if (_treeRetryTimer) { clearTimeout(_treeRetryTimer); _treeRetryTimer = null; }
    const container = document.getElementById('hierarchyTree');
    container.innerHTML = '';
    if (!roots.length) {
      container.innerHTML = '<div class="tree-empty">No projects yet.<br>Click + to create one.</div>';
      return;
    }
    roots.forEach(r => _renderNode(container, r, 0));
  }).catch(err => {
    // NEVER show "No projects yet" because a fetch failed — that reads as
    // "all my data is gone". Say the truth and keep retrying.
    console.error('hierarchyRefresh error:', err);
    const container = document.getElementById('hierarchyTree');
    if (container) {
      container.innerHTML = '<div class="tree-empty" style="color:#b07800">⚠ Can\'t reach the server.<br>' +
        'Your data is safe — retrying…</div>';
    }
    if (!_treeRetryTimer) {
      _treeRetryTimer = setTimeout(() => { _treeRetryTimer = null; hierarchyRefresh(); }, 5000);
    }
  });
}

function _renderNode(parent, node, depth) {
  const item = document.createElement('div');

  const row = document.createElement('div');
  row.className = 'tree-node';
  row.dataset.level = depth;
  row.dataset.id    = node.id;

  const isActive = node.id === qpState.currentScenarioId
                || node.id === qpState.currentBoreholeId
                || node.id === qpState.currentWellId;
  if (isActive) row.classList.add('active');

  // Collapse toggle arrow — hidden until children are known
  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle';
  toggle.textContent = _collapsed.has(node.id) ? '▶' : '▼';
  toggle.style.visibility = 'hidden';

  const icon  = NODE_LABELS[node.type] || '•';
  const label = document.createElement('span');
  label.className = 'tree-label';
  let labelText = icon + ' ' + node.name;
  if (node.type === 'well' && node.data) {
    const { rkb, gl } = node.data;
    if (rkb != null && gl != null)
      labelText += ` — RKB ${rkb}ft / GL ${gl}ft MSL`;
  }
  label.textContent = labelText;
  label.onclick = () => _selectNode(node);

  const actions = document.createElement('span');
  actions.className = 'tree-actions';

  const typeIdx = NODE_TYPES.indexOf(node.type);
  if (typeIdx < NODE_TYPES.length - 1) {
    const addBtn = document.createElement('button');
    addBtn.textContent = '+';
    addBtn.title = 'Add ' + NODE_TYPES[typeIdx + 1];
    addBtn.onclick = e => { e.stopPropagation(); _promptAdd(node); };
    actions.appendChild(addBtn);
  }

  const renBtn = document.createElement('button');
  renBtn.textContent = '✎';
  renBtn.title = 'Rename';
  renBtn.onclick = e => { e.stopPropagation(); _promptRename(node); };
  actions.appendChild(renBtn);

  const delBtn = document.createElement('button');
  delBtn.textContent = '✕';
  delBtn.title = 'Delete';
  delBtn.onclick = e => { e.stopPropagation(); _confirmDelete(node); };
  actions.appendChild(delBtn);

  row.appendChild(toggle);
  row.appendChild(label);
  row.appendChild(actions);
  item.appendChild(row);
  parent.appendChild(item);

  // Children wrapper — collapsible
  const childWrap = document.createElement('div');
  childWrap.className = 'tree-children';
  if (_collapsed.has(node.id)) childWrap.style.display = 'none';
  item.appendChild(childWrap);

  toggle.onclick = e => {
    e.stopPropagation();
    if (_collapsed.has(node.id)) {
      _collapsed.delete(node.id);
      childWrap.style.display = '';
      toggle.textContent = '▼';
    } else {
      _collapsed.add(node.id);
      childWrap.style.display = 'none';
      toggle.textContent = '▶';
    }
    _saveCollapsed();
  };

  dbChildren(node.id).then(children => {
    if (!children.length) return;
    toggle.style.visibility = 'visible';
    children.sort((a, b) => a.name.localeCompare(b.name));
    children.forEach(c => _renderNode(childWrap, c, depth + 1));
  });
}

// ── Node selection ────────────────────────────────────────────────────────────

function _selectNode(node) {
  if (node.type === 'scenario') {
    qpState.currentScenarioId = node.id;
    qpState.currentBoreholeId = node.parentId;
    // Walk up borehole → well to get name and datums
    dbGet(node.parentId).then(bh => bh ? dbGet(bh.parentId) : null).then(well => {
      setHeaderContext(well ? well.name : '?', node.name);
      _applyWellDatums(well);
    });
    _loadScenario(node.id);

  } else if (node.type === 'borehole') {
    qpState.currentBoreholeId = node.id;
    qpState.currentScenarioId = null;
    // Walk up to well for datums
    dbGet(node.parentId).then(well => {
      setHeaderContext(well ? well.name : '?', node.name);
      _applyWellDatums(well);
    });
    _loadBorehole(node.id);

  } else if (node.type === 'well') {
    qpState.currentWellId     = node.id;
    qpState.currentBoreholeId = null;
    qpState.currentScenarioId = null;
    setHeaderContext(node.name, '—');
    _applyWellDatums(node);

  } else {
    // project or field — clear everything below
    qpState.currentBoreholeId = null;
    qpState.currentScenarioId = null;
    setHeaderContext('No well selected', '—');
  }

  _updateGate();
  hierarchyRefresh();
}

function _applyWellDatums(wellNode) {
  const d = wellNode?.data || {};
  if (d.rkb != null) {
    qpState.wellDatums = {
      environment:  d.environment  || 'onshore',
      rkb:          +d.rkb,
      gl:           d.gl           != null ? +d.gl           : 0,
      seaBedDepth:  d.seaBedDepth  != null ? +d.seaBedDepth  : 0,
    };
  } else {
    qpState.wellDatums = null;
  }
  if (qpState.survey?.length > 1) drawSchematic(qpState.survey);
  if (typeof drawDatumDiagram === 'function') drawDatumDiagram();
}

// ── Casing program placement ─────────────────────────────────────────────────
// The schematic editor (#schematicEditor: table + buttons + warnings) is ONE DOM
// block. Borehole selected → it sits on the Well Schematic tab and edits the
// borehole definition. Scenario open → it is moved into the Casing / BHA tab
// above the BHA and edits the scenario's own copy (inherited from the borehole
// until the first edit, which forks it — qpSaveTarget), while the Well
// Schematic tab shows the borehole definition read-only.
function qpPlaceSchematicEditor() {
  const editor = document.getElementById('schematicEditor');
  const home   = document.getElementById('schematicHome');
  const host   = document.getElementById('schematicSlotHost');
  const slot   = document.getElementById('schematicScenarioSlot');
  const view   = document.getElementById('schematicBoreholeView');
  if (!editor || !home || !host || !slot || !view) return;
  if (qpState.currentScenarioId) {
    if (editor.parentElement !== host) host.appendChild(editor);
    slot.hidden = false; view.hidden = false; home.hidden = true;
    _renderBoreholeSchematicView();
  } else {
    if (editor.parentElement !== home) home.appendChild(editor);
    slot.hidden = true; view.hidden = true; home.hidden = false;
  }
  _updateSchematicSlotNote();
}

function _updateSchematicSlotNote() {
  const el = document.getElementById('schematicSlotNote');
  if (!el) return;
  el.textContent = (qpState.inherited && qpState.inherited.schematic)
    ? 'Inherited from the borehole definition — edit any cell to give this scenario its own casing program.'
    : 'This scenario\'s own casing program. The borehole definition (Well Schematic tab) is not affected by edits here.';
}

function _renderBoreholeSchematicView() {
  const host = document.getElementById('schematicBoreholeTable');
  if (!host) return;
  const rows = qpState.boreholeSchematic || [];
  const uD = QP_UNITS.label('depth');
  const dep = v => (v === '' || v == null) ? '—' : Math.round(QP_UNITS.toDisplay('depth', +v)).toLocaleString();
  const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  if (!rows.length) {
    host.innerHTML = '<p class="text-dim" style="padding:6px 0">The borehole has no casing program yet — add one at the borehole, or build this scenario\'s own on the Casing / BHA tab.</p>';
    return;
  }
  const wt = r => r.wt === 'custom' ? r.wtCustom : r.wt, gr = r => r.grade === 'custom' ? r.gradeCustom : r.grade;
  host.innerHTML = `<table class="qp-table" style="max-width:900px"><thead><tr>
      <th style="text-align:left">Definition</th><th>OD (in)</th><th>Weight</th><th>Grade</th><th>Hole (in)</th>
      <th>MD Top (${uD})</th><th>MD Bottom (${uD})</th><th>TOC (${uD})</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td style="text-align:left">${esc(r.def)}</td><td>${esc(r.size)}</td>
      <td>${wt(r) ? esc(wt(r)) + ' lb/ft' : '—'}</td><td>${esc(gr(r) || '—')}</td><td>${r.hole > 0 ? esc(r.hole) : '—'}</td>
      <td>${dep(r.top)}</td><td>${dep(r.bot)}</td><td>${dep(r.toc)}</td></tr>`).join('') + '</tbody></table>';
}

// "Edit at the borehole" — open the parent borehole node
function hierarchyOpenBorehole() {
  const bh = qpState.currentBoreholeId;
  if (!bh) return;
  dbGet(bh).then(node => { if (node) _selectNode(node); });
}

// Replace this scenario's casing program with the borehole definition (a
// write into the scenario's own copy — the borehole is untouched).
function schematicResetToBorehole() {
  if (!qpState.currentScenarioId) return;
  const rows = qpState.boreholeSchematic || [];
  if (!confirm(rows.length
    ? `Replace this scenario's casing program with the borehole definition (${rows.length} row${rows.length === 1 ? '' : 's'})?`
    : 'The borehole has no casing program; this will clear the scenario\'s copy. Continue?')) return;
  qpState.loadingScenario = true;                     // rebuild without per-row writes …
  try { schematicLoadRows(rows); } finally { qpState.loadingScenario = false; }
  schematicSave();                                    // … then ONE full save into the scenario
  qpUpdateDataBanner();
}

// Info strip above the input panels: where borehole-level data is going.
function qpUpdateDataBanner() {
  _updateSchematicSlotNote();
  const banner = document.getElementById('scenarioBanner');
  if (!banner) return;
  const text = banner.querySelector('.banner-text'), btn = banner.querySelector('.banner-btn');
  const hasScenario = !!qpState.currentScenarioId, hasBorehole = !!qpState.currentBoreholeId;
  // Only while an input panel is showing: output panels are absolutely
  // positioned over the centre column and their control bar sat on the text.
  if (!qpState.activeInputTab) { banner.hidden = true; return; }
  const NAMES = { traj1: 'trajectory', traj2: 'trajectory', trajOpt: '', tort: 'tortuosity', schematic: 'schematic', ppfg: 'PPFG', activity: 'activity', handover: 'handover' };
  if (hasBorehole && !hasScenario) {
    banner.hidden = false; banner.classList.add('info');
    if (text) text.innerHTML = '<strong>Building at the borehole.</strong> Trajectory, schematic, PPFG and activity are saved to the borehole and shared by every scenario under it. Add a scenario for Casing/BHA, drilling fluid and the results.';
    if (btn) btn.hidden = false;
    return;
  }
  const inh = [...new Set(Object.keys(qpState.inherited || {}).filter(k => qpState.inherited[k] && NAMES[k]).map(k => NAMES[k]))];
  if (hasScenario && inh.length) {
    banner.hidden = false; banner.classList.add('info');
    if (text) text.innerHTML = `<strong>Shared from the borehole:</strong> ${inh.join(', ')}. Edit them at the borehole to change every scenario; editing here gives this scenario its own copy.`;
    if (btn) btn.hidden = true;
    return;
  }
  banner.hidden = true;
}

// Borehole selected: show and edit the borehole's own data (trajectory,
// schematic, PPFG, activity, handover). Scenario-only panels are cleared and
// results dropped so nothing stale from the last scenario is on screen.
function _loadBorehole(id) {
  dbGet(id).then(node => {
    if (!node) return;
    const d = node.data || {};
    qpState.loadingScenario = true;            // RULE #1: loads never write
    try {
      if (typeof CI !== 'undefined' && CI.clearAll) CI.clearAll();
      ['traj1Body', 'traj2Body', 'tortBody', 'schematicBody', 'bhaBody', 'nozzleBody', 'mwdBody',
       'activityBody', 'servicesBody', 'casingCostBody', 'handoverBody'].forEach(i => { const el = document.getElementById(i); if (el) el.innerHTML = ''; });
      qpState.inherited = {};
      qpState.boreholeSchematic = d.schematic || [];
      if (d.traj1 && d.traj1.length) trajLoadRows(d.traj1);
      else { traj1AddRow({ md: 0, inc: 0, azi: 0 }); traj1AddRow({ md: 5000, inc: 0, azi: 0 }); }
      if (d.traj2 && d.traj2.length) traj2LoadRows(d.traj2);
      if (typeof trajApplySource === 'function') trajApplySource(d.trajOpt);
      schematicLoadRows(d.schematic || []);
      if (d.tort) tortLoadState(d.tort);
      if (d.activity) activityLoadState(d.activity);
      handoverLoadState(d.handover);
      ppfgLoadState(d.ppfg || []);
      qpState.tdResult = null; qpState.hydResult = null;
      if (typeof qpPhaseRebuildSelector === 'function') qpPhaseRebuildSelector();
    } finally {
      qpState.loadingScenario = false;
    }
    qpPlaceSchematicEditor();
    qpUpdateDataBanner();
    if (qpState.activeOutputTab && typeof redrawOutputPanel === 'function') redrawOutputPanel(qpState.activeOutputTab);
    setStatus('Borehole loaded');
  }).catch(err => {
    console.error('_loadBorehole failed:', err);
    setStatus('⚠ Couldn\'t load the borehole — your data is safe, retrying…', true);
    setTimeout(() => { if (qpState.currentBoreholeId === id && !qpState.currentScenarioId) _loadBorehole(id); }, 4000);
  });
}

function _loadScenario(id) {
  dbGet(id).then(async node => {
    if (!node || !node.data) return;
    // Borehole-level keys the scenario lacks come from its borehole (display
    // only — nothing is written; a scenario edit forks its own copy).
    const bh = node.parentId ? await dbGet(node.parentId).catch(() => null) : null;
    const merged = qpMergeBoreholeData(node.data, bh?.data);
    const d = merged.data;
    qpState.inherited = merged.inherited;
    qpState.boreholeSchematic = (bh && bh.data && bh.data.schematic) || [];

    // RULE #1: the loaders below rebuild the tables via the same AddRow helpers
    // the user clicks, and those fire saves — a load must NEVER write back over
    // the stored data (a burst of partial per-row saves arriving out of order
    // at the server truncated arrays). dbSaveScenarioData drops all writes
    // while this flag is set.
    qpState.loadingScenario = true;
    try {
      // Clear frozen chart snapshots / annotations so one well's overlays don't
      // ghost onto the next scenario's charts
      if (typeof CI !== 'undefined' && CI.clearAll) CI.clearAll();

      // Clear all tables first so stale rows don't persist
      document.getElementById('traj1Body').innerHTML      = '';
      document.getElementById('traj2Body').innerHTML      = '';
      document.getElementById('tortBody').innerHTML       = '';
      document.getElementById('schematicBody').innerHTML  = '';
      document.getElementById('bhaBody').innerHTML        = '';
      document.getElementById('nozzleBody').innerHTML     = '';
      document.getElementById('mwdBody').innerHTML        = '';
      document.getElementById('activityBody').innerHTML   = '';
      document.getElementById('servicesBody').innerHTML   = '';
      document.getElementById('casingCostBody').innerHTML = '';
      document.getElementById('handoverBody').innerHTML   = '';

      if (d.traj1 && d.traj1.length) {
        trajLoadRows(d.traj1);
      } else {
        // No saved trajectory — seed with two default stations
        traj1AddRow({ md: 0,    inc: 0, azi: 0 });
        traj1AddRow({ md: 5000, inc: 0, azi: 0 });
      }
      if (d.traj2 && d.traj2.length) traj2LoadRows(d.traj2);
      // The survey source is explicit ('trajOpt'); legacy scenarios keep the old
      // precedence (Option 2 wins when it has a survey). Runs under the load
      // guard, so nothing is written.
      if (typeof trajApplySource === 'function') trajApplySource(d.trajOpt);
      if (d.schematic) schematicLoadRows(d.schematic);
      if (d.fluid)     fluidLoadState(d.fluid);
      if (d.bha)       bhaLoadState(d.bha);
      if (d.nozzles)   nozzleLoadState(d.nozzles);
                       mwdLoadState(d.mwd);
      if (d.tort)      tortLoadState(d.tort);
      if (d.activity)  activityLoadState(d.activity);
                       handoverLoadState(d.handover);
      if (d.ppfg)      ppfgLoadState(d.ppfg);
      cdRatingsLoadState(d.cdRatings);

      // Analysis phases derive from the schematic just loaded; the fluid
      // program (additive key) fills its per-section rows from stored data
      if (typeof qpPhaseRebuildSelector === 'function') qpPhaseRebuildSelector();
      if (typeof fluidProgramLoadState === 'function') fluidProgramLoadState(d.fluidProgram);

      // Restore this scenario's output-panel control values (FF sliders, WOB,
      // MW/flow, casing SFs); resets to defaults when the scenario has none saved
      if (typeof loadOutputControls === 'function') loadOutputControls(d.outputControls);
      // loadOutputControls restored the saved phase selection — validate + mirror
      const _ps = document.getElementById('phaseSelect');
      if (_ps && ![..._ps.options].some(o => o.value === _ps.value)) _ps.value = 'full';
      qpState.activePhase = _ps?.value || 'full';
    } finally {
      qpState.loadingScenario = false;   // an exception must not leave saves suppressed
    }

    // Persist last-used scenario ID so reload restores it
    localStorage.setItem('qp_lastScenarioId', id);

    qpPlaceSchematicEditor();
    qpUpdateDataBanner();
    setStatus('Scenario loaded');
  }).catch(err => {
    // A failed load must say so and retry — never leave silently-empty panels.
    console.error('_loadScenario failed:', err);
    setStatus('⚠ Couldn\'t load the scenario — your data is safe, retrying…', true);
    setTimeout(() => { if (qpState.currentScenarioId === id) _loadScenario(id); }, 4000);
  });
}

// ── Modal helpers ─────────────────────────────────────────────────────────────

function showNewProjectModal() {
  _editNodeId = null;
  _openModal('New Project', 'Project name', name => {
    dbAdd({ parentId: null, name, type: 'project' }).then(hierarchyRefresh);
  });
}

function _promptAdd(parentNode) {
  const childType = NODE_TYPES[NODE_TYPES.indexOf(parentNode.type) + 1];
  if (childType === 'well') { _openWellModal(parentNode.id); return; }
  _editNodeId = null;
  _openModal('New ' + _cap(childType), _cap(childType) + ' name', name => {
    if (childType === 'scenario') { hierarchyAddScenario(parentNode.id, name); return; }
    dbAdd({ parentId: parentNode.id, name, type: childType }).then(hierarchyRefresh);
  });
}

// Create a scenario and OPEN it. RULE #1 incident (2026-09-06): a new scenario
// was created but not selected; the user typed a trajectory with only the
// borehole selected, the tables accepted it, and nothing was saved (there was
// no scenario to save into). A new scenario is now selected immediately.
function hierarchyAddScenario(boreholeId, name) {
  return dbAdd({ parentId: boreholeId, name, type: 'scenario' }).then(id => {
    _selectNode({ id, type: 'scenario', parentId: boreholeId, name });
    return id;
  });
}

// Banner button: add a scenario under the currently selected borehole.
function hierarchyAddScenarioHere() {
  const bh = qpState.currentBoreholeId;
  if (!bh) return;
  dbGet(bh).then(node => { if (node) _promptAdd(node); });
}

// ── Well creation modal ───────────────────────────────────────────────────────

let _wellModalParentId = null;

function _openWellModal(parentId) {
  _wellModalParentId = parentId;
  const inputs = ['wellModalName', 'wellModalRKB', 'wellModalGL', 'wellModalSeaBed'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.style.outline = ''; }
  });
  const onshore = document.getElementById('wellModalEnvOnshore');
  if (onshore) onshore.checked = true;
  wellModalSetEnv('onshore');
  document.getElementById('wellModal').classList.add('open');
  setTimeout(() => document.getElementById('wellModalName').focus(), 50);
}

function wellModalSetEnv(env) {
  const onRow  = document.getElementById('wellModalOnshoreRow');
  const offRow = document.getElementById('wellModalOffshoreRow');
  const rkbUnit = document.getElementById('wellModalRKBUnit');
  const hint    = document.getElementById('wellModalHint');
  if (env === 'offshore') {
    if (onRow)  onRow.style.display  = 'none';
    if (offRow) offRow.style.display = '';
    if (rkbUnit) rkbUnit.textContent = 'ft above sea level';
    if (hint) hint.textContent = 'RKB elevation above MSL = RKB above sea level';
  } else {
    if (onRow)  onRow.style.display  = '';
    if (offRow) offRow.style.display = 'none';
    if (rkbUnit) rkbUnit.textContent = 'ft above ground';
    if (hint) hint.textContent = 'RKB elevation above MSL = GL + RKB above ground';
  }
}

function closeWellModal() {
  document.getElementById('wellModal').classList.remove('open');
  _wellModalParentId = null;
}

function wellModalConfirm() {
  const nameEl = document.getElementById('wellModalName');
  const rkbEl  = document.getElementById('wellModalRKB');
  const env    = (document.querySelector('input[name="wellModalEnv"]:checked') || {}).value || 'onshore';
  const depthEl = env === 'offshore'
    ? document.getElementById('wellModalSeaBed')
    : document.getElementById('wellModalGL');

  const name  = nameEl.value.trim();
  const rkb   = rkbEl.value.trim();
  const depth = depthEl ? depthEl.value.trim() : '';

  let firstInvalid = null;
  [[nameEl, name === ''], [rkbEl, rkb === ''], [depthEl, depth === '']].forEach(([el, bad]) => {
    if (!el) return;
    el.style.outline = bad ? '2px solid #c0392b' : '';
    if (bad && !firstInvalid) firstInvalid = el;
  });
  if (firstInvalid) { firstInvalid.focus(); return; }

  const wellData = { environment: env, rkb: +rkb };
  if (env === 'offshore') wellData.seaBedDepth = +depth;
  else                    wellData.gl          = +depth;

  const parentId = _wellModalParentId;
  closeWellModal();
  dbAdd({ parentId, name, type: 'well', data: wellData }).then(hierarchyRefresh);
}

function _promptRename(node) {
  _editNodeId = node.id;
  _openModal('Rename', 'New name', name => {
    dbRename(node.id, name).then(hierarchyRefresh);
  }, node.name);
}

function _confirmDelete(node) {
  if (!confirm('Delete "' + node.name + '" and all its children?')) return;
  if (node.id === qpState.currentScenarioId)  qpState.currentScenarioId  = null;
  if (node.id === qpState.currentBoreholeId) qpState.currentBoreholeId = null;
  if (node.id === qpState.currentWellId)     qpState.currentWellId     = null;
  // Deleting a borehole also invalidates any child scenario
  if (node.type === 'borehole') qpState.currentScenarioId = null;
  dbDelete(node.id).then(() => {
    setHeaderContext('No well selected', '—');
    _updateGate();
    hierarchyRefresh();
    // Deleted the open scenario: fall back to its borehole's own data
    if (node.type === 'scenario' && qpState.currentBoreholeId && !qpState.currentScenarioId) {
      dbGet(qpState.currentBoreholeId).then(bh => { if (bh) _selectNode(bh); });
    }
  });
}

function _openModal(title, label, callback, prefill) {
  document.getElementById('nameModalTitle').textContent = title;
  document.getElementById('nameModalLabel').textContent = label;
  const input = document.getElementById('nameModalInput');
  input.value = prefill || '';
  _modalCallback = callback;
  document.getElementById('nameModal').classList.add('open');
  setTimeout(() => input.focus(), 50);
}

function closeNameModal() {
  document.getElementById('nameModal').classList.remove('open');
  _modalCallback = null;
}

function nameModalConfirm() {
  const name = document.getElementById('nameModalInput').value.trim();
  if (!name) return;
  const cb = _modalCallback;   // capture before closeNameModal clears it
  closeNameModal();
  if (cb) cb(name);
}

// Allow Enter key in modal
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('nameModalInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') nameModalConfirm();
    if (e.key === 'Escape') closeNameModal();
  });

  ['wellModalName', 'wellModalRKB', 'wellModalGL'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter')  wellModalConfirm();
      if (e.key === 'Escape') closeWellModal();
    });
  });

  // Data loading is deferred until the user is authenticated — auth-ui.js calls
  // hierarchyBoot() once a session is established (so no API call fires with no
  // token). See js/auth-ui.js.
});

// Load the tree + restore the last-opened scenario. Called after login.
function hierarchyBoot() {
  hierarchyRefresh();
  // First-time users: offer the guided tour once (QP_TOUR checks its own flag)
  if (typeof QP_TOUR !== 'undefined') setTimeout(() => QP_TOUR.offer(), 600);

  const lastId = +localStorage.getItem('qp_lastScenarioId');
  if (lastId) {
    dbGet(lastId).then(node => {
      if (!node) { _updateGate(); return; }
      qpState.currentScenarioId = lastId;
      _loadScenario(lastId);
      dbGet(node.parentId)
        .then(bh => bh ? dbGet(bh.parentId) : null)
        .then(well => {
          setHeaderContext(well?.name || '?', node.name);
          _applyWellDatums(well);
        });
      _updateGate();
      hierarchyRefresh();
    }).catch(() => _updateGate());
  } else {
    _updateGate();
  }
}

function _cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
