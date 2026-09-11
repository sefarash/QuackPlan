// ===== GUIDED TOUR — end-to-end walk =====
// Fresh account → welcome offered → Start creates the sample well (additive,
// through the normal API) and opens it → six steps advance with their panels →
// Finish sets the flag → no second offer → replay reuses the sample project.
//
//   npx wrangler dev --local   then   npm run test:tour

import puppeteer from 'puppeteer-core';

const BASE   = process.env.QP_TEST_URL || 'http://127.0.0.1:8787';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 700));
await page.evaluate(() => authSetMode('signup'));
await page.type('#authEmail', 'tour' + Date.now() + '@test.local');
await page.type('#authPassword', 'password123');
await page.click('#authSubmit');
await new Promise(r => setTimeout(r, 1200));

const res = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const vis = sel => { const el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none' && !el.hidden; };
  const out = {};
  out.autoOfferedUnderAutomation = vis('.tour-welcome.open');   // must be false (webdriver guard)
  out.offered = QP_TOUR.offer(true) && vis('.tour-welcome.open');
  const rootsBefore = (await dbRoots()).length;

  let patches = [], tracking = false;
  const origFetch = window.fetch;
  window.fetch = (u, o) => {
    if (tracking && String(u).includes('/data') && o?.method === 'PATCH') { try { patches.push(JSON.parse(o.body).key); } catch (_) { patches.push('?'); } }
    return origFetch(u, o);
  };

  await QP_TOUR.start();                                   // creates the sample well, opens it, shows step 1
  await wait(800);
  const roots = await dbRoots();
  const sample = roots.find(n => n.name === QP_TOUR.SAMPLE_PROJECT);
  out.sampleCreated = !!sample && roots.length === rootsBefore + 1;
  out.scenarioOpen  = !!qpState.currentScenarioId;
  const scNode = await dbGet(qpState.currentScenarioId);
  const bhNode = await dbGet(scNode.parentId);
  const scData = qpMergeBoreholeData(scNode.data, bhNode.data).data;   // borehole-level keys live on the borehole
  out.split = { onBorehole: Object.keys(bhNode.data).sort(), onScenario: Object.keys(scNode.data).sort() };
  out.placement = {
    editorInBhaTab: !!document.querySelector('#schematicSlotHost #schematicEditor'),
    boreholeViewRows: document.querySelectorAll('#schematicBoreholeTable tbody tr').length,
    inheritedNote: document.getElementById('schematicSlotNote').textContent.includes('Inherited'),
  };
  out.sample = { traj1: scData.traj1?.length, strings: scData.schematic?.length,
                 specs: scData.schematic?.filter(r => r.casingSpec).length, bha: scData.bha?.length, ppfg: scData.ppfg?.length,
                 trajOpt: scData.trajOpt, fluidModel: scData.fluid?.model, holes: scData.schematic?.map(r => r.hole) };
  // manual hole size: shown in the table, wins over the inferred size for cement sheath + phase hole,
  // round-trips through save, and Open Hole rows have it disabled
  {
    const rowsDom = [...document.querySelectorAll('#schematicBody tr')];
    const hIn = rowsDom.map(tr => tr.querySelector('.sch-hole'));
    out.holeUI = { shown: hIn.map(i => i.value), ohDisabled: hIn[3].disabled, placeholderInferred: hIn[2].placeholder };
    hIn[2].value = '12.5'; schematicSave(); await wait(600);
    const rowsRead = _readSchematicRows();
    out.holeUI.readHole = rowsRead[2].hole;
    out.holeUI.cementOuter = _schCementSegments(rowsRead[2], rowsRead).map(s => s.outerDia);
    out.holeUI.phaseHole = qpPhaseList().find(p => p.key === '7500')?.holeSize;
    out.holeUI.stored = (await dbGet(qpState.currentScenarioId)).data.schematic[2].hole;   // the edit forked a scenario copy
    out.holeUI.boreholeUntouched = (await dbGet(scNode.parentId)).data.schematic[2].hole;
    out.holeUI.ownNote = document.getElementById('schematicSlotNote').textContent.includes('own casing program');
    hIn[2].value = '12.25'; schematicSave(); await wait(400);
  }
  out.step1 = { idx: QP_TOUR.step(), spot: vis('.tour-spot'), card: vis('.tour-card'),
                cardText: document.querySelector('.tour-card .tour-title')?.textContent };

  tracking = true;                                         // walking the tour must not write scenario data
  const seen = [];
  let needsRows = 0;
  for (let i = 0; i < 7; i++) {
    seen.push({ idx: QP_TOUR.step(), title: document.querySelector('.tour-card .tour-title')?.textContent,
                inputTab: qpState.activeInputTab, outputTab: qpState.activeOutputTab, spot: vis('.tour-spot') });
    if (QP_TOUR.step() === 5) needsRows = document.querySelectorAll('.tour-card .tour-needs tbody tr').length;
    QP_TOUR.next(); await wait(900);
  }
  out.needsRows = needsRows;
  QP_TOUR.showNeeds(); out.needsPopover = vis('.tour-card') && document.querySelectorAll('.tour-card .tour-needs tbody tr').length === QP_TOUR.NEEDS.length; QP_TOUR.hideNeeds();
  out.needsClosed = !vis('.tour-card') && !vis('.tour-spot');
  QP_TOUR.showNeeds(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); out.needsEsc = !vis('.tour-card') && !vis('.tour-spot');
  tracking = false;
  out.steps = seen;
  out.computed = !!qpState.tdResult;
  out.patchesWhileWalking = patches;   // outputControls (tab / phase memory) is allowed; well data is not
  out.finished = { active: QP_TOUR.active(), flag: localStorage.getItem(QP_TOUR.KEY), cardHidden: !vis('.tour-card') };
  out.secondOffer = QP_TOUR.offer(false);                  // flag set → no welcome
  _selectNode(bhNode); await wait(1200);
  out.editorHomeAtBorehole = !!document.querySelector('#schematicHome #schematicEditor') && document.getElementById('schematicScenarioSlot').hidden;
  // replay reuses the sample project (no second copy)
  await QP_TOUR.start(); await wait(800);
  out.replay = { roots: (await dbRoots()).filter(n => n.name === QP_TOUR.SAMPLE_PROJECT).length, active: QP_TOUR.active() };
  QP_TOUR.skip();
  out.skipped = { flag: localStorage.getItem(QP_TOUR.KEY), active: QP_TOUR.active() };
  return out;
});

await page.evaluate(async () => { await QP_TOUR.start(); await new Promise(r => setTimeout(r, 800)); for (let i = 0; i < 5; i++) { QP_TOUR.next(); await new Promise(r => setTimeout(r, 700)); } });
await page.screenshot({ path: process.env.QP_TOUR_SHOT || '/tmp/qp-tour-step3.png' });

console.log(`\nGUIDED TOUR — ${BASE}`);
check('not auto-offered under automation', res.autoOfferedUnderAutomation === false);
check('welcome dialog shows when offered', res.offered === true);
check('Start creates exactly one sample project and opens its scenario', res.sampleCreated && res.scenarioOpen);
check('sample well is complete (6 stations, 4 strings with 3 catalogue specs, 7 BHA rows, 5 PPFG rows, HB fluid)',
      res.sample.traj1 === 6 && res.sample.strings === 4 && res.sample.specs === 3 && res.sample.bha === 7 && res.sample.ppfg === 5 && res.sample.fluidModel === 'HB' && res.sample.trajOpt === 'opt1',
      JSON.stringify(res.sample));
check('sample well: borehole holds trajectory/schematic/PPFG, scenario holds BHA/fluid/nozzles',
      JSON.stringify(res.split.onBorehole) === JSON.stringify(['ppfg', 'schematic', 'traj1', 'trajOpt']) && JSON.stringify(res.split.onScenario) === JSON.stringify(['bha', 'fluid', 'nozzles']), JSON.stringify(res.split));
check('scenario open: casing editor sits in Casing/BHA, Well Schematic shows the borehole definition read-only, marked inherited',
      res.placement.editorInBhaTab && res.placement.boreholeViewRows === 4 && res.placement.inheritedNote, JSON.stringify(res.placement));
check('editing the casing program in the scenario forks a copy; borehole definition untouched',
      res.holeUI.stored === 12.5 && res.holeUI.boreholeUntouched === 12.25 && res.holeUI.ownNote, JSON.stringify({ stored: res.holeUI.stored, bh: res.holeUI.boreholeUntouched }));
check('sample strings carry manual hole sizes', JSON.stringify(res.sample.holes) === JSON.stringify([26, 17.5, 12.25, '']), JSON.stringify(res.sample.holes));
check('hole column: shown, Open Hole disabled, inferred placeholder, manual value wins (cement sheath, phase) and round-trips',
      res.holeUI.shown.slice(0, 3).join(',') === '26,17.5,12.25' && res.holeUI.ohDisabled && res.holeUI.placeholderInferred === '12.25'
      && res.holeUI.readHole === 12.5 && res.holeUI.cementOuter.every(d => d === 12.5) && res.holeUI.phaseHole === 12.5 && res.holeUI.stored === 12.5,
      JSON.stringify(res.holeUI));
check('step 1 shows spotlight + card', res.step1.idx === 0 && res.step1.spot && res.step1.card, res.step1.cardText);
check('seven steps in order with their panels', res.steps.map(s => s.idx).join(',') === '0,1,2,3,4,5,6'
      && res.steps[1].inputTab === 'trajectory' && res.steps[2].inputTab === 'schematic' && res.steps[3].inputTab === 'bha'
      && res.steps[4].outputTab === 'torque' && res.steps[6].inputTab === 'fluid', res.steps.map(s => `${s.idx}:${s.inputTab}/${s.outputTab}`).join(' '));
check('editor returns to the Well Schematic tab at borehole level', res.editorHomeAtBorehole === true);
check('"what each result needs" step lists every output tab', res.needsRows === 8, `${res.needsRows} rows`);
check('footer ? popover shows the same table', res.needsPopover === true);
check('closing the popover removes the card AND the spotlight frame', res.needsClosed === true);
check('Esc closes the popover', res.needsEsc === true);
check('every step has a visible spotlight target', res.steps.every(s => s.spot));
check('Run step computed the well', res.computed === true);
// 'nozzles' is excluded: bhaGet() → nozzleRecalc() → nozzleSave() rewrites the (unchanged)
// nozzle table on every compute — pre-existing app behaviour, not the tour's.
const DATA_KEYS = ['traj1', 'traj2', 'trajOpt', 'tort', 'schematic', 'fluid', 'fluidProgram', 'bha', 'mwd', 'ppfg', 'activity', 'handover', 'cdRatings'];
check('walking the tour writes no well data (only panel-control memory)', !res.patchesWhileWalking.some(k => DATA_KEYS.includes(k)), `keys: ${res.patchesWhileWalking.join(',') || 'none'}`);
check('Finish hides the tour and sets the flag', !res.finished.active && res.finished.flag === 'done' && res.finished.cardHidden);
check('no second welcome once done', res.secondOffer === false);
check('replay reuses the sample project', res.replay.roots === 1 && res.replay.active === true);
check('Skip sets the flag and closes', res.skipped.flag === 'skipped' && !res.skipped.active);
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
console.log(failures ? `\nFAIL — ${failures} check(s) failed` : '\nPASS — guided tour checks passed');
process.exit(failures ? 1 : 0);
