// ===== DATA EXPORT =====
// CSV download and PNG chart capture

function _csvDownload(filename, csvString) {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function _cell(c) {
  const s = String(c ?? '');
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function _row(...cells) { return cells.map(_cell).join(','); }

// ── Survey ──────────────────────────────────────────────────────────────────

function exportSurvey() {
  const survey = qpState.survey || [];
  if (!survey.length) { alert('No survey computed yet. Run Compute or enter trajectory data.'); return; }

  const lines = [
    _row('MD (ft)', 'Inc (deg)', 'Azi (deg)', 'TVD (ft)', 'North (ft)', 'East (ft)', 'DLS (deg/100ft)'),
    ...survey.map(s => _row(
      s.md.toFixed(2), s.inc.toFixed(3), (s.az ?? s.azi ?? 0).toFixed(3),
      s.tvd.toFixed(2), (s.north || 0).toFixed(2), (s.east || 0).toFixed(2),
      (s.dls || 0).toFixed(3),
    )),
  ];
  _csvDownload('survey.csv', lines.join('\n'));
}

// ── T&D ─────────────────────────────────────────────────────────────────────

function exportTD() {
  const r = qpState.tdResult;
  if (!r?.modes) { alert('Run Compute first.'); return; }

  const m = r.modes;
  // All modes share the same MD grid; use pooh to drive the loop
  const base = (key, lvl) => m[key]?.ffSensitivity?.[lvl]?.stations || [];

  const poohMid   = base('pooh',    'mid');
  const rihMid    = base('rih',     'mid');
  const rotOnMid  = base('rotOn',   'mid');
  const rotOffMid = base('rotOff',  'mid');
  const bkSt      = r.buckling?.stations || [];

  const n = poohMid.length;
  const lines = [
    '# QuackPlan T&D Export — mid-FF scenario',
    _row('MD (ft)', 'TVD (ft)',
         'POOH Hookload (lbf)', 'RIH Hookload (lbf)',
         'RotOff Hookload (lbf)', 'RotOn Hookload (lbf)',
         'RotOff Torque (ft-lbs)', 'RotOn Torque (ft-lbs)',
         'Buckling Axial (lbf)', 'Buckling Status'),
  ];

  for (let i = 0; i < n; i++) {
    const p  = poohMid[i]   || {};
    const ri = rihMid[i]    || {};
    const ro = rotOffMid[i] || {};
    const rn = rotOnMid[i]  || {};
    const bk = bkSt[i]      || {};
    lines.push(_row(
      Math.round(p.md  || 0),
      Math.round(p.tvd || 0),
      Math.round(p.axialLoad_lbf  || 0),
      Math.round(ri.axialLoad_lbf || 0),
      Math.round(ro.axialLoad_lbf || 0),
      Math.round(rn.axialLoad_lbf || 0),
      Math.round(ro.torque_ftlbs  || 0),
      Math.round(rn.torque_ftlbs  || 0),
      Math.round(bk.axialLoad_lbf || 0),
      bk.status || '',
    ));
  }
  _csvDownload('TD_results.csv', lines.join('\n'));
}

// ── Hydraulics ───────────────────────────────────────────────────────────────

function exportHydraulics() {
  const h = qpState.hydResult;
  if (!h) { alert('Run Compute first.'); return; }

  const lines = [
    '# QuackPlan Hydraulics Export',
    '',
    '# Summary',
    _row('SPP (psi)', 'ECD at Bit (ppg)', 'Nozzle Velocity (ft/s)',
         'HSI (hhp/in2)', 'Pump Power (HP)', 'Flow Rate (gpm)',
         'Pipe Loss (psi)', 'Bit Drop (psi)', 'Ann Loss (psi)'),
    _row(h.pumpPressure, h.ecdAtBit,
         h.nozzVel, (h.hsi || 0).toFixed(2),
         h.pumpHP, h.flowRate,
         h.pipeLoss, h.bitDrop, h.totalAnnLoss),
    '',
    '# Annular Sections',
    _row('Section', 'Hole Diam (in)', 'Ann Press Loss (psi)', 'ECD (ppg)'),
    ...(h.sections || []).map(s =>
      _row(s.name, s.dh, s.annPressLoss, (s.ecd || 0).toFixed(2))),
    '',
    '# SPP Sweep',
    _row('Flow Rate (gpm)', 'SPP (psi)'),
    ...(h.sweep || []).map(s => _row(s.q, s.spp)),
  ];
  _csvDownload('hydraulics_results.csv', lines.join('\n'));
}

// ── AFE ──────────────────────────────────────────────────────────────────────

function exportAFE() {
  const act     = activityGet();
  let cumDays = 0, cumDirCost = 0;

  const actRows = act.activities.map(a => {
    cumDays    += a.days;
    cumDirCost += a.cost;
    return _row(a.name, a.days.toFixed(1), a.depth,
                Math.round(a.cost), cumDays.toFixed(1), Math.round(cumDirCost));
  });

  const totalDays   = cumDays;
  const svcTotal    = act.services.reduce((s, sv) =>
    s + (sv.dayRate || 0) * totalDays + (sv.lumpSum || 0), 0);
  const casingTotal = act.casingCosts.reduce((s, c) => s + (c.total || 0), 0);
  const grandTotal  = cumDirCost + svcTotal + casingTotal;

  const lines = [
    '# QuackPlan AFE Export',
    '',
    '# Activity Schedule',
    _row('Phase', 'Days', 'Depth (ft)', 'Direct Cost ($)',
         'Cumulative Days', 'Cumulative Direct Cost ($)'),
    ...actRows,
    '',
    '# Services',
    _row('Service', 'Day Rate ($/day)', 'Lump Sum ($)', 'Total ($)'),
    ...act.services.map(sv =>
      _row(sv.name, sv.dayRate, sv.lumpSum,
           Math.round((sv.dayRate || 0) * totalDays + (sv.lumpSum || 0)))),
    '',
    '# Casing Costs',
    _row('Size', '$/ft', 'Length (ft)', 'Cement ($)', 'Total ($)'),
    ...act.casingCosts.map(c =>
      _row(c.size, c.rate, c.length, c.cement, Math.round(c.total))),
    '',
    '# Cost Summary',
    _row('Total Days', 'Direct ($)', 'Services ($)', 'Casing ($)', 'Grand Total ($)'),
    _row(totalDays.toFixed(1),
         Math.round(cumDirCost), Math.round(svcTotal),
         Math.round(casingTotal), Math.round(grandTotal)),
  ];
  _csvDownload('AFE_results.csv', lines.join('\n'));
}

// ── Kick Tolerance ────────────────────────────────────────────────────────────

function exportKT() {
  const survey  = qpState.survey || [];
  const allRows = _readSchematicRows();
  const ppfgPts = _readPPFG();
  const fluid   = fluidGet();
  const mw      = fluid.mudWeight || 10;
  const bha     = bhaGet();
  const dpOD    = bha.topDpOD_in || 5.0;
  const maxTVD  = survey.length ? survey[survey.length - 1].tvd : 10000;

  if (!ppfgPts.length) { alert('Add PPFG points first.'); return; }

  const casingRows = allRows
    .filter(r => r.def !== 'Open Hole' && +(r.bot || 0) > 0)
    .sort((a, b) => +(a.bot) - +(b.bot));

  if (!casingRows.length) { alert('Add casing strings in Well Schematic.'); return; }

  const lines = [
    '# QuackPlan Kick Tolerance Export',
    _row('Section', 'Shoe MD (ft)', 'Shoe TVD (ft)',
         'FG at Shoe (ppg)', 'PP at TD (ppg)',
         'MAASP (psi)', 'Hole Diam (in)', 'Ann Capacity (bbl/ft)', 'KT (bbl)', 'Status'),
    ...casingRows.map(row => {
      const shoeMD  = +(row.bot);
      const shoeTVD = _tvdAt(survey, shoeMD);
      const fg      = _ppfgInterp(ppfgPts, shoeTVD, 'fg');
      const pp      = _ppfgInterp(ppfgPts, maxTVD,  'pp');
      const maasp   = Math.max(0, (fg - mw) * 0.052 * shoeTVD);
      const dh      = _holeSizeAt(allRows, shoeMD + 1);
      const annCap  = Math.max(0, 0.000971 * (dh * dh - dpOD * dpOD));
      const dPPg    = pp - mw;
      const kt      = dPPg > 0 && annCap > 0 ? (maasp / (dPPg * 0.052)) * annCap : null;
      const status  = kt === null ? 'N/A'
        : kt >= 20 ? 'OK' : kt >= 10 ? 'Low' : 'Critical';
      return _row(
        `${row.size}" ${row.def}`,
        Math.round(shoeMD), Math.round(shoeTVD),
        fg.toFixed(2), pp.toFixed(2),
        Math.round(maasp), dh,
        annCap.toFixed(4),
        kt !== null ? Math.round(kt) : 'N/A',
        status,
      );
    }),
  ];
  _csvDownload('kick_tolerance.csv', lines.join('\n'));
}

// ── PNG chart capture ─────────────────────────────────────────────────────────

function exportChartPNG(canvasId, filename) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) { alert('Chart canvas not found — open this tab first.'); return; }
  const url = canvas.toDataURL('image/png');
  const a   = document.createElement('a');
  a.href    = url;
  a.download = filename || (canvasId + '.png');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
