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
  // item = container for this row + its children (block, not flex)
  const item = document.createElement('div');

  // row = the clickable flex strip
  const row = document.createElement('div');
  row.className = 'tree-node';
  row.dataset.level = depth;
  row.dataset.id    = node.id;

  const isActive = node.id === qpState.currentScenarioId
                || node.id === qpState.currentWellId;
  if (isActive) row.classList.add('active');

  const icon  = NODE_LABELS[node.type] || '•';
  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = icon + ' ' + node.name;
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

  row.appendChild(label);
  row.appendChild(actions);
  item.appendChild(row);
  parent.appendChild(item);

  // Children are appended to item (sibling to row), not inside the flex row
  dbChildren(node.id).then(children => {
    if (!children.length) return;
    children.sort((a, b) => a.name.localeCompare(b.name));
    children.forEach(c => _renderNode(item, c, depth + 1));
  });
}

// ── Node selection ────────────────────────────────────────────────────────────

function _selectNode(node) {
  if (node.type === 'scenario') {
    qpState.currentScenarioId = node.id;
    // Walk up to find well name
    dbGet(node.parentId).then(bh => {
      if (!bh) return;
      return dbGet(bh.parentId);
    }).then(well => {
      setHeaderContext(well ? well.name : '?', node.name);
    });
    // Load scenario data into UI
    _loadScenario(node.id);
  } else if (node.type === 'well') {
    qpState.currentWellId = node.id;
    setHeaderContext(node.name, '—');
  }
  hierarchyRefresh();
}

function _loadScenario(id) {
  dbGet(id).then(node => {
    if (!node || !node.data) return;
    const d = node.data;

    // Clear all tables first so stale rows don't persist
    document.getElementById('traj1Body').innerHTML      = '';
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
  _editNodeId = null;
  _openModal('New ' + _cap(childType), _cap(childType) + ' name', name => {
    dbAdd({ parentId: parentNode.id, name, type: childType }).then(hierarchyRefresh);
  });
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

  hierarchyRefresh();

  // Restore last selected scenario after tree is rendered
  const lastId = +localStorage.getItem('qp_lastScenarioId');
  if (lastId) {
    dbGet(lastId).then(node => {
      if (!node) return;
      qpState.currentScenarioId = lastId;
      _loadScenario(lastId);
      // Restore header context
      dbGet(node.parentId).then(bh => bh && dbGet(bh.parentId)).then(well => {
        setHeaderContext(well?.name || '?', node.name);
      });
      hierarchyRefresh();
    });
  }
});

function _cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
