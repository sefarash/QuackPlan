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

function _loadScenario(id) {
  dbGet(id).then(node => {
    if (!node || !node.data) return;
    const d = node.data;

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

      // Restore this scenario's output-panel control values (FF sliders, WOB,
      // MW/flow, casing SFs); resets to defaults when the scenario has none saved
      if (typeof loadOutputControls === 'function') loadOutputControls(d.outputControls);
    } finally {
      qpState.loadingScenario = false;   // an exception must not leave saves suppressed
    }

    // Persist last-used scenario ID so reload restores it
    localStorage.setItem('qp_lastScenarioId', id);

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
    dbAdd({ parentId: parentNode.id, name, type: childType }).then(hierarchyRefresh);
  });
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
