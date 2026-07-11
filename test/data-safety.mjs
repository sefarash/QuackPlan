// ===== DATA-SAFETY REGRESSION TEST (RULE #1) =====
// Replays the real 2026-07-11 corruption incident and verifies every defense:
//   1. Opening a scenario fires ZERO data writes (load guard) — the original
//      bug emitted a burst of partial per-row saves whose out-of-order arrival
//      truncated stored arrays ("casings gone, only 2 left").
//   2. Saves for a scenario are strictly serialized (write chain).
//   3. Round-trip: data survives repeated opens; an edit stores the FULL array.
//   4. Undo log: every mutation snapshots the prior state; restore rolls back.
//   5. Soft delete: deleted nodes disappear from queries but are recoverable.
//
// Run against a local dev server:
//   npx wrangler d1 migrations apply quackplan-db --local
//   npx wrangler dev --local          (http://127.0.0.1:8787)
//   npm run test:datasafety
//
// REQUIRED before deploying ANY change that touches persistence
// (db-engine.js, worker/, migrations/, hierarchy-ui load/save paths).

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
await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 700));

// Fresh account
await page.evaluate(() => authSetMode('signup'));
await page.type('#authEmail', 'datasafety' + Date.now() + '@test.local');
await page.type('#authPassword', 'password123');
await page.click('#authSubmit');
await new Promise(r => setTimeout(r, 900));

const res = await page.evaluate(async () => {
  const out = {};
  // Scenario with a 6-string casing program
  const proj = await dbAdd({ parentId: null, name: 'DS-P', type: 'project' });
  const fld  = await dbAdd({ parentId: proj, name: 'DS-F', type: 'field' });
  const well = await dbAdd({ parentId: fld,  name: 'DS-W', type: 'well',
                             data: { environment: 'onshore', rkb: 25, gl: 350, seaBedDepth: 0 } });
  const bh   = await dbAdd({ parentId: well, name: 'DS-B', type: 'borehole' });
  const SCHEMATIC = [
    { def: 'Conductor',           size: 24,     top: 25,   bot: 272   },
    { def: 'Surface Casing',      size: 18.625, top: 25,   bot: 1022  },
    { def: 'Intermediate Casing', size: 13.375, top: 25,   bot: 5368  },
    { def: 'Production Casing',   size: 9.625,  top: 25,   bot: 6260  },
    { def: 'Liner',               size: 7,      top: 6100, bot: 7341  },
    { def: 'Open Hole',           size: 6.125,  top: 7341, bot: 17100 },
  ];
  const sc = await dbAdd({ parentId: bh, name: 'DS-S', type: 'scenario', data: {
    traj1: [{ md: 0, inc: 0, azi: 0 }, { md: 5700, inc: 0, azi: 0 },
            { md: 7000, inc: 90, azi: 0 }, { md: 17100, inc: 90, azi: 0 }],
    schematic: SCHEMATIC, fluid: { mudWeight: 9 },
  }});

  // Instrument writes
  let patchesDuringLoad = 0, inFlight = 0, maxInFlight = 0, loadPhase = true;
  const origFetch = window.fetch;
  window.fetch = (u, o) => {
    if (String(u).includes('/data') && o && o.method === 'PATCH') {
      if (loadPhase) patchesDuringLoad++;
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      return origFetch(u, o).finally(() => { inFlight--; });
    }
    return origFetch(u, o);
  };

  // 1+3) Open the scenario twice — the previously destructive path
  qpState.currentScenarioId = sc;
  _loadScenario(sc); await new Promise(r => setTimeout(r, 1200));
  _loadScenario(sc); await new Promise(r => setTimeout(r, 1200));
  loadPhase = false;
  out.patchesDuringLoad = patchesDuringLoad;
  out.rowsAfterOpens = (await dbGet(sc)).data.schematic.length;

  // 2+3) Edit one value, then rapid-fire saves — must stay serialized + full
  const inputs = document.getElementById('schematicBody').rows[2].querySelectorAll('input[type=number]');
  inputs[2].value = '5400';
  for (let i = 0; i < 6; i++) schematicSave();
  await new Promise(r => setTimeout(r, 1500));
  out.maxInFlight = maxInFlight;
  const afterEdit = (await dbGet(sc)).data.schematic;
  out.rowsAfterEdit = afterEdit.length;
  out.editApplied  = +afterEdit[2].bot;

  // 4) Undo log: history holds prior versions; restore rolls back
  const hist = await dbHistory(sc);
  out.historyCount = hist.length;
  const prior = hist.find(h => (h.data.schematic || []).some(r => +r.bot === 5368));
  out.historyHasPrior = !!prior;
  if (prior) {
    await dbRestoreVersion(sc, prior.histId);
    const restored = (await dbGet(sc)).data.schematic;
    out.restoredBot = +restored[2].bot;          // expect 5368 (rolled back)
    out.restoredRows = restored.length;
  }

  // 5) Soft delete: node vanishes from queries but is revivable via history
  const victim = await dbAdd({ parentId: null, name: 'DS-DEL', type: 'project', data: { x: 1 } });
  await dbSaveScenarioData(victim, 'x', 2);      // ensure a history snapshot exists
  await dbDelete(victim);
  out.deletedHidden = !(await dbRoots()).some(n => n.id === victim);
  const vh = await dbHistory(victim);
  out.deleteSnapshotted = vh.length > 0;
  if (vh.length) {
    await dbRestoreVersion(victim, vh[0].histId);
    out.revived = (await dbRoots()).some(n => n.id === victim);
  }
  return out;
});

console.log('\nDATA-SAFETY REGRESSION —', BASE);
check('load fires zero data writes',        res.patchesDuringLoad === 0, `${res.patchesDuringLoad} PATCHes`);
check('rows survive repeated opens (6/6)',  res.rowsAfterOpens === 6,    `${res.rowsAfterOpens} rows`);
check('saves strictly serialized',          res.maxInFlight === 1,       `max in flight ${res.maxInFlight}`);
check('edit stores the FULL array',         res.rowsAfterEdit === 6 && res.editApplied === 5400,
      `${res.rowsAfterEdit} rows, bot=${res.editApplied}`);
check('undo log captured prior versions',   res.historyCount > 0 && res.historyHasPrior,
      `${res.historyCount} versions`);
check('restore rolls data back',            res.restoredBot === 5368 && res.restoredRows === 6,
      `bot=${res.restoredBot}`);
check('soft delete hides the node',         res.deletedHidden === true);
check('deleted node snapshotted + revivable', res.deleteSnapshotted === true && res.revived === true);
check('no page errors',                     pageErrors.length === 0, pageErrors.join('; '));

await browser.close();
console.log(failures ? `\nFAIL — ${failures} check(s) failed` : '\nPASS — all data-safety checks passed');
process.exit(failures ? 1 : 0);
