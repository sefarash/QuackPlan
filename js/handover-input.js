// ===== HANDOVER INPUT =====

const HANDOVER_DEFAULTS = [
  'Packer', 'Whipstock', 'Cement', 'Pump', 'Tubing', 'BPV', 'Fish',
];

function handoverAddRow(vals) {
  const body = document.getElementById('handoverBody');
  const tr   = document.createElement('tr');
  tr.innerHTML = `
    <td class="drag-handle">⠿</td>
    <td class="editable"><input type="text"   value="${vals?.element ?? ''}"  placeholder="Element"  onchange="handoverSave()"></td>
    <td class="editable"><input type="text"   value="${vals?.size    ?? ''}"  placeholder="Size/Type" onchange="handoverSave()"></td>
    <td class="editable"><input type="number" value="${vals?.topMD   ?? ''}"  step="1" placeholder="—" onchange="handoverSave()"></td>
    <td class="editable"><input type="number" value="${vals?.botMD   ?? ''}"  step="1" placeholder="—" onchange="handoverSave()"></td>
    <td class="row-act"><button onclick="this.closest('tr').remove();handoverSave()">✕</button></td>`;
  body.appendChild(tr);
}

function handoverGet() {
  const rows = [];
  for (const tr of document.getElementById('handoverBody').rows) {
    const inputs = tr.querySelectorAll('input');
    rows.push({
      element: inputs[0]?.value ?? '',
      size:    inputs[1]?.value ?? '',
      topMD:   inputs[2]?.value !== '' ? +inputs[2].value : null,
      botMD:   inputs[3]?.value !== '' ? +inputs[3].value : null,
    });
  }
  return rows;
}

function handoverSave() {
  if (!qpState.currentScenarioId) return;
  dbSaveScenarioData(qpState.currentScenarioId, 'handover', handoverGet());
}

function handoverLoadState(data) {
  const body = document.getElementById('handoverBody');
  body.innerHTML = '';
  const rows = (data && data.length) ? data
    : HANDOVER_DEFAULTS.map(name => ({ element: name, size: '', topMD: null, botMD: null }));
  rows.forEach(r => handoverAddRow(r));
}

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('handoverBody').rows.length) {
    handoverLoadState(null);  // seed defaults
  }
});
