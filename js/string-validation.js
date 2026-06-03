// ===== STRING VALIDATION =====
// Checks physical fit constraints:
//   Schematic — each casing OD must be < the ID of the outer casing it runs through
//   BHA       — each component OD must be < the ID of the casing/hole at its depth

// ── Schematic validation ──────────────────────────────────────────────────────

function _schValidate() {
  const body    = document.getElementById('schematicBody');
  const warnDiv = document.getElementById('schematicWarnings');
  if (!body || !warnDiv) return;

  // Clear previous highlights
  for (const tr of body.rows) tr.style.outline = '';

  const trList = Array.from(body.rows);
  const rows   = _readSchematicRows();   // same order as trList
  const warnings = [];

  rows.forEach((row, idx) => {
    const od  = parseFloat(row.size);
    const top = +(row.top || 0);
    if (!od || od <= 0) return;

    // Find every casing whose interval reaches this row's top depth — regardless of OD.
    // To run any casing to its setting depth, the casing string must pass through
    // every casing whose shoe (bottom) is at or below the new casing's top depth.
    // Note: includes adjacent casings (rBot === top) because to reach that depth
    // the new casing's bottom must physically pass through that shoe.
    const restrictions = rows
      .filter((r, j) => {
        if (j === idx) return false;
        if (r.def === 'Open Hole') return false;
        const rTop = +(r.top || 0);
        const rBot = +(r.bot || 0);
        return rTop <= top && rBot >= top; // covers or reaches this casing's top
      })
      .map(r => ({ row: r, id: _rowID(r) }))
      .filter(x => x.id > 0)
      .sort((a, b) => a.id - b.id); // tightest ID first

    if (!restrictions.length) return; // no enclosing string found

    const tightest  = restrictions[0];
    const tightID   = tightest.id;
    const tightRow  = tightest.row;

    if (od >= tightID) {
      const msg = `${row.size}" ${row.def} OD ${od}" ≥ ${tightRow.size}" ${tightRow.def} ID ${tightID.toFixed(3)}" — cannot pass through`;
      warnings.push(msg);
      if (trList[idx]) trList[idx].style.outline = '2px solid #e05555';
    } else if (od > tightID * 0.97) {
      const clearance = ((tightID - od) / tightID * 100).toFixed(1);
      warnings.push(`${row.size}" ${row.def}: only ${clearance}% radial clearance inside ${tightRow.size}" ${tightRow.def} — tight fit`);
      if (trList[idx]) trList[idx].style.outline = '2px solid #e0a020';
    }
  });

  _renderWarnings(warnDiv, warnings);
}

// ── BHA validation ────────────────────────────────────────────────────────────

function _bhaValidate() {
  const body    = document.getElementById('bhaBody');
  const warnDiv = document.getElementById('bhaWarnings');
  if (!body || !warnDiv) return;

  for (const tr of body.rows) tr.style.outline = '';

  const bhaComps   = bhaGet().components;
  const schRows    = _readSchematicRows().filter(r => +(r.bot || 0) > 0);
  const survey     = qpState.survey || [];
  const tdMD       = survey.length ? survey[survey.length - 1].md : 0;
  const trList     = Array.from(body.rows);
  const warnings   = [];

  if (!schRows.length || !bhaComps.length) { warnDiv.innerHTML = ''; return; }

  // Compute each component's approximate mid-depth.
  // BHA rows are bottom-to-top (index 0 = bit at TD).
  // Cumulative length from bit → depth = TD - cumLen_from_bit
  let cumFromBit = 0;
  bhaComps.forEach((comp, idx) => {
    const halfLen    = comp.lengthFt / 2;
    const midFromBit = cumFromBit + halfLen;
    const midDepthMD = Math.max(0, tdMD - midFromBit);
    cumFromBit += comp.lengthFt;

    const compOD = comp.od;

    // Find the tightest restriction at midDepthMD
    // (casing whose interval covers midDepthMD, smallest ID)
    const enclosing = schRows
      .filter(r => +(r.top || 0) <= midDepthMD && +(r.bot || 0) >= midDepthMD)
      .map(r => ({ row: r, id: _rowID(r) }))
      .filter(x => x.id > 0)
      .sort((a, b) => a.id - b.id); // tightest first

    if (!enclosing.length) return;
    const tightest = enclosing[0];
    const tightID  = tightest.id;
    const tightRow = tightest.row;

    if (compOD >= tightID) {
      const msg = `${comp.type} OD ${compOD}" ≥ ${tightRow.size}" ${tightRow.def} ID ${tightID.toFixed(3)}" at ~${Math.round(midDepthMD).toLocaleString()}' MD — will not pass through`;
      warnings.push(msg);
      if (trList[idx]) trList[idx].style.outline = '2px solid #e05555';
    } else if (compOD > tightID * 0.90) {
      const clearance = ((tightID - compOD) / tightID * 100).toFixed(1);
      warnings.push(`${comp.type} OD ${compOD}": only ${clearance}% clearance inside ${tightRow.size}" ${tightRow.def} (ID ${tightID.toFixed(3)}") at ~${Math.round(midDepthMD).toLocaleString()}' MD`);
      if (trList[idx]) trList[idx].style.outline = '2px solid #e0a020';
    }
  });

  _renderWarnings(warnDiv, warnings);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Best-effort inner diameter for a schematic row
function _rowID(row) {
  if (row.def === 'Open Hole') return parseFloat(row.size) || 0;
  if (row.id_in && +row.id_in > 0) return +row.id_in;
  const od = parseFloat(row.size) || 0;
  if (row.nomWt_ppf && +row.nomWt_ppf > 0) {
    const disc = od * od - 4 * (+row.nomWt_ppf) / 10.69;
    if (disc > 0) return Math.sqrt(disc);
  }
  return od > 0 ? od * 0.87 : 0; // typical API wall ratio fallback
}

function _renderWarnings(div, warnings) {
  if (!warnings.length) { div.innerHTML = ''; return; }
  div.innerHTML = warnings.map(msg => {
    const isError = msg.includes('will not pass') || msg.includes('cannot pass');
    const color   = isError ? '#e05555' : '#e0a020';
    const icon    = isError ? '✕' : '⚠';
    return `<div style="display:flex;align-items:flex-start;gap:5px;padding:3px 0;font-size:10px;color:${color}">
      <span style="flex-shrink:0;font-weight:bold">${icon}</span>
      <span>${msg}</span>
    </div>`;
  }).join('');
}
