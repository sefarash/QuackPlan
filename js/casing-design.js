// ===== CASING DESIGN =====

const GAS_GRAD = 0.1; // psi/ft gas gradient

function drawCasingDesign() {
  const sfBurst       = +(document.getElementById('cdSFBurst')?.value       || 1.10);
  const sfCollapse    = +(document.getElementById('cdSFCollapse')?.value    || 1.00);
  const sfTension     = +(document.getElementById('cdSFTension')?.value     || 1.30);
  const sfCompression = +(document.getElementById('cdSFCompression')?.value || 1.30);

  const survey     = qpState.survey || [];
  const allRows    = _readSchematicRows();

  const casingRows = allRows
    .filter(r => r.def !== 'Open Hole' && +(r.bot || 0) > 0)
    .sort((a, b) => +(a.bot) - +(b.bot));

  const ratings     = _readCDRatings();
  const selectedKey = _selectedCDKey();

  _renderCDRatingsTable(casingRows, survey, ratings, sfBurst, sfCollapse, sfTension, sfCompression, selectedKey);
  drawCasingTriaxial();
}

// ── Key helpers ───────────────────────────────────────────────────────────────

function _cdKey(row) { return `${row.size}_${row.bot}`; }

function _selectedCDKey() {
  const radio = document.querySelector('input[name="cdSelect"]:checked');
  return radio?.value || null;
}

function _readCDRatings() {
  const tbody = document.getElementById('cdRatingsBody');
  if (!tbody) return {};
  const out = {};
  for (const tr of tbody.rows) {
    const key    = tr.dataset.key;
    const inputs = tr.querySelectorAll('input[type=number]');
    if (key) out[key] = {
      burst:       +(inputs[0]?.value || 0),
      collapse:    +(inputs[1]?.value || 0),
      tension:     +(inputs[2]?.value || 0),
      compression: +(inputs[3]?.value || 0),
    };
  }
  return out;
}

// ── Ratings + selection table ─────────────────────────────────────────────────

function _renderCDRatingsTable(casingRows, survey, ratings, sfBurst, sfCollapse, sfTension, sfCompression, selectedKey) {
  const div = document.getElementById('cdRatingsDiv');
  if (!div) return;

  if (!casingRows.length) {
    div.innerHTML = '<p style="color:#9ecce3;padding:8px 0">Add casing strings in Well Schematic</p>';
    return;
  }

  const rows = casingRows.map((row, idx) => {
    const key      = _cdKey(row);
    const r        = ratings[key] || {};
    const bLim     = r.burst       ? Math.round(r.burst       / sfBurst)       : null;
    const cLim     = r.collapse    ? Math.round(r.collapse    / sfCollapse)    : null;
    const tLim     = r.tension     ? +(r.tension     / sfTension).toFixed(1)     : null;
    const compLim  = r.compression ? +(r.compression / sfCompression).toFixed(1) : null;
    const shoeTVD  = Math.round(_tvdAt(survey, +(row.bot)));
    const checked  = (selectedKey ? key === selectedKey : idx === 0) ? 'checked' : '';
    const specLine = [row.grade, row.nomWt_ppf ? row.nomWt_ppf + ' ppf' : null]
                       .filter(Boolean).join(' · ');
    return `<tr data-key="${key}" style="cursor:pointer" onclick="this.querySelector('input[type=radio]').click()">
      <td style="text-align:center;padding:4px 6px">
        <input type="radio" name="cdSelect" value="${key}" ${checked}
          style="cursor:pointer" onchange="drawCasingDesign()" onclick="event.stopPropagation()">
      </td>
      <td style="font-size:11px;padding:4px 4px">
        <strong>${row.size}" ${row.def}</strong><br>
        <span style="color:#9ecce3;font-size:10px">${specLine}</span><br>
        <span style="color:#9ecce3;font-size:10px">${shoeTVD.toLocaleString()} ft TVD</span>
      </td>
      <td style="padding:2px 4px">
        <input type="number" step="100" value="${r.burst || ''}" placeholder="psi"
          style="width:72px" onchange="drawCasingDesign()" onclick="event.stopPropagation()">
        ${bLim !== null ? `<div style="font-size:10px;color:#1a7a4a">/ ${sfBurst} = ${bLim.toLocaleString()}</div>` : ''}
      </td>
      <td style="padding:2px 4px">
        <input type="number" step="100" value="${r.collapse || ''}" placeholder="psi"
          style="width:72px" onchange="drawCasingDesign()" onclick="event.stopPropagation()">
        ${cLim !== null ? `<div style="font-size:10px;color:#7a4aa0">/ ${sfCollapse} = ${cLim.toLocaleString()}</div>` : ''}
      </td>
      <td style="padding:2px 4px">
        <input type="number" step="10" value="${r.tension || ''}" placeholder="klbf"
          style="width:72px" onchange="drawCasingDesign()" onclick="event.stopPropagation()">
        ${tLim !== null ? `<div style="font-size:10px;color:#2a7fa8">/ ${sfTension} = ${tLim}</div>` : ''}
      </td>
      <td style="padding:2px 4px">
        <input type="number" step="10" value="${r.compression || ''}" placeholder="klbf"
          style="width:72px" onchange="drawCasingDesign()" onclick="event.stopPropagation()">
        ${compLim !== null ? `<div style="font-size:10px;color:#a07a2a">/ ${sfCompression} = ${compLim}</div>` : ''}
      </td>
    </tr>`;
  }).join('');

  div.innerHTML = `
    <div class="section-label" style="margin-bottom:6px">Select Casing String</div>
    <table class="qp-table" style="width:100%;font-size:11px">
      <thead><tr>
        <th style="width:28px"></th>
        <th>Section</th>
        <th>Burst (psi)</th>
        <th>Collapse (psi)</th>
        <th>Tension (klbf)</th>
        <th>Compr. (klbf)</th>
      </tr></thead>
      <tbody id="cdRatingsBody">${rows}</tbody>
    </table>
    <p style="margin-top:8px;font-size:10px;color:#9ecce3">
      Enter catalogue burst &amp; collapse ratings to show the API design box on the triaxial chart.
    </p>`;
}
