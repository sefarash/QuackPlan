// ===== ACTIVITY INPUT =====

function activityAddRow() {
  const body = document.getElementById('activityBody');
  const tr   = document.createElement('tr');
  tr.innerHTML = `
    <td class="drag-handle">⠿</td>
    <td class="editable"><input type="text"   value="Drilling" onchange="activityRecalc()"></td>
    <td class="editable"><input type="number" step="0.5" value="3" onchange="activityRecalc()"></td>
    <td class="editable"><input type="number" step="100" value="0" onchange="activityRecalc()"></td>
    <td class="editable"><input type="number" step="1000" value="0" onchange="activityRecalc()"></td>
    <td class="row-act"><button onclick="this.closest('tr').remove();activityRecalc()">✕</button></td>`;
  body.appendChild(tr);
  activityRecalc();
}

function activityRecalc() {
  let totalDays = 0, totalCost = 0;
  for (const tr of document.getElementById('activityBody').rows) {
    const inputs = tr.querySelectorAll('input');
    totalDays += +(inputs[1]?.value || 0);
    totalCost += +(inputs[3]?.value || 0);
  }

  const dayRate = _servicesDayRate();
  totalCost += dayRate * totalDays;

  // Add service lump sums
  for (const tr of document.getElementById('servicesBody').rows) {
    const inputs = tr.querySelectorAll('input[type=number]');
    totalCost += +(inputs[1]?.value || 0);
  }

  // Add casing material costs
  totalCost += _casingCostTotal();

  const dEl = document.getElementById('actTotalDays');
  const cEl = document.getElementById('actTotalCost');
  if (dEl) dEl.textContent = totalDays.toFixed(1) + ' days';
  if (cEl) cEl.textContent = '$' + Math.round(totalCost).toLocaleString();

  activitySave();
}

function servicesAddRow() {
  const body = document.getElementById('servicesBody');
  const tr   = document.createElement('tr');
  tr.innerHTML = `
    <td class="drag-handle">⠿</td>
    <td class="editable"><input type="text"   value="Rig" onchange="activityRecalc()"></td>
    <td class="editable"><input type="number" step="500" value="25000" onchange="activityRecalc()"></td>
    <td class="editable"><input type="number" step="1000" value="0" onchange="activityRecalc()"></td>
    <td class="row-act"><button onclick="this.closest('tr').remove();activityRecalc()">✕</button></td>`;
  body.appendChild(tr);
  activityRecalc();
}

function _servicesDayRate() {
  let rate = 0;
  for (const tr of document.getElementById('servicesBody').rows) {
    const inputs = tr.querySelectorAll('input[type=number]');
    rate += +(inputs[0]?.value || 0);
  }
  return rate;
}

// ── Casing Cost table ─────────────────────────────────────────────────────────

function casingCostAddRow(vals) {
  const body = document.getElementById('casingCostBody');
  const tr   = document.createElement('tr');
  tr.innerHTML = `
    <td class="drag-handle">⠿</td>
    <td class="editable"><input type="text"   value="${vals?.size   ?? ''}"    placeholder='e.g. 9.625"' onchange="casingCostRecalc()"></td>
    <td class="editable"><input type="number" step="0.5"  value="${vals?.rate   ?? 30}"   onchange="casingCostRecalc()"></td>
    <td class="editable"><input type="number" step="100"  value="${vals?.length ?? 5000}" onchange="casingCostRecalc()"></td>
    <td class="editable"><input type="number" step="1000" value="${vals?.cement ?? 0}"    onchange="casingCostRecalc()"></td>
    <td class="calc-cell" data-col="castotal">—</td>
    <td class="row-act"><button onclick="this.closest('tr').remove();casingCostRecalc()">✕</button></td>`;
  body.appendChild(tr);
  casingCostRecalc();
}

function casingCostRecalc() {
  for (const tr of document.getElementById('casingCostBody').rows) {
    const num   = tr.querySelectorAll('input[type=number]');
    const rate   = +(num[0]?.value || 0);
    const length = +(num[1]?.value || 0);
    const cement = +(num[2]?.value || 0);
    const cell = tr.querySelector('[data-col="castotal"]');
    if (cell) cell.textContent = '$' + Math.round(rate * length + cement).toLocaleString();
  }
  activityRecalc();
}

function _casingCostTotal() {
  let total = 0;
  for (const tr of document.getElementById('casingCostBody').rows) {
    const num = tr.querySelectorAll('input[type=number]');
    total += +(num[0]?.value || 0) * +(num[1]?.value || 0) + +(num[2]?.value || 0);
  }
  return total;
}

function activityGet() {
  const activities = [];
  for (const tr of document.getElementById('activityBody').rows) {
    const inputs = tr.querySelectorAll('input');
    activities.push({
      name:  inputs[0]?.value || '',
      days:  +(inputs[1]?.value || 0),
      depth: +(inputs[2]?.value || 0),
      cost:  +(inputs[3]?.value || 0),
    });
  }

  const services = [];
  for (const tr of document.getElementById('servicesBody').rows) {
    const inputs = tr.querySelectorAll('input');
    services.push({
      name:    inputs[0]?.value || '',
      dayRate: +(inputs[1]?.value || 0) || 0,
      lumpSum: +(inputs[2]?.value || 0) || 0,
    });
  }

  const casingCosts = [];
  for (const tr of document.getElementById('casingCostBody').rows) {
    const txt = tr.querySelectorAll('input[type=text]');
    const num = tr.querySelectorAll('input[type=number]');
    const rate   = +(num[0]?.value || 0);
    const length = +(num[1]?.value || 0);
    const cement = +(num[2]?.value || 0);
    casingCosts.push({
      size: txt[0]?.value || '',
      rate, length, cement,
      total: rate * length + cement,
    });
  }

  return { activities, services, casingCosts };
}

function activitySave() {
  if (!qpState.currentScenarioId) return;
  dbSaveScenarioData(qpState.currentScenarioId, 'activity', activityGet());
}

function activityLoadState(data) {
  if (!data) return;

  const actBody = document.getElementById('activityBody');
  actBody.innerHTML = '';
  (data.activities || []).forEach(a => {
    activityAddRow();
    const tr     = actBody.rows[actBody.rows.length - 1];
    const inputs = tr.querySelectorAll('input');
    if (inputs[0]) inputs[0].value = a.name  ?? '';
    if (inputs[1]) inputs[1].value = a.days  ?? 0;
    if (inputs[2]) inputs[2].value = a.depth ?? 0;
    if (inputs[3]) inputs[3].value = a.cost  ?? 0;
  });

  const svcBody = document.getElementById('servicesBody');
  svcBody.innerHTML = '';
  (data.services || []).forEach(s => {
    servicesAddRow();
    const tr     = svcBody.rows[svcBody.rows.length - 1];
    const inputs = tr.querySelectorAll('input');
    if (inputs[0]) inputs[0].value = s.name    ?? '';
    if (inputs[1]) inputs[1].value = s.dayRate ?? 0;
    if (inputs[2]) inputs[2].value = s.lumpSum ?? 0;
  });

  const casBody = document.getElementById('casingCostBody');
  casBody.innerHTML = '';
  (data.casingCosts || []).forEach(c => {
    casingCostAddRow(c);
    // value is already set via vals param in casingCostAddRow
  });

  activityRecalc();
}

// ── Seed rows on first load ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('activityBody').rows.length) {
    activityAddRow();
    const row = document.getElementById('activityBody').rows[0];
    const inputs = row.querySelectorAll('input');
    inputs[0].value = 'Spud to TD';
    inputs[1].value = 15;
    inputs[2].value = 5000;
    inputs[3].value = 0;
  }
  if (!document.getElementById('servicesBody').rows.length) {
    servicesAddRow();
  }
  activityRecalc();
});
