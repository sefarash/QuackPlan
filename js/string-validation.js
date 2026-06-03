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

    // Two independent checks:
    //
    // Check A — inner casing too large for its enclosing (larger-OD) casing:
    //   Find the immediate outer casing: smallest OD that is still > od,
    //   covering this casing's top depth.
    //
    // Check B — sequence violation (e.g. 20" casing below a 13 3/8"):
    //   If a SMALLER-OD casing has its shoe strictly ABOVE this casing's top
    //   (A_top < top AND A_bot >= top), the bore at this top depth is limited
    //   by that casing's ID.  The shoe being at or above top means the bottom
    //   of THIS casing had to physically pass through it.

    // Check A: must fit inside the enclosing outer casing.
    // Use >= (not >) so equal-OD casings are caught: a casing cannot run inside
    // another with the same OD because its OD would exceed the other's ID.
    const outerCandidates = rows
      .filter((r, j) => {
        if (j === idx) return false;
        if (r.def === 'Open Hole') return false;
        const rOD  = parseFloat(r.size);
        const rTop = +(r.top || 0);
        const rBot = +(r.bot || 0);
        return rOD >= od && rTop <= top && rBot >= top;
      })
      .map(r => ({ row: r, id: _rowID(r) }))
      .filter(x => x.id > 0)
      .sort((a, b) => parseFloat(a.row.size) - parseFloat(b.row.size)); // nearest outer first

    const checkA = outerCandidates[0];

    // Check B: must fit through any smaller casing whose shoe is above this top
    //   (only fires when top > 0; casings starting at surface have nothing above them)
    const seqViolations = top > 0
      ? rows
          .filter((r, j) => {
            if (j === idx) return false;
            if (r.def === 'Open Hole') return false;
            const rOD  = parseFloat(r.size);
            const rTop = +(r.top || 0);
            const rBot = +(r.bot || 0);
            return rOD < od && rTop < top && rBot >= top;
          })
          .map(r => ({ row: r, id: _rowID(r) }))
          .filter(x => x.id > 0)
          .sort((a, b) => +(a.row.bot) - +(b.row.bot)) // shallowest shoe first
      : [];

    const checkB = seqViolations[0]; // tightest/shallowest obstruction

    // Evaluate and emit at most one message per row (worst violation wins)
    const violation = (() => {
      const aFail = checkA && od >= checkA.id;
      const aTight = checkA && !aFail && od > checkA.id * 0.97;
      const bFail  = checkB && od >= checkB.id;
      const bTight = checkB && !bFail && od > checkB.id * 0.97;

      if (aFail)  return { sev: 'error',   ref: checkA, kind: 'inside' };
      if (bFail)  return { sev: 'error',   ref: checkB, kind: 'below' };
      if (aTight) return { sev: 'warning', ref: checkA, kind: 'inside' };
      if (bTight) return { sev: 'warning', ref: checkB, kind: 'below' };
      return null;
    })();

    if (!violation) return;

    const { sev, ref } = violation;
    const colour  = sev === 'error' ? '#e05555' : '#e0a020';
    const icon    = sev === 'error' ? '✕' : '⚠';

    let msg;
    if (sev === 'error') {
      msg = `${row.size}" ${row.def} OD ${od}" ≥ ${ref.row.size}" ${ref.row.def} ID ${ref.id.toFixed(3)}" — cannot pass through`;
    } else {
      const cl = ((ref.id - od) / ref.id * 100).toFixed(1);
      msg = `${row.size}" ${row.def}: only ${cl}% radial clearance inside ${ref.row.size}" ${ref.row.def} — tight fit`;
    }
    warnings.push(msg);
    if (trList[idx]) trList[idx].style.outline = `2px solid ${colour}`;
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
