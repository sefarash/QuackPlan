// ===== SCENARIO COMPARISON =====

const CMP_COLORS = ['#00d4ff', '#f0a500', '#00e676'];

// ── Public entry points ───────────────────────────────────────────────────────

function compareInit() {
  _cmpGetAllScenarios().then(scenarios => {
    ['cmpSelA', 'cmpSelB', 'cmpSelC'].forEach((selId, i) => {
      const sel = document.getElementById(selId);
      if (!sel) return;
      const prev = sel.value;
      sel.innerHTML = i === 2
        ? '<option value="">— none —</option>'
        : '<option value="">— select —</option>';
      scenarios.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.path;
        if (String(s.id) === prev) opt.selected = true;
        sel.appendChild(opt);
      });
    });
  });
}

async function compareRun() {
  const ids = ['cmpSelA', 'cmpSelB', 'cmpSelC']
    .map(id => +(document.getElementById(id)?.value) || 0)
    .filter(Boolean);

  if (ids.length < 2) { setStatus('Select at least 2 scenarios to compare'); return; }

  setStatus('Computing comparison…');
  const results = (await Promise.all(ids.map(_cmpLoadMetrics))).filter(Boolean);
  if (results.length < 2) { setStatus('Need at least 2 scenarios with trajectory data'); return; }

  _cmpRenderTable(results);
  _cmpDrawChart(results);
  document.getElementById('cmpResults').style.display   = '';
  document.getElementById('cmpChartWrap').style.display = '';
  setStatus('Ready');
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function _cmpGetAllScenarios() {
  const all = await _cmpDbGetAll();
  return all
    .filter(n => n.type === 'scenario')
    .map(s => ({ ...s, path: _cmpBuildPath(s, all) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function _cmpDbGetAll() {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction('nodes', 'readonly');
    const req = tx.objectStore('nodes').getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror   = e => reject(e.target.error);
  }));
}

function _cmpBuildPath(node, all) {
  const parts = [node.name];
  let cur = node;
  while (cur.parentId) {
    const p = all.find(n => n.id === cur.parentId);
    if (!p) break;
    parts.unshift(p.name);
    cur = p;
  }
  return parts.join(' › ');
}

// ── Per-scenario compute ──────────────────────────────────────────────────────

async function _cmpLoadMetrics(id) {
  const node = await dbGet(id);
  if (!node?.data) return null;
  const d = node.data;

  // Build survey
  const stations = (d.traj1 || []).map(r => ({ md: +r.md, inc: +r.inc, az: +r.azi }));
  if (stations.length < 2) return null;
  const survey = computeSurvey(stations);
  const last   = survey[survey.length - 1];

  // Build BHA object from saved rows
  const bhaRows = d.bha || [];
  const dpRow   = bhaRows.find(r => r.comp === 'Drill Pipe') || bhaRows[0] || {};
  const bitRow  = bhaRows.find(r => r.comp === 'Bit') || {};
  let tfa = 0;
  (d.nozzles || []).forEach(r => {
    const sz = +(r.size || 12), cnt = +(r.count || 3), ri = sz / 64;
    tfa += cnt * Math.PI * ri * ri;
  });
  const bha = {
    topDpOD_in:    +(dpRow.od  || 5.0),
    topDpID_in:    +(dpRow.id  || 4.276),
    bitOD_in:      +(bitRow.od || 8.5),
    tfa_in2:       tfa || 0.220,
    mwdDeltaP_psi: 0,
  };

  // Fluid
  const fluid = d.fluid || {
    model: 'HB', mudWeight: 10, pv: 16, yp: 13,
    tauY: 8, nHB: 0.7, kHB: 120, flowRate: 280,
  };

  // T&D (FF 0.25 cased / 0.30 open — fixed for fair comparison)
  const td     = tdCompute(survey, bha, null, fluid.mudWeight,
    { ffCased: 0.25, ffOpen: 0.30, wob_klbs: 15, overpullMargin_lbf: 100000 });
  const rotSt  = td?.modes?.rotOn?.ffSensitivity?.mid?.stations || [];
  const poohSt = td?.modes?.pooh?.ffSensitivity?.mid?.stations  || [];
  const rihSt  = td?.modes?.rih?.ffSensitivity?.mid?.stations   || [];

  const maxTorque = Math.max(...rotSt.map(s => s.torque_ftlbs || 0), 0);
  const hlPOOH    = Math.abs(poohSt[0]?.axialLoad_lbf || 0) / 1000;
  const hlRIH     = Math.abs(rihSt[0]?.axialLoad_lbf  || 0) / 1000;

  // Hydraulics (no DOM reads — uses scenario fluid directly)
  const hyd = _cmpComputeHyd(survey, fluid, bha);

  // Activity
  const acts    = d.activity?.activities || [];
  const svcs    = d.activity?.services   || [];
  const days    = acts.reduce((s, a)  => s + (+a.days    || 0), 0);
  const dayRate = svcs.reduce((s, sv) => s + (+sv.dayRate || 0), 0);
  const cost    = acts.reduce((s, a)  => s + (+a.cost    || 0), 0)
                + svcs.reduce((s, sv) => s + (+sv.lumpSum || 0), 0)
                + dayRate * days;

  return {
    id, name: node.name, survey,
    totalMD:  last.md,
    maxTVD:   last.tvd,
    maxInc:   Math.max(...survey.map(s => s.inc)),
    maxDLS:   Math.max(...survey.map(s => s.dls * (100 / 30))),
    maxTorque, hlPOOH, hlRIH,
    ecdAtBit: hyd.ecdAtBit,
    spp:      hyd.spp,
    days, cost,
  };
}

function _cmpComputeHyd(survey, fluid, bha) {
  const { model = 'HB', mudWeight = 10, pv = 16, yp = 13,
          tauY = 8, nHB = 0.7, kHB = 120, flowRate = 280 } = fluid;
  const dpOD       = bha.topDpOD_in ?? 5.0;
  const dpID       = bha.topDpID_in ?? 4.276;
  const tfa        = bha.tfa_in2    ?? 0.220;
  const totalMD_ft = survey[survey.length - 1].md;
  const bitTVD_ft  = survey[survey.length - 1].tvd;

  // 3-section annular fallback (avoids DOM reads)
  const rheol = { pv, yp, n: 0.65, K: 180, tauY, nHB, kHB, mudWeight };
  const segs  = [
    { dh: 13.375, mdBot: totalMD_ft * 0.4  },
    { dh: 9.625,  mdBot: totalMD_ft * 0.75 },
    { dh: 8.5,    mdBot: totalMD_ft        },
  ];
  let cumAnn = 0, prevMD = 0;
  segs.forEach(seg => {
    const len = Math.max(0, seg.mdBot - prevMD);
    if (len < 1) return;
    const r = computeRheology(model, rheol,
      { dh: seg.dh, dp: dpOD, length: len / 3.28084, flowRate });
    cumAnn += r.pressureLoss_psi;
    prevMD  = seg.mdBot;
  });

  const vPipe    = flowRate / (2.448 * dpID * dpID);
  const rePipe   = 928 * mudWeight * vPipe * dpID / (pv || 1);
  const fPipe    = 0.0791 / Math.pow(Math.max(rePipe, 100), 0.25);
  const pipeLoss = fPipe * mudWeight * vPipe * vPipe / (21.1 * dpID) * totalMD_ft / 100;
  const nozzVel  = tfa > 0 ? flowRate / (3.117 * tfa) : 0;
  const bitDrop  = mudWeight * nozzVel * nozzVel / 1120;

  return {
    spp:      Math.round(pipeLoss + bitDrop + cumAnn + 50),
    ecdAtBit: +(mudWeight + cumAnn / (0.052 * (bitTVD_ft || 1))).toFixed(2),
  };
}

// ── Comparison table ──────────────────────────────────────────────────────────

const _CMP_ROWS = [
  { section: 'Trajectory' },
  ['Total MD',        'totalMD',   'ft',      false],
  ['Max TVD',         'maxTVD',    'ft',      false],
  ['Max Inclination', 'maxInc',    '°',       false],
  ['Max DLS',         'maxDLS',    '°/100ft', true ],
  { section: 'Torque & Drag  (FF 0.25 / 0.30)' },
  ['Max Torque',      'maxTorque', 'ft·lbs',  true ],
  ['Hook Load POOH',  'hlPOOH',    'klbs',    false],
  ['Hook Load RIH',   'hlRIH',     'klbs',    true ],
  { section: 'Hydraulics' },
  ['ECD at Bit',      'ecdAtBit',  'ppg',     true ],
  ['Pump Pressure',   'spp',       'psi',     true ],
  { section: 'Well Economics' },
  ['Total Days',      'days',      'days',    true ],
  ['Est. Total Cost', 'cost',      '$',       true ],
];

function _cmpRenderTable(results) {
  const n = results.length;

  // Update column headers
  ['A', 'B', 'C'].forEach((ltr, i) => {
    const el = document.getElementById('cmpHead' + ltr);
    if (!el) return;
    el.textContent    = i < n ? results[i].name : '';
    el.style.display  = i < n ? '' : 'none';
    el.style.color    = CMP_COLORS[i];
  });

  const tbody = document.getElementById('cmpBody');
  tbody.innerHTML = '';

  _CMP_ROWS.forEach(row => {
    const tr = document.createElement('tr');

    if (row.section) {
      tr.innerHTML = `<td colspan="${n + 1}" class="cmp-section-hdr">${row.section}</td>`;
      tbody.appendChild(tr);
      return;
    }

    const [label, key, unit, lowerIsBetter] = row;
    const vals = results.map(r => +r[key]);
    const best = lowerIsBetter ? Math.min(...vals) : Math.max(...vals);
    const allSame = vals.every(v => v === vals[0]);

    let html = `<td class="cmp-metric-label">${label} <span class="text-dim">(${unit})</span></td>`;
    results.forEach((r, i) => {
      const v      = +r[key];
      const isBest = !allSame && v === best;
      let display;
      if (key === 'cost') {
        display = v >= 1e6
          ? '$' + (v / 1e6).toFixed(2) + 'M'
          : v > 0 ? '$' + Math.round(v / 1000) + 'K' : '$0';
      } else if (key === 'maxDLS' || key === 'ecdAtBit') {
        display = v.toFixed(2);
      } else if (key === 'days') {
        display = v.toFixed(1);
      } else {
        display = Math.round(v).toLocaleString();
      }
      html += `<td class="cmp-val${isBest ? ' cmp-best' : ''}">${display}</td>`;
    });
    if (n < 3) html += '<td class="cmp-val" style="display:none"></td>';
    tr.innerHTML = html;
    tbody.appendChild(tr);
  });
}

// ── Trajectory overlay canvas ─────────────────────────────────────────────────

function _cmpDrawChart(results) {
  const canvas = document.getElementById('cmpCanvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  || 900;
  canvas.height = rect.height || 300;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#0b1520';
  ctx.fillRect(0, 0, W, H);

  const pad = { t: 20, b: 36, l: 62, r: 20 };
  const pw  = W - pad.l - pad.r;
  const ph  = H - pad.t - pad.b;

  const maxMD  = Math.max(...results.map(r => r.totalMD), 1);
  const maxTVD = Math.max(...results.map(r => r.maxTVD),  1);

  // Grid
  ctx.strokeStyle = 'rgba(0,212,255,0.06)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const x = pad.l + pw * i / 5;
    const y = pad.t + ph * i / 5;
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + pw, y); ctx.stroke();
  }
  ctx.strokeStyle = '#1a3347'; ctx.lineWidth = 1;
  ctx.strokeRect(pad.l, pad.t, pw, ph);

  // Axis tick labels
  ctx.fillStyle = '#7eacc8'; ctx.font = '10px sans-serif';
  for (let i = 0; i <= 5; i++) {
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(maxMD * i / 5).toLocaleString(),
      pad.l + pw * i / 5, pad.t + ph + 14);
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxTVD * i / 5).toLocaleString(),
      pad.l - 5, pad.t + ph * i / 5 + 3);
  }
  ctx.textAlign = 'center';
  ctx.fillText('MD (ft)', pad.l + pw / 2, H - 2);
  ctx.save();
  ctx.translate(11, pad.t + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('TVD (ft)', 0, 0);
  ctx.restore();

  // Draw each scenario
  results.forEach((r, i) => {
    const color = CMP_COLORS[i];
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    r.survey.forEach((pt, j) => {
      const x = pad.l + (pt.md  / maxMD)  * pw;
      const y = pad.t + (pt.tvd / maxTVD) * ph;
      j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Name label at TD
    const last = r.survey[r.survey.length - 1];
    const lx   = pad.l + (last.md  / maxMD)  * pw + 6;
    const ly   = pad.t + (last.tvd / maxTVD) * ph;
    ctx.fillStyle = color; ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(r.name, Math.min(lx, W - pad.r - 60), ly + 3);
  });

  // Legend dots top-right
  results.forEach((r, i) => {
    const lx = pad.l + pw - (results.length - i - 1) * 90;
    ctx.fillStyle = CMP_COLORS[i];
    ctx.beginPath(); ctx.arc(lx, pad.t + 8, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8f4fd'; ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(r.name, lx + 8, pad.t + 12);
  });
}
