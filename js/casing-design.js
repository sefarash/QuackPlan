// ===== CASING DESIGN =====

const GAS_GRAD = 0.1; // psi/ft gas gradient

// In-memory ratings store (imperial/canonical) — survives redraws within a
// session and is populated on scenario load / JSON import so ratings are never
// lost.
let _cdRatingsLoaded = {};

// True only while a unit toggle is redrawing: the rating INPUT fields still hold
// the previous system's values, so _readCDRatings must use the canonical store
// instead of fromDisplay-ing stale DOM values.
let _cdUnitsToggling = false;

QP_UNITS.onChange(() => {
  _cdUnitsToggling = true;
  try { drawCasingDesign(); } finally { _cdUnitsToggling = false; }
});

function cdRatingsLoadState(data) {
  _cdRatingsLoaded = data || {};
}

function cdRatingsSave() {
  if (!qpState.currentScenarioId) return;
  const ratings = _readCDRatings();
  _cdRatingsLoaded = ratings;
  dbSaveScenarioData(qpState.currentScenarioId, 'cdRatings', ratings);
}

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
  // During a unit toggle the DOM fields are in the old system — use canonical
  if (_cdUnitsToggling) return { ..._cdRatingsLoaded };
  const tbody = document.getElementById('cdRatingsBody');
  if (!tbody) return { ..._cdRatingsLoaded };
  const out = {};
  for (const tr of tbody.rows) {
    const key    = tr.dataset.key;
    const inputs = tr.querySelectorAll('input[type=number]');
    // Fields are display units → imperial (canonical): burst/collapse are
    // pressures (psi), tension/compression are forces (klbf).
    if (key) out[key] = {
      burst:       QP_UNITS.fromDisplay('press', +(inputs[0]?.value || 0)),
      collapse:    QP_UNITS.fromDisplay('press', +(inputs[1]?.value || 0)),
      tension:     QP_UNITS.fromDisplay('force', +(inputs[2]?.value || 0)),
      compression: QP_UNITS.fromDisplay('force', +(inputs[3]?.value || 0)),
    };
  }
  // Merge any keys not yet in DOM (e.g. freshly loaded section not yet rendered)
  for (const [k, v] of Object.entries(_cdRatingsLoaded)) {
    if (!out[k]) out[k] = v;
  }
  return out;
}

// ── Ratings + selection table ─────────────────────────────────────────────────

function _renderCDRatingsTable(casingRows, survey, ratings, sfBurst, sfCollapse, sfTension, sfCompression, selectedKey) {
  const div = document.getElementById('cdRatingsDiv');
  if (!div) return;

  if (!casingRows.length) {
    div.innerHTML = '<p style="color:var(--text-dim);padding:8px 0">Add casing strings in Well Schematic</p>';
    return;
  }

    // Ratings stored imperial (psi / klbf) → display for the fields & limits
  const dP = v => +QP_UNITS.toDisplay('press', v).toFixed(0);
  const dF = v => +QP_UNITS.toDisplay('force', v).toFixed(1);
  const uP = QP_UNITS.label('press'), uF = QP_UNITS.label('force'), uD = QP_UNITS.label('depth');

  const rows = casingRows.map((row, idx) => {
    const key      = _cdKey(row);
    const r        = ratings[key] || {};
    const bVal     = r.burst       ? dP(r.burst)       : '';
    const cVal     = r.collapse    ? dP(r.collapse)    : '';
    const tVal     = r.tension     ? dF(r.tension)     : '';
    const compVal  = r.compression ? dF(r.compression) : '';
    const bLim     = r.burst       ? dP(r.burst       / sfBurst)       : null;
    const cLim     = r.collapse    ? dP(r.collapse    / sfCollapse)    : null;
    const tLim     = r.tension     ? dF(r.tension     / sfTension)     : null;
    const compLim  = r.compression ? dF(r.compression / sfCompression) : null;
    const shoeTVD  = Math.round(QP_UNITS.toDisplay('depth', _tvdAt(survey, +(row.bot))));
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
        <span style="color:var(--text-dim);font-size:10px">${specLine}</span><br>
        <span style="color:var(--text-dim);font-size:10px">${shoeTVD.toLocaleString()} ${uD} TVD</span>
      </td>
      <td style="padding:2px 4px">
        <input type="number" step="100" value="${bVal}" placeholder="${uP}"
          style="width:72px" onchange="drawCasingDesign();cdRatingsSave()" onclick="event.stopPropagation()">
        ${bLim !== null ? `<div style="font-size:10px;color:#2aad6a">/ ${sfBurst} = ${bLim.toLocaleString()}</div>` : ''}
      </td>
      <td style="padding:2px 4px">
        <input type="number" step="100" value="${cVal}" placeholder="${uP}"
          style="width:72px" onchange="drawCasingDesign();cdRatingsSave()" onclick="event.stopPropagation()">
        ${cLim !== null ? `<div style="font-size:10px;color:#b07ad0">/ ${sfCollapse} = ${cLim.toLocaleString()}</div>` : ''}
      </td>
      <td style="padding:2px 4px">
        <input type="number" step="10" value="${tVal}" placeholder="${uF}"
          style="width:72px" onchange="drawCasingDesign();cdRatingsSave()" onclick="event.stopPropagation()">
        ${tLim !== null ? `<div style="font-size:10px;color:#3aafd8">/ ${sfTension} = ${tLim}</div>` : ''}
      </td>
      <td style="padding:2px 4px">
        <input type="number" step="10" value="${compVal}" placeholder="${uF}"
          style="width:72px" onchange="drawCasingDesign();cdRatingsSave()" onclick="event.stopPropagation()">
        ${compLim !== null ? `<div style="font-size:10px;color:#e0a020">/ ${sfCompression} = ${compLim}</div>` : ''}
      </td>
    </tr>`;
  }).join('');

  div.innerHTML = `
    <div class="section-label" style="margin-bottom:6px">Select Casing String</div>
    <table class="qp-table" style="width:100%;font-size:11px">
      <thead><tr>
        <th style="width:28px"></th>
        <th>Section</th>
        <th>Burst (${uP})</th>
        <th>Collapse (${uP})</th>
        <th>Tension (${uF})</th>
        <th>Compr. (${uF})</th>
      </tr></thead>
      <tbody id="cdRatingsBody">${rows}</tbody>
    </table>
    <p style="margin-top:8px;font-size:10px;color:var(--text-dim)">
      Enter catalogue burst &amp; collapse ratings to show the API design box on the triaxial chart.
    </p>`;
}
