// ===== ROW DRAG =====
// Drag-to-reorder for any tbody. Drag only activates from a .drag-handle cell.

function makeRowsDraggable(tbodyId, callback) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  let dragSrc = null;

  // Only enable draggable on the row when mousedown starts on the handle
  tbody.addEventListener('mousedown', e => {
    if (e.target.closest('.drag-handle')) {
      const tr = e.target.closest('tr');
      if (tr) tr.draggable = true;
    }
  });

  // Remove draggable once pointer is released anywhere
  document.addEventListener('mouseup', () => {
    [...tbody.rows].forEach(r => r.removeAttribute('draggable'));
  }, { capture: true });

  tbody.addEventListener('dragstart', e => {
    dragSrc = e.target.closest('tr');
    if (!dragSrc) return;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => dragSrc.classList.add('row-dragging'), 0);
  });

  tbody.addEventListener('dragover', e => {
    if (!dragSrc) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const tr = e.target.closest('tr');
    if (!tr || tr === dragSrc) return;
    [...tbody.rows].forEach(r => r.classList.remove('row-drag-over'));
    tr.classList.add('row-drag-over');
  });

  tbody.addEventListener('dragleave', e => {
    if (!tbody.contains(e.relatedTarget)) {
      [...tbody.rows].forEach(r => r.classList.remove('row-drag-over'));
    }
  });

  tbody.addEventListener('drop', e => {
    if (!dragSrc) return;
    e.preventDefault();
    const target = e.target.closest('tr');
    if (!target || target === dragSrc) return;
    const rect = target.getBoundingClientRect();
    tbody.insertBefore(dragSrc, e.clientY < rect.top + rect.height / 2
      ? target : target.nextSibling);
    cleanup();
    if (callback) callback();
  });

  tbody.addEventListener('dragend', cleanup);

  function cleanup() {
    [...tbody.rows].forEach(r => {
      r.classList.remove('row-drag-over', 'row-dragging');
      r.removeAttribute('draggable');
    });
    dragSrc = null;
  }
}
