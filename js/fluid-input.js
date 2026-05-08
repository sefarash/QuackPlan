// ===== DRILLING FLUID INPUT =====

function fluidChanged() {
  const model = document.getElementById('rheologyModel')?.value || 'HB';

  // Show/hide HB params
  const hbSection = document.querySelector('#panel-fluid .two-col > div:last-child .section-label');
  // HB params are always visible — model selection handled in compute-engine

  fluidSave();
}

function fluidSave() {
  if (!qpState.currentScenarioId) return;
  dbSaveScenarioData(qpState.currentScenarioId, 'fluid', fluidGet());
}

function fluidGet() {
  return {
    mudType:       document.getElementById('mudType')?.value        || 'WBM',
    model:         document.getElementById('rheologyModel')?.value  || 'HB',
    mudWeight:     +(document.getElementById('mudWeight')?.value    || 10),
    pv:            +(document.getElementById('pv')?.value           || 16),
    yp:            +(document.getElementById('yp')?.value           || 13),
    gel10s:        +(document.getElementById('gel10s')?.value       || 5),
    gel10m:        +(document.getElementById('gel10m')?.value       || 10),
    tauY:          +(document.getElementById('tauY')?.value         || 8),
    nHB:           +(document.getElementById('nHB')?.value          || 0.7),
    kHB:           +(document.getElementById('kHB')?.value          || 120),
    flowRate:      +(document.getElementById('flowRate')?.value     || 280),
    pumpEff:       +(document.getElementById('pumpEff')?.value      || 90),
    rigSppLimit:   +(document.getElementById('rigSppLimit')?.value  || 3500),
  };
}

function fluidLoadState(data) {
  if (!data) return;
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined) el.value = val;
  };
  set('mudType',       data.mudType);
  set('rheologyModel', data.model);
  set('mudWeight',     data.mudWeight);
  set('pv',            data.pv);
  set('yp',            data.yp);
  set('gel10s',        data.gel10s);
  set('gel10m',        data.gel10m);
  set('tauY',          data.tauY);
  set('nHB',           data.nHB);
  set('kHB',           data.kHB);
  set('flowRate',      data.flowRate);
  set('pumpEff',       data.pumpEff);
  set('rigSppLimit',   data.rigSppLimit);
}
