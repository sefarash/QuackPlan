// ===== SCENARIO JSON EXPORT / IMPORT  (Phase 1) =====
// Versioned JSON document — full round-trip of all scenario inputs + output controls.
// This schema is the internal data contract for all future integration phases.

const QP_SCHEMA   = 'qp-scenario';
const QP_VERSION  = '1';

// ── Export ────────────────────────────────────────────────────────────────────

async function exportScenario() {
  const sid = qpState.currentScenarioId;
  if (!sid) { alert('Select a scenario first.'); return; }

  // Fetch the full node hierarchy: scenario → borehole → well → field → project
  const scenarioNode  = await dbGet(sid);
  const boreholeNode  = await dbGet(scenarioNode?.parentId);
  const wellNode      = await dbGet(boreholeNode?.parentId);
  const fieldNode     = await dbGet(wellNode?.parentId);
  const projectNode   = await dbGet(fieldNode?.parentId);

  const d = scenarioNode?.data || {};
  const w = wellNode?.data     || {};

  // Output controls from localStorage
  let outputControls = {};
  try { outputControls = JSON.parse(localStorage.getItem('qp_output_controls') || '{}'); } catch (_) {}

  // Casing ratings — prefer IndexedDB copy; fall back to live DOM
  const casingRatings = d.cdRatings || _readCDRatings();

  const doc = {
    schema:     QP_SCHEMA,
    version:    QP_VERSION,
    exportedAt: new Date().toISOString(),

    meta: {
      project:     projectNode?.name   || '',
      field:       fieldNode?.name     || '',
      well:        wellNode?.name      || '',
      borehole:    boreholeNode?.name  || '',
      scenario:    scenarioNode?.name  || '',
      environment: w.environment       || 'onshore',
      rkb:         w.rkb               || 0,
      gl:          w.gl                || 0,
      seaBedDepth: w.seaBedDepth       || 0,
    },

    inputs: {
      traj1:     d.traj1     || [],
      traj2:     d.traj2     || [],
      tort:      d.tort      || [],
      schematic: d.schematic || [],
      fluid:     d.fluid     || {},
      bha:       d.bha       || [],
      nozzles:   d.nozzles   || [],
      mwd:       d.mwd       || [],
      ppfg:      d.ppfg      || [],
      activity:  d.activity  || {},
      handover:  d.handover  || [],
    },

    outputControls,
    casingRatings,

    // Computed results — informational; import does not restore these
    // (they are re-derived on Run after import)
    results: {
      survey:    qpState.survey    || [],
      tdResult:  qpState.tdResult  || null,
      hydResult: qpState.hydResult || null,
    },
  };

  const filename = (scenarioNode?.name || 'scenario')
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .replace(/\s+/g, '_') + '_qp.json';

  _downloadJSON(doc, filename);
  setStatus('Scenario exported → ' + filename);
}

// ── Import ────────────────────────────────────────────────────────────────────

function importScenarioFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const doc = JSON.parse(e.target.result);
      _importScenarioDoc(doc);
    } catch (err) {
      alert('Cannot parse file: ' + err.message);
    }
  };
  reader.readAsText(file);
  input.value = '';
}

async function _importScenarioDoc(doc) {
  if (doc.schema !== QP_SCHEMA) {
    alert('Not a QuackPlan scenario file (schema mismatch).');
    return;
  }

  const sid = qpState.currentScenarioId;
  if (!sid) {
    alert('Select or create a scenario first, then import into it.');
    return;
  }

  const inp = doc.inputs || {};

  // Clear frozen chart snapshots / annotations from the previous scenario
  if (typeof CI !== 'undefined' && CI.clearAll) CI.clearAll();

  // Clear all input tables (same as _loadScenario)
  ['traj1Body','traj2Body','tortBody','schematicBody','bhaBody',
   'nozzleBody','mwdBody','activityBody','servicesBody',
   'casingCostBody','handoverBody'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });

  if (inp.traj1?.length)   trajLoadRows(inp.traj1);
  if (inp.traj2?.length)   traj2LoadRows(inp.traj2);
  if (inp.tort?.length)    tortLoadState(inp.tort);
  if (inp.schematic)       schematicLoadRows(inp.schematic);
  if (inp.fluid)           fluidLoadState(inp.fluid);
  if (inp.bha)             bhaLoadState(inp.bha);
  if (inp.nozzles)         nozzleLoadState(inp.nozzles);
                           mwdLoadState(inp.mwd);
  if (inp.activity)        activityLoadState(inp.activity);
                           handoverLoadState(inp.handover);
  if (inp.ppfg)            ppfgLoadState(inp.ppfg);

  // Restore output controls
  if (doc.outputControls && Object.keys(doc.outputControls).length) {
    localStorage.setItem('qp_output_controls', JSON.stringify(doc.outputControls));
    loadOutputControls();
  }

  // Restore casing ratings
  if (doc.casingRatings && Object.keys(doc.casingRatings).length) {
    cdRatingsLoadState(doc.casingRatings);
    dbSaveScenarioData(sid, 'cdRatings', doc.casingRatings);
  }

  // Persist all inputs to IndexedDB
  const savePromises = Object.entries(inp).map(([key, val]) =>
    dbSaveScenarioData(sid, key, val)
  );
  await Promise.all(savePromises);

  // Trigger full recompute so charts update
  qpCompute();
  setStatus(`Imported: ${doc.meta?.scenario || file?.name || 'scenario'}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
