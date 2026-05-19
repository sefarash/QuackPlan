// ===== HANDOVER INPUT =====

const HANDOVER_ELEMENTS = [
  'Packer', 'Whipstock', 'Cement', 'Pump', 'Tubing',
  'BPV', 'Fish', 'Bridge Plug', 'Liner', 'Perforation',
  'Plug', 'Screen', 'Valve',
];

function _hoElementOptions(selected) {
  const opts = HANDOVER_ELEMENTS.map(e =>
    `<option value="${e}"${selected === e ? ' selected' : ''}>${e}</option>`
  ).join('');
  const customSel = !HANDOVER_ELEMENTS.includes(selected) && selected ? ' selected' : '';
  return opts + `<option value="custom"${customSel}>Custom…</option>`;
}

function handoverAddRow(vals) {
  const body    = document.getElementById('handoverBody');
  const tr      = document.createElement('tr');
  const element = vals?.element ?? 'Packer';
  const isCustom = element && !HANDOVER_ELEMENTS.includes(element);
  const customVal = isCustom ? element : '';

  tr.innerHTML = `
    <td class="drag-handle">⠿</td>
    <td class="editable" style="white-space:nowrap">
      <select class="ho-el-sel" onchange="handoverElementChange(this)">${_hoElementOptions(isCustom ? 'custom' : element)}</select>
      <input  class="ho-el-txt" type="text" value="${customVal}"
              placeholder="specify…"
              style="display:${isCustom ? 'inline' : 'none'};width:80px;margin-left:4px"
              onchange="handoverSave()">
    </td>
    <td class="editable"><input type="text"   value="${vals?.size  ?? ''}"  placeholder="Size/Type" onchange="handoverSave()"></td>
    <td class="editable"><input type="number" value="${vals?.topMD ?? ''}"  step="1" placeholder="—" onchange="handoverSave()"></td>
    <td class="editable"><input type="number" value="${vals?.botMD ?? ''}"  step="1" placeholder="—" onchange="handoverSave()"></td>
    <td class="row-act"><button onclick="this.closest('tr').remove();handoverSave()">✕</button></td>`;
  body.appendChild(tr);
}

function handoverElementChange(sel) {
  const txt = sel.parentElement.querySelector('.ho-el-txt');
  if (txt) {
    txt.style.display = sel.value === 'custom' ? 'inline' : 'none';
    if (sel.value === 'custom') { txt.value = ''; txt.focus(); }
  }
  handoverSave();
}

function handoverGet() {
  const rows = [];
  for (const tr of document.getElementById('handoverBody').rows) {
    const sel    = tr.querySelector('.ho-el-sel');
    const txt    = tr.querySelector('.ho-el-txt');
    const inputs = tr.querySelectorAll('input[type=text]:not(.ho-el-txt), input[type=number]');
    const element = sel?.value === 'custom' ? (txt?.value ?? '') : (sel?.value ?? '');
    rows.push({
      element,
      size:  inputs[0]?.value ?? '',
      topMD: inputs[1]?.value !== '' ? +inputs[1].value : null,
      botMD: inputs[2]?.value !== '' ? +inputs[2].value : null,
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
    : HANDOVER_ELEMENTS.slice(0, 7).map(name => ({ element: name, size: '', topMD: null, botMD: null }));
  rows.forEach(r => handoverAddRow(r));
}

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('handoverBody').rows.length) {
    handoverLoadState(null);  // seed defaults
  }
});
