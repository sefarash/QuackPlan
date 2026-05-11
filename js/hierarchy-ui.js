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

// Collapsed node IDs persisted in localStorage
const _collapsed = new Set(
  JSON.parse(localStorage.getItem('qp_collapsed') || '[]')
);
function _saveCollapsed() {
  localStorage.setItem('qp_collapsed', JSON.stringify([..._collapsed]));
}

// ── Tree rendering ────────────────────────────────────────────────────────────

function hierarchyRefresh() {
  dbRoots().then(roots => {
    const container = document.getElementById('hierarchyTree');
    container.innerHTML = '';
    if (!roots.length) {
      container.innerHTML = '<div class="tree-empty">No projects yet.<br>Click + to create one.</div>';
      return;
    }
    roots.forEach(r => _renderNode(container, r, 0));
  }).catch(err => console.error('hierarchyRefresh error:', err));
}

function _renderNode(parent, node, depth) {
  const item = document.createElement('div');

  const row = document.createElement('div');
  row.className = 'tree-node';
  row.dataset.level = depth;
  row.dataset.id    = node.id;

  const isActive = node.id === qpState.currentScenarioId
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
    // Walk up borehole → well to get name and datums
    dbGet(node.parentId).then(bh => bh ? dbGet(bh.parentId) : null).then(well => {
      setHeaderContext(well ? well.name : '?', node.name);
      _applyWellDatums(well);
    });
    _loadScenario(node.id);
  } else if (node.type === 'well') {
    qpState.currentWellId = node.id;
    setHeaderContext(node.name, '—');
    _applyWellDatums(node);
  }
  hierarchyRefresh();
}

function _applyWellDatums(wellNode) {
  const d = wellNode?.data || {};
  qpState.wellDatums = (d.rkb != null && d.gl != null)
    ? { rkb: +d.rkb, gl: +d.gl } : null;
  if (qpState.survey?.length > 1) drawSchematic(qpState.survey);
}

function _loadScenario(id) {
  dbGet(id).then(node => {
    if (!node || !node.data) return;
    const d = node.data;

    // Clear all tables first so stale rows don't persist
    document.getElementById('traj1Body').innerHTML      = '';
    document.getElementById('traj2Body').innerHTML      = '';
    document.getElementById('schematicBody').innerHTML  = '';
    document.getElementById('bhaBody').innerHTML        = '';
    document.getElementById('nozzleBody').innerHTML     = '';
    document.getElementById('activityBody').innerHTML   = '';
    document.getElementById('servicesBody').innerHTML   = '';

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
    if (d.activity)  activityLoadState(d.activity);
    if (d.ppfg)      ppfgLoadState(d.ppfg);

    // Persist last-used scenario ID so reload restores it
    localStorage.setItem('qp_lastScenarioId', id);

    setStatus('Scenario loaded');
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
  const inputs = ['wellModalName', 'wellModalRKB', 'wellModalGL'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.style.outline = ''; }
  });
  document.getElementById('wellModal').classList.add('open');
  setTimeout(() => document.getElementById('wellModalName').focus(), 50);
}

function closeWellModal() {
  document.getElementById('wellModal').classList.remove('open');
  _wellModalParentId = null;
}

function wellModalConfirm() {
  const nameEl = document.getElementById('wellModalName');
  const rkbEl  = document.getElementById('wellModalRKB');
  const glEl   = document.getElementById('wellModalGL');

  const name = nameEl.value.trim();
  const rkb  = rkbEl.value.trim();
  const gl   = glEl.value.trim();

  // Validate — highlight missing fields and block
  let firstInvalid = null;
  [[nameEl, name === ''], [rkbEl, rkb === ''], [glEl, gl === '']].forEach(([el, bad]) => {
    el.style.outline = bad ? '2px solid #c0392b' : '';
    if (bad && !firstInvalid) firstInvalid = el;
  });
  if (firstInvalid) { firstInvalid.focus(); return; }

  const parentId = _wellModalParentId;
  closeWellModal();
  dbAdd({
    parentId,
    name,
    type: 'well',
    data: { rkb: +rkb, gl: +gl },
  }).then(hierarchyRefresh);
}

function _promptRename(node) {
  _editNodeId = node.id;
  _openModal('Rename', 'New name', name => {
    dbRename(node.id, name).then(hierarchyRefresh);
  }, node.name);
}

function _confirmDelete(node) {
  if (!confirm('Delete "' + node.name + '" and all its children?')) return;
  if (node.id === qpState.currentScenarioId) qpState.currentScenarioId = null;
  if (node.id === qpState.currentWellId)     qpState.currentWellId     = null;
  dbDelete(node.id).then(() => {
    setHeaderContext('No well selected', '—');
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

  hierarchyRefresh();

  // Restore last selected scenario after tree is rendered
  const lastId = +localStorage.getItem('qp_lastScenarioId');
  if (lastId) {
    dbGet(lastId).then(node => {
      if (!node) return;
      qpState.currentScenarioId = lastId;
      _loadScenario(lastId);
      // Restore header context and well datums
      dbGet(node.parentId)
        .then(bh => bh ? dbGet(bh.parentId) : null)
        .then(well => {
          setHeaderContext(well?.name || '?', node.name);
          _applyWellDatums(well);
        });
      hierarchyRefresh();
    });
  }
});

function _cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
