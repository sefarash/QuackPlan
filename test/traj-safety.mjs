// ===== TRAJECTORY DATA-SAFETY REGRESSION (RULE #1) =====
// Replays the 2026-09-06 "lost my trajectory" report and checks every fix:
//   1. Pasting ONE value into an Option-1 cell must not touch the other rows
//      (it used to clear the table and save the 1-row result).
//   2. Pasting one tab-separated row fills the row under the cursor.
//   3. Pasting a multi-line block replaces the table (confirmed) — still works.
//   4. Leftover Option-2 rows must not hijack the survey on reload once the
//      user has edited Option 1; the source is persisted ('trajOpt').
//   5. A blank added row round-trips blank (no duplicate station).
//   6. Loading fires zero writes throughout.
//
// Run against a local dev server (npx wrangler dev --local):  npm run test:trajsafety

import puppeteer from 'puppeteer-core';

const BASE   = process.env.QP_TEST_URL || 'http://127.0.0.1:8787';
const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
page.on('dialog', d => d.accept());                    // the block-paste confirm
await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 700));
await page.evaluate(() => authSetMode('signup'));
await page.type('#authEmail', 'trajsafety' + Date.now() + '@test.local');
await page.type('#authPassword', 'password123');
await page.click('#authSubmit');
await new Promise(r => setTimeout(r, 900));

const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const mds  = () => [...document.querySelectorAll('#traj1Body tr')].map(tr => tr.querySelector('input').value);
  const paste = (el, text) => {
    el.focus();
    const dt = new DataTransfer(); dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  };
  const TRAJ = [{ md: 0, inc: 0, azi: 0 }, { md: 1000, inc: 0, azi: 0 }, { md: 2000, inc: 15, azi: 90 },
                { md: 4000, inc: 45, azi: 90 }, { md: 8000, inc: 45, azi: 90 }];
  const proj = await dbAdd({ parentId: null, name: 'TS-P', type: 'project' });
  const fld  = await dbAdd({ parentId: proj, name: 'TS-F', type: 'field' });
  const well = await dbAdd({ parentId: fld,  name: 'TS-W', type: 'well', data: { environment: 'onshore', rkb: 25, gl: 0, seaBedDepth: 0 } });
  const bh   = await dbAdd({ parentId: well, name: 'TS-B', type: 'borehole' });
  const sc   = await dbAdd({ parentId: bh, name: 'TS-S', type: 'scenario', data: { traj1: TRAJ } });

  let patches = 0, loadPhase = false;
  const origFetch = window.fetch;
  window.fetch = (u, o) => { if (loadPhase && String(u).includes('/data') && o?.method === 'PATCH') patches++; return origFetch(u, o); };
  const load = async () => { loadPhase = true; _selectNode(await dbGet(sc)); await wait(1800); loadPhase = false; };
  const out = {};
  await load();
  out.patchesDuringLoad = patches;
  out.bannerHiddenWithScenario = getComputedStyle(document.getElementById('scenarioBanner')).display === 'none';

  // 1) single value paste into row 3's MD cell
  paste(document.querySelectorAll('#traj1Body tr')[2].querySelector('input'), '3500');
  await wait(700);
  out.singlePaste = { rows: mds().length, stored: (await dbGet(sc)).data.traj1.length };

  // 2) one tab-separated row → fills row 3
  paste(document.querySelectorAll('#traj1Body tr')[2].querySelector('input'), '2500\t20\t95');
  await wait(700);
  const r3 = [...document.querySelectorAll('#traj1Body tr')[2].querySelectorAll('input')].map(i => i.value);
  out.rowPaste = { rows: mds().length, row3: r3, stored3: (await dbGet(sc)).data.traj1[2] };

  // 3) multi-line block replaces (confirm auto-accepted)
  paste(document.querySelectorAll('#traj1Body tr')[0].querySelector('input'), '0\t0\t0\n3000\t10\t45\n6000\t30\t45');
  await wait(900);
  out.blockPaste = { rows: mds(), stored: (await dbGet(sc)).data.traj1.map(r => r.md) };

  // 4) Option 2 leftovers vs Option 1 edits
  await dbSaveScenarioData(sc, 'traj1', TRAJ.map(r => ({ md: String(r.md), inc: String(r.inc), azi: String(r.azi) })));
  await load();
  switchTrajOption('opt2', [...document.querySelectorAll('.opt-tab')][1]); await wait(200);
  traj2AddRow(); traj2AddRow(); await wait(200);
  document.querySelectorAll('#traj2Body tr').forEach((tr, i) => {
    tr.querySelectorAll('input[type=number]').forEach((inp, j) => { inp.value = j === 0 ? (i ? 6000 : 0) : (j === 1 ? (i ? 30 : 0) : 0); });
  });
  traj2Recalc(); await wait(500);
  out.opt2 = { sourceAfterOpt2Edit: qpState.trajSource, td: qpState.survey.at(-1).md };
  switchTrajOption('opt1', [...document.querySelectorAll('.opt-tab')][0]); await wait(200);
  const last = document.querySelectorAll('#traj1Body tr')[4].querySelector('input'); last.value = '8500'; traj1Recalc(); await wait(700);
  out.opt1Edit = { source: qpState.trajSource, td: qpState.survey.at(-1).md, storedTrajOpt: (await dbGet(sc)).data.trajOpt };
  await load();
  out.afterReload = { source: qpState.trajSource, activeTab: qpState.activeTrajOpt, td: qpState.survey.at(-1).md,
                      stations: qpState.survey.length, traj2RowsKept: document.querySelectorAll('#traj2Body tr').length,
                      opt1TabActive: document.querySelector('.opt-tab.active')?.textContent.includes('Option 1') };
  // choosing Option 2 explicitly is honoured after reload too
  switchTrajOption('opt2', [...document.querySelectorAll('.opt-tab')][1]); await wait(600);
  await load();
  out.opt2Chosen = { source: qpState.trajSource, td: qpState.survey.at(-1).md };
  switchTrajOption('opt1', [...document.querySelectorAll('.opt-tab')][0]); await wait(600);

  // 5) blank row round trip
  traj1AddRow(); await wait(600);
  out.blank = { storedMDs: (await dbGet(sc)).data.traj1.map(r => r.md) };
  await load();
  out.blank.afterReload = mds();
  out.blank.stations = qpState.survey.length;
  out.patchesDuringLoads = patches;

  // 7) borehole level: trajectory / schematic / PPFG / activity are built on the BOREHOLE
  //    and shared by its scenarios; a scenario edit forks its own copy
  patches = 0; loadPhase = true; _selectNode(await dbGet(bh)); await wait(1200); loadPhase = false;
  out.boreholeLoadWrites = patches;
  const center = document.getElementById('centerPanel');
  out.boreholeOnly = {
    bannerShown: getComputedStyle(document.getElementById('scenarioBanner')).display !== 'none',
    bannerInfo: document.getElementById('scenarioBanner').classList.contains('info'),
    trajEditable: getComputedStyle(document.getElementById('panel-trajectory')).pointerEvents !== 'none',
    currentScenario: qpState.currentScenarioId,
    rowsShown: mds().length,                              // borehole has no data yet → 2 seeded rows
  };
  // the banner belongs to the input tables: an output tab hides it, an input tab brings it back
  switchOutputTab('trajplot', [...document.querySelectorAll('.output-tab')][0]); await wait(200);
  out.bannerOnOutputTab = getComputedStyle(document.getElementById('scenarioBanner')).display !== 'none';
  switchInputTab('trajectory', [...document.querySelectorAll('.input-tab')][0]); await wait(200);
  out.bannerBackOnInputTab = getComputedStyle(document.getElementById('scenarioBanner')).display !== 'none';
  // edit the trajectory at the borehole → saved on the borehole node, scenario untouched
  const scBefore = JSON.stringify((await dbGet(sc)).data.traj1);
  document.querySelectorAll('#traj1Body tr')[1].querySelector('input').value = '7777'; traj1Recalc(); await wait(700);
  out.boreholeEdit = { boreholeTraj1: ((await dbGet(bh)).data?.traj1 || []).map(r => r.md), scenarioUnchanged: JSON.stringify((await dbGet(sc)).data.traj1) === scBefore };
  // a NEW scenario inherits the borehole data (nothing copied into it)
  const newId = await hierarchyAddScenario(bh, 'TS-New'); await wait(1500);
  out.newScenario = { selected: qpState.currentScenarioId === newId, rows: mds(), inherited: !!qpState.inherited.traj1,
                      ownTraj1: (await dbGet(newId)).data.traj1, bannerShown: getComputedStyle(document.getElementById('scenarioBanner')).display !== 'none' };
  // editing in the scenario forks a scenario-specific copy; the borehole keeps its own
  document.querySelectorAll('#traj1Body tr')[1].querySelector('input').value = '4321'; traj1Recalc(); await wait(700);
  out.fork = { scenarioTraj1: ((await dbGet(newId)).data.traj1 || []).map(r => r.md), boreholeTraj1: ((await dbGet(bh)).data.traj1 || []).map(r => r.md),
               inheritedNow: !!qpState.inherited.traj1 };
  // back at the borehole: its own version is shown again
  _selectNode(await dbGet(bh)); await wait(1000);
  out.boreholeAgain = mds();
  // the legacy scenario (own traj1) still shows its own rows, not the borehole's
  await load();
  out.legacyScenario = { rows: mds(), inherited: !!qpState.inherited.traj1 };
  return out;
});

console.log(`\nTRAJECTORY DATA-SAFETY — ${BASE}`);
check('single-value paste keeps the other stations', res.singlePaste.rows === 5 && res.singlePaste.stored === 5, `${res.singlePaste.rows} rows, ${res.singlePaste.stored} stored`);
check('one-row paste fills the row under the cursor', res.rowPaste.rows === 5 && res.rowPaste.row3.join(',') === '2500,20,95' && String(res.rowPaste.stored3.md) === '2500', res.rowPaste.row3.join('/'));
check('multi-line block paste replaces the table', res.blockPaste.rows.join(',') === '0,3000,6000' && res.blockPaste.stored.join(',') === '0,3000,6000', res.blockPaste.rows.join(','));
check('editing Option 2 makes it the source', res.opt2.sourceAfterOpt2Edit === 'opt2' && res.opt2.td === 6000);
check('editing Option 1 makes it the source and persists it', res.opt1Edit.source === 'opt1' && res.opt1Edit.td === 8500 && res.opt1Edit.storedTrajOpt === 'opt1');
check('reload keeps Option 1 as the survey source despite Option 2 rows', res.afterReload.source === 'opt1' && res.afterReload.td === 8500 && res.afterReload.stations === 5 && res.afterReload.opt1TabActive, `TD ${res.afterReload.td}, ${res.afterReload.stations} stations`);
check('Option 2 rows are preserved (not deleted)', res.afterReload.traj2RowsKept === 2);
check('explicitly choosing Option 2 is honoured after reload', res.opt2Chosen.source === 'opt2' && res.opt2Chosen.td === 6000);
check('blank row round-trips blank, no duplicate station', res.blank.storedMDs.at(-1) === '' && res.blank.afterReload.at(-1) === '' && res.blank.stations === 5, res.blank.storedMDs.join(','));
check('loads fire zero data writes', res.patchesDuringLoad === 0 && res.patchesDuringLoads === 0, `${res.patchesDuringLoads} PATCHes`);
check('banner is NOT painted while a scenario is open', res.bannerHiddenWithScenario === true);
check('borehole selected: tables editable, info banner, no scenario, zero writes on load', res.boreholeOnly.trajEditable && res.boreholeOnly.bannerShown && res.boreholeOnly.bannerInfo && !res.boreholeOnly.currentScenario && res.boreholeLoadWrites === 0, JSON.stringify(res.boreholeOnly));
check('banner hides under output tabs and returns on input tabs (no overlap with chart controls)', res.bannerOnOutputTab === false && res.bannerBackOnInputTab === true);
check('editing at the borehole saves on the borehole node, scenario untouched', res.boreholeEdit.boreholeTraj1.includes('7777') && res.boreholeEdit.scenarioUnchanged, res.boreholeEdit.boreholeTraj1.join(','));
check('new scenario opens at once and inherits the borehole trajectory (nothing copied)', res.newScenario.selected && res.newScenario.rows.includes('7777') && res.newScenario.inherited && res.newScenario.ownTraj1 === undefined && res.newScenario.bannerShown, JSON.stringify({ rows: res.newScenario.rows, own: res.newScenario.ownTraj1 }));
check('editing in the scenario forks its own copy; borehole keeps its version', res.fork.scenarioTraj1.includes('4321') && res.fork.boreholeTraj1.includes('7777') && !res.fork.boreholeTraj1.includes('4321') && !res.fork.inheritedNow, JSON.stringify(res.fork));
check('borehole shows its own version again', res.boreholeAgain.includes('7777') && !res.boreholeAgain.includes('4321'));
check('legacy scenario with its own trajectory is unaffected', !res.legacyScenario.inherited && !res.legacyScenario.rows.includes('7777'));
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
console.log(failures ? `\nFAIL — ${failures} check(s) failed` : '\nPASS — all trajectory data-safety checks passed');
process.exit(failures ? 1 : 0);
