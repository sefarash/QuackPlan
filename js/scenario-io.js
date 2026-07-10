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

  // Output controls — now stored per-scenario in the node data
  const outputControls = d.outputControls || {};

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

  const meta = doc.meta   || {};
  const inp  = doc.inputs || {};

  setStatus('Importing…');
  try {
    // Import creates a NEW project → field → well → borehole → scenario chain from
    // the file's meta — it does NOT merge into whatever scenario is currently open.
    const projId = await dbAdd({ parentId: null,   name: meta.project  || 'Imported Project', type: 'project' });
    const fldId  = await dbAdd({ parentId: projId,  name: meta.field    || 'Field',            type: 'field'   });
    const wellId = await dbAdd({ parentId: fldId,   name: meta.well     || 'Well',             type: 'well',
      data: {
        environment: meta.environment || 'onshore',
        rkb:         meta.rkb != null ? +meta.rkb : 0,
        gl:          meta.gl  != null ? +meta.gl  : 0,
        seaBedDepth: meta.seaBedDepth != null ? +meta.seaBedDepth : 0,
      } });
    const bhId   = await dbAdd({ parentId: wellId,  name: meta.borehole || 'Borehole',         type: 'borehole' });

    // Build the scenario's full data (inputs + output controls + casing ratings)
    // and create the scenario node in one shot.
    const data = {};
    Object.entries(inp).forEach(([k, v]) => { data[k] = v; });
    if (doc.outputControls && Object.keys(doc.outputControls).length) data.outputControls = doc.outputControls;
    if (doc.casingRatings  && Object.keys(doc.casingRatings).length)  data.cdRatings      = doc.casingRatings;
    const scId = await dbAdd({ parentId: bhId, name: meta.scenario || 'Scenario', type: 'scenario', data });

    // Refresh the tree and open the newly-imported scenario.
    if (typeof hierarchyRefresh === 'function') await hierarchyRefresh();
    if (typeof _selectNode === 'function') {
      _selectNode({ id: scId, type: 'scenario', parentId: bhId });
    }
    localStorage.setItem('qp_lastScenarioId', scId);
    if (typeof hierarchyRefresh === 'function') await hierarchyRefresh();

    setStatus(`Imported new project: ${meta.project || 'Imported Project'}`);
  } catch (e) {
    console.error('import failed:', e);
    setStatus('Import failed — ' + (e.message || e), true);
    alert('Import failed: ' + (e.message || e));
  }
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
