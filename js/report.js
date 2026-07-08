// ===== WELL-PROGRAM / PDF REPORT =====
// Zero-dependency report generator. Gathers the current scenario (trajectory,
// schematic, BHA, fluid, T&D, hydraulics, AFE), snapshots the output charts as
// PNGs, and opens a print-optimised HTML document in a new window. The user
// prints it to PDF via the browser (File → Print → Save as PDF), so there is no
// bundler, no library, and no server — consistent with the app's constraints.
//
// All values are shown in the active unit system (QP_UNITS.toDisplay); imperial
// stays canonical everywhere upstream.

function generateReport() {
  if (!qpState.survey || qpState.survey.length < 2) {
    alert('No trajectory yet — build a survey and press Run before generating a report.');
    return;
  }

  // Fresh results (also repopulates qpState.tdResult / hydResult).
  try { qpCompute(); } catch (_) {}

  const survey = qpState.survey;
  const td     = qpState.tdResult;
  const hyd    = qpState.hydResult;
  const fluid  = fluidGet();
  const bha    = bhaGet();
  const sch    = _readSchematicRows();

  // ── Unit helpers ────────────────────────────────────────────────────────────
  const L  = q => QP_UNITS.label(q);
  const D  = (q, v) => QP_UNITS.toDisplay(q, v);
  const uD = L('depth'), uF = L('force'), uTq = L('torque_k'), uMW = L('mw'),
        uP = L('press'), uFl = L('flow'), uLW = L('linwt'), uDLS = L('dls');
  // number formatter: n(value, decimals)
  const n = (v, d = 0) => (v == null || isNaN(v))
    ? '—'
    : (+v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // ── Chart snapshots ─────────────────────────────────────────────────────────
  const snap = _reportSnapshots(td, hyd);

  // ── Trajectory summary ──────────────────────────────────────────────────────
  const last   = survey[survey.length - 1];
  const maxInc = Math.max(...survey.map(s => s.inc || 0));
  const maxDLS = Math.max(...survey.map(s => s.dls || 0));
  const hd     = Math.hypot(last.north || 0, last.east || 0);
  const kop    = (survey.find(s => (s.inc || 0) > 1) || {}).md;

  // ── T&D summary ─────────────────────────────────────────────────────────────
  const mid = m => td?.modes?.[m]?.ffSensitivity?.mid;
  const puHL  = mid('pooh')?.surfaceHookload_lbf;
  const soHL  = mid('rih')?.surfaceHookload_lbf;
  const rotHL = mid('rotOff')?.surfaceHookload_lbf;
  const surfTq = mid('rotOn')?.surfaceTorque_ftlbs;

  const well     = esc(document.getElementById('hdrWellName')?.textContent || 'Well');
  const scenario = esc(document.getElementById('hdrScenarioName')?.textContent || '—');
  const sys      = QP_UNITS.isMetric() ? 'Metric (SI)' : 'Imperial (field)';
  const totDays  = esc(document.getElementById('actTotalDays')?.textContent || '—');
  const totCost  = esc(document.getElementById('actTotalCost')?.textContent || '—');

  // ── Table builders ──────────────────────────────────────────────────────────
  const row = cells => '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
  const hrow = cells => '<tr>' + cells.map(c => `<th>${c}</th>`).join('') + '</tr>';

  const kv = pairs => '<table class="kv">' +
    pairs.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('') + '</table>';

  // BHA (surface → bit as entered)
  const bhaRows = (bha.components || []).map(c => row([
    esc(c.type), n(c.od, 3), n(c.id, 3), n(D('depth', c.lengthFt), 1),
    c.nomWt_ppf ? n(D('linwt', c.nomWt_ppf), 1) : '—',
    esc(c.grade || '—'), esc(c.conn || '—'),
  ])).join('');

  // Casing / hole strings (sorted shallow → deep)
  const schSorted = [...sch].sort((a, b) => (+a.bot || 0) - (+b.bot || 0));
  const schRows = schSorted.map(s => row([
    esc(s.def), n(s.size, 3), n(D('depth', +s.top || 0), 0), n(D('depth', +s.bot || 0), 0),
    s.nomWt_ppf ? n(D('linwt', s.nomWt_ppf), 1) : '—', esc(s.grade || '—'),
  ])).join('');

  // Abbreviated survey (≤ 15 rows, evenly sampled + always the last)
  const step = Math.max(1, Math.ceil(survey.length / 15));
  const svySample = survey.filter((_, i) => i % step === 0);
  if (svySample[svySample.length - 1] !== last) svySample.push(last);
  const svyRows = svySample.map(s => row([
    n(D('depth', s.md), 0), n(s.inc, 2), n(s.az, 2),
    n(D('depth', s.tvd), 0), n(D('dls', s.dls || 0), 2),
  ])).join('');

  const fig = (dataUrl, cap) => dataUrl
    ? `<figure><img src="${dataUrl}" alt="${esc(cap)}"><figcaption>${esc(cap)}</figcaption></figure>`
    : `<div class="nofig">${esc(cap)} — not available (run Compute)</div>`;

  // ── Assemble ────────────────────────────────────────────────────────────────
  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Well Program — ${well} / ${scenario}</title>
<style>${_reportCss()}</style></head><body>
<header class="cover">
  <div class="brand">🦆 QuackPlan — Well Program</div>
  <h1>${well}</h1>
  <div class="sub">${scenario}</div>
  <table class="meta">
    <tr><th>Units</th><td>${sys}</td><th>Total (planned)</th><td>${totDays} &nbsp;·&nbsp; ${totCost}</td></tr>
    <tr><th>Total depth</th><td>${n(D('depth', last.md), 0)} ${uD} MD / ${n(D('depth', last.tvd), 0)} ${uD} TVD</td>
        <th>Max inclination</th><td>${n(maxInc, 1)}°</td></tr>
  </table>
</header>

<section>
  <h2>1 · Trajectory</h2>
  ${kv([
    ['Total depth (MD)', `${n(D('depth', last.md), 0)} ${uD}`],
    ['Total depth (TVD)', `${n(D('depth', last.tvd), 0)} ${uD}`],
    ['Horizontal displacement', `${n(D('depth', hd), 0)} ${uD}`],
    ['Kick-off point (MD)', kop != null ? `${n(D('depth', kop), 0)} ${uD}` : 'Vertical'],
    ['Max inclination', `${n(maxInc, 1)}°`],
    ['Max dogleg', `${n(D('dls', maxDLS), 2)} ${uDLS}`],
    ['Survey stations', `${survey.length}`],
  ])}
  ${fig(snap.traj, 'Vertical section')}
  <h3>Survey (sampled)</h3>
  <table class="data"><thead>${hrow([`MD (${uD})`, 'Inc (°)', 'Azi (°)', `TVD (${uD})`, `DLS (${uDLS})`])}</thead>
  <tbody>${svyRows}</tbody></table>
</section>

<section class="break">
  <h2>2 · Well Schematic &amp; Casing</h2>
  ${fig(snap.schematic, 'Well schematic')}
  <table class="data"><thead>${hrow(['String', 'OD (in)', `Top (${uD})`, `Shoe (${uD})`, `Weight (${uLW})`, 'Grade'])}</thead>
  <tbody>${schRows || row(['<em>No strings defined</em>', '', '', '', '', ''])}</tbody></table>
</section>

<section class="break">
  <h2>3 · BHA / Drill String</h2>
  <table class="data"><thead>${hrow(['Component', 'OD (in)', 'ID (in)', `Length (${uD})`, `Weight (${uLW})`, 'Grade', 'Conn'])}</thead>
  <tbody>${bhaRows || row(['<em>No components</em>', '', '', '', '', '', ''])}</tbody></table>
  <h3>Drilling Fluid</h3>
  ${kv([
    ['Type / model', `${esc(fluid.mudType)} · ${esc(fluid.model)}`],
    ['Mud weight', `${n(D('mw', fluid.mudWeight), 1)} ${uMW}`],
    ['Plastic viscosity', `${n(fluid.pv, 0)} cP`],
    ['Yield point', `${n(D('yieldstress', fluid.yp), 0)} ${L('yieldstress')}`],
    ['Flow rate', `${n(D('flow', fluid.flowRate), 0)} ${uFl}`],
  ])}
</section>

<section class="break">
  <h2>4 · Torque &amp; Drag</h2>
  ${kv([
    ['Pick-up hookload (surface)', `${n(D('force', (puHL || 0) / 1000), 1)} ${uF}`],
    ['Slack-off hookload (surface)', `${n(D('force', (soHL || 0) / 1000), 1)} ${uF}`],
    ['Rotating hookload (surface)', `${n(D('force', (rotHL || 0) / 1000), 1)} ${uF}`],
    ['Surface torque (rotating)', `${n(D('torque_k', (surfTq || 0) / 1000), 1)} ${uTq}`],
    ['Buckling', esc(td?.buckling?.overallStatus || '—')],
    ['Lock-up', td?.lockup?.detected ? `Yes @ ${n(D('depth', td.lockup.lockupMd_ft), 0)} ${uD}` : 'No'],
    ['Overpull margin', esc(td?.overpull?.status || '—')],
    ['Peak Von Mises / yield', td?.stress ? `${n(td.stress.maxRatio * 100, 0)} %` : '—'],
  ])}
  ${fig(snap.torque, 'Torque vs depth')}
  ${fig(snap.broomstick, 'Broomstick (hookload vs depth)')}
</section>

<section class="break">
  <h2>5 · Hydraulics</h2>
  ${hyd ? kv([
    ['Pump pressure (SPP)', `${n(D('press', hyd.pumpPressure), 0)} ${uP}`],
    ['ECD at bit', `${n(D('mw', hyd.ecdAtBit), 2)} ${uMW}`],
    ['Pump horsepower', `${n(hyd.pumpHP, 0)} hp`],
    ['Bit HSI', `${n(hyd.hsi, 2)}`],
    ['Flow rate', `${n(D('flow', hyd.flowRate), 0)} ${uFl}`],
    ['Annular loss / Pipe loss / Bit drop',
      `${n(D('press', hyd.totalAnnLoss), 0)} / ${n(D('press', hyd.pipeLoss), 0)} / ${n(D('press', hyd.bitDrop), 0)} ${uP}`],
  ]) : '<p class="nofig">No hydraulics result.</p>'}
  ${fig(snap.hyd, 'SPP vs flow rate')}
</section>

<section class="break">
  <h2>6 · Cost Estimate (AFE)</h2>
  ${kv([['Planned duration', totDays], ['Estimated cost', totCost]])}
  ${fig(snap.afe, 'Cost / time (AFE)')}
</section>

<footer class="foot">Generated by QuackPlan · well-program report · units: ${sys}</footer>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Report was blocked — please allow pop-ups for this site and try again.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  // Give embedded images a tick to decode before invoking print.
  w.addEventListener('load', () => { w.focus(); setTimeout(() => w.print(), 250); });
}

// Render each chart into its canvas and return PNG data-URLs. _chartSetup charts
// (torque/broomstick/hyd/afe) draw at an 800×500 fallback even when their panel
// is hidden; trajectory + schematic are rendered against their live canvases.
function _reportSnapshots(td, hyd) {
  const out = { traj: null, schematic: null, torque: null, broomstick: null, hyd: null, afe: null };
  const grab = id => {
    const c = document.getElementById(id);
    try { return (c && c.width > 2) ? c.toDataURL('image/png') : null; } catch (_) { return null; }
  };
  const safe = fn => { try { fn(); } catch (e) { console.warn('report chart draw failed:', e); } };

  const prevTab = qpState.activeOutputTab;

  // Trajectory VS lives in the 'trajplot' output panel — make it visible so it
  // sizes correctly, then snapshot.
  safe(() => { if (typeof switchOutputTab === 'function') switchOutputTab('trajplot'); });
  safe(() => { if (typeof drawTrajPlot === 'function') drawTrajPlot(); });
  out.traj = grab('trajVsCanvas');

  // Schematic is always visible in the right panel.
  safe(() => { if (typeof drawSchematic === 'function') drawSchematic(qpState.survey); });
  out.schematic = grab('schematicCanvas');

  if (td) {
    safe(() => drawTorque(td));       out.torque     = grab('torqueCanvas');
    safe(() => drawBroomstick(td));   out.broomstick = grab('broomstickCanvas');
  }
  if (hyd) { safe(() => drawHydSweep(hyd)); out.hyd = grab('hydSweepCanvas'); }
  safe(() => { if (typeof drawAFE === 'function') drawAFE(); }); out.afe = grab('afeCanvas');

  // Restore whatever the user was looking at.
  safe(() => { if (prevTab && typeof switchOutputTab === 'function') switchOutputTab(prevTab); });
  return out;
}

function _reportCss() {
  return `
  * { box-sizing: border-box; }
  body { font: 13px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; color: #1a2530; margin: 0; padding: 24px 32px; }
  h1 { font-size: 28px; margin: 4px 0; }
  h2 { font-size: 18px; border-bottom: 2px solid #2a7fa8; padding-bottom: 4px; margin: 22px 0 12px; color: #14506b; }
  h3 { font-size: 14px; margin: 16px 0 6px; color: #333; }
  .brand { font-size: 13px; color: #2a7fa8; font-weight: 600; letter-spacing: .3px; }
  .cover { border-bottom: 3px solid #14506b; padding-bottom: 14px; margin-bottom: 8px; }
  .cover .sub { font-size: 16px; color: #555; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  table.meta { margin-top: 12px; }
  table.meta th, table.meta td { text-align: left; padding: 4px 10px 4px 0; font-size: 12px; }
  table.meta th { color: #777; font-weight: 600; width: 130px; }
  table.kv { width: auto; min-width: 60%; }
  table.kv th { text-align: left; color: #555; font-weight: 500; padding: 3px 18px 3px 0; vertical-align: top; white-space: nowrap; }
  table.kv td { padding: 3px 0; font-weight: 600; }
  table.data th, table.data td { border: 1px solid #cfd8dd; padding: 4px 8px; text-align: right; font-size: 12px; }
  table.data th { background: #eef4f7; color: #14506b; font-weight: 600; text-align: right; }
  table.data td:first-child, table.data th:first-child { text-align: left; }
  figure { margin: 12px 0; text-align: center; }
  figure img { max-width: 100%; height: auto; border: 1px solid #dbe3e7; border-radius: 4px; }
  figcaption { font-size: 11px; color: #888; margin-top: 4px; }
  .nofig { color: #999; font-style: italic; padding: 10px 0; }
  .foot { margin-top: 28px; padding-top: 8px; border-top: 1px solid #dbe3e7; font-size: 10px; color: #aaa; }
  @media print {
    body { padding: 0; }
    .break { page-break-before: always; }
    section { page-break-inside: avoid; }
    figure, table.data { page-break-inside: avoid; }
    @page { margin: 16mm 14mm; }
  }`;
}
