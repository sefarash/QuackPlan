// ===== GUIDED TOUR (first-time users) =====
// A six-step spotlight walk through ONE real result: open a sample well, see
// the trajectory, schematic, string and fluid, run it, look at a chart, then
// change a value and watch the output move.
//
// - The sample well is an ordinary project ("Sample well (tour)") created
//   through the normal API on the user's account, only after they click Start.
//   It is never merged into existing data and can be deleted like any project.
//   Re-running the tour reuses it (RULE #1: additive only, loads never write).
// - The page stays fully interactive under the spotlight (the dim layer does
//   not take clicks); Next/Back drive the panel switches.
// - Progress lives in localStorage 'qp_tour_done' ('done' | 'skipped') — an
//   additive key. Restart from the header "Tour" button or the empty-state gate.
// - Not offered automatically under browser automation (navigator.webdriver);
//   tests call QP_TOUR.offer(true) / QP_TOUR.start() explicitly.

const QP_TOUR = (() => {
  const KEY = 'qp_tour_done';
  const SAMPLE_PROJECT = 'Sample well (tour)';

  // ── Sample well ─────────────────────────────────────────────────────────────
  // Land well, build-and-hold to 35°, three cemented strings + 8½" hole.
  function _sampleScenarioData() {
    const st = (md, inc, azi) => ({ md: String(md), inc: String(inc), azi: String(azi) });
    const spec = (od, wt, grade) => {
      if (typeof catalogueByOD !== 'function' || typeof catalogueSpec !== 'function') return '';
      const r = catalogueByOD(od).find(x => x[1] === wt && x[2] === grade);
      return r ? JSON.stringify(catalogueSpec(r)) : '';
    };
    const casing = (def, od, size, wt, grade, top, bot, toc, hole) => ({
      def, size: String(size), top, bot, toc, hole,
      od, odCustom: '', wt: String(wt), wtCustom: '', grade, gradeCustom: '',
      casingSpec: spec(od, wt, grade),
    });
    return {
      traj1: [st(0, 0, 0), st(1500, 0, 0), st(3000, 15, 45), st(5000, 35, 45), st(9000, 35, 45), st(11000, 35, 45)],
      trajOpt: 'opt1',
      schematic: [
        casing('Conductor',           '20',     20,     94, 'K-55',  0,    300,  0,    26),
        casing('Surface Casing',      '13 3/8', 13.375, 68, 'L-80',  0,    2500, 0,    17.5),
        casing('Intermediate Casing', '9 5/8',  9.625,  47, 'P-110', 0,    7500, 4000, 12.25),
        { def: 'Open Hole', size: '8.5', top: 7500, bot: 11000, toc: '', hole: '', od: '', odCustom: '', wt: '', wtCustom: '', grade: '', gradeCustom: '', casingSpec: '' },
      ],
      fluid: { mudType: 'WBM', model: 'HB', mudWeight: 10.2, pv: 18, yp: 14, gel10s: 6, gel10m: 12,
               tauY: 6, nHB: 0.72, kHB: 220, flowRate: 450, pumpEff: 92, rigSppLimit: 4000, nPL: 0, kPL: 0 },
      bha: [
        { comp: 'Bit',          od: '8.5',  id: '0',     wt: 150,  len: 1,  grade: '', conn: '', catOD: '', catNomWt: '', catGrade: '', catConn: '' },
        { comp: 'PDM',          od: '6.75', id: '3',     wt: 2200, len: 28, grade: '', conn: '', catOD: '', catNomWt: '', catGrade: '', catConn: '' },
        { comp: 'MWD',          od: '6.75', id: '3',     wt: 2000, len: 30, grade: '', conn: '', catOD: '', catNomWt: '', catGrade: '', catConn: '' },
        { comp: 'Drill Collar', od: '6.5',  id: '2.813', wt: 2900, len: 31, grade: '', conn: '', catOD: '', catNomWt: '', catGrade: '', catConn: '' },
        { comp: 'Drill Collar', od: '6.5',  id: '2.813', wt: 2900, len: 31, grade: '', conn: '', catOD: '', catNomWt: '', catGrade: '', catConn: '' },
        { comp: 'HWDP',         od: '5',    id: '3',     wt: 1500, len: 31, grade: '', conn: '', catOD: '', catNomWt: '', catGrade: '', catConn: '' },
        { comp: 'Drill Pipe',   od: '5',    id: '4.276', wt: 650,  len: 30, grade: '', conn: '', catOD: '', catNomWt: '', catGrade: '', catConn: '' },
      ],
      nozzles: [{ size: 14, count: 3 }],
      ppfg: [
        { tvd: 0,     pp: 8.4, fg: 11.0 },
        { tvd: 3000,  pp: 8.6, fg: 12.5 },
        { tvd: 6000,  pp: 9.0, fg: 14.0 },
        { tvd: 9000,  pp: 9.8, fg: 15.2 },
        { tvd: 10000, pp: 10.0, fg: 15.6 },
      ],
    };
  }

  // Borehole-level keys live on the borehole; the scenario holds the string and fluid.
  function _splitSample(all) {
    const bh = {}, sc = {};
    for (const [k, v] of Object.entries(all)) ((QP_BOREHOLE_KEYS || []).includes(k) ? bh : sc)[k] = v;
    return { bh, sc };
  }

  // Find the sample scenario if the project already exists, else create the
  // whole chain. Resolves { scenarioId, boreholeId, created }.
  async function ensureSampleWell() {
    const roots = await dbRoots();
    const proj  = (roots || []).find(n => n.name === SAMPLE_PROJECT && n.type === 'project');
    if (proj) {
      const fields = await dbChildren(proj.id);
      for (const f of fields) {
        for (const w of await dbChildren(f.id)) {
          for (const b of await dbChildren(w.id)) {
            const sc = (await dbChildren(b.id)).find(n => n.type === 'scenario');
            if (sc) return { scenarioId: sc.id, boreholeId: b.id, created: false };
          }
        }
      }
    }
    const pid = proj ? proj.id : await dbAdd({ parentId: null, name: SAMPLE_PROJECT, type: 'project' });
    const fid = await dbAdd({ parentId: pid, name: 'Demo Field', type: 'field' });
    const wid = await dbAdd({ parentId: fid, name: 'Duck-1', type: 'well',
                              data: { environment: 'onshore', rkb: 25, gl: 200, seaBedDepth: 0 } });
    const { bh, sc } = _splitSample(_sampleScenarioData());
    const bid = await dbAdd({ parentId: wid, name: 'Duck-1 main bore', type: 'borehole', data: bh });
    const sid = await dbAdd({ parentId: bid, name: 'Drilling 8½" hole', type: 'scenario', data: sc });
    return { scenarioId: sid, boreholeId: bid, created: true };
  }

  // ── What each output tab needs ───────────────────────────────────────────────
  // Derived from each draw function's inputs / no-data guards. Shown as a tour
  // step, from the footer "?" button, and in the manual.
  const NEEDS = [
    { tab: 'Profile',        needs: ['Trajectory'],                                                        opt: 'Well Schematic for shoe markers' },
    { tab: 'Torque · Buckling · Overpull · Broomstick', needs: ['Trajectory', 'Well Schematic', 'Casing / BHA', 'Drilling Fluid (mud weight)'], opt: 'panel controls: WOB, friction factors — then Run' },
    { tab: 'SPP / ECD',      needs: ['Trajectory', 'Well Schematic', 'Casing / BHA (DP ID, nozzles, MWD loss)', 'Drilling Fluid (rheology, flow rate)'], opt: 'Fluid Program per section — then Run' },
    { tab: 'Surge / Swab',   needs: ['Trajectory', 'Well Schematic', 'Casing / BHA', 'Drilling Fluid'],   opt: 'PPFG for the safe trip-speed tables' },
    { tab: 'Casing Design',  needs: ['Well Schematic with catalogue weight & grade (and TOC)', 'Trajectory', 'PPFG', 'Drilling Fluid (mud weight)'], opt: 'ratings, P-test and cement density on the panel' },
    { tab: 'Kick Tolerance', needs: ['PPFG', 'Trajectory', 'Well Schematic', 'Drilling Fluid (mud weight)', 'Casing / BHA'], opt: 'temperature and influx inputs on the panel' },
    { tab: 'Initial AFE',    needs: ['Activity (activities, services, casing costs)', 'Well Schematic'], opt: '' },
    { tab: 'Final Diagram',  needs: ['Trajectory', 'Well Schematic'],                                     opt: 'Handover elements drawn along the path' },
  ];
  function needsHTML() {
    return `<table class="tour-needs"><thead><tr><th>Output tab</th><th>Needs</th><th>Optional</th></tr></thead><tbody>` +
      NEEDS.map(n => `<tr><td><b>${n.tab}</b></td><td>${n.needs.join(' · ')}</td><td>${n.opt || '—'}</td></tr>`).join('') +
      `</tbody></table>`;
  }
  // Standalone popover (footer "?" button) — same card, no step navigation
  function showNeeds() {
    _els();
    _idx = -1;
    _card.innerHTML = `
      <div class="tour-step">Outputs</div>
      <div class="tour-title">What each result needs</div>
      <div class="tour-text">Fill the input tabs listed, press <b>Run</b>, then open the tab. A tab that is missing something tells you what to add.</div>
      ${needsHTML()}
      <div class="tour-actions"><span style="flex:1"></span><button class="btn btn-primary" onclick="QP_TOUR.hideNeeds()">Close</button></div>`;
    _card.classList.add('wide');
    _card.hidden = false;
    _place({ target: '#outputTabs' });
    _needsOpen = true;
  }
  let _needsOpen = false;
  function hideNeeds() {
    _needsOpen = false;
    if (_card) { _card.hidden = true; _card.classList.remove('wide'); }
    if (_spot) _spot.hidden = true;                          // the frame must go with the card
  }

  // ── Steps ───────────────────────────────────────────────────────────────────
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const inputTab  = name => { const b = document.querySelector(`#inputTabs .input-tab[onclick*="'${name}'"]`); if (b && typeof switchInputTab === 'function') switchInputTab(name, b); };
  const outputTab = name => { const b = document.querySelector(`#outputTabs .output-tab[onclick*="'${name}'"]`); if (b && typeof switchOutputTab === 'function') switchOutputTab(name, b); };

  const STEPS = [
    {
      title: 'Everything lives in a scenario',
      text: 'Project → Field → Well → <b>Borehole</b> → <b>Scenario</b>. Build the trajectory, schematic, PPFG and activity at the borehole — every scenario under it shares them. A scenario adds the string, the fluid and the results. This is the sample well we just created for you.',
      target: '#hierarchyTree',
      before: async () => { await wait(300); },
    },
    {
      title: 'Trajectory',
      text: 'Option 1 takes MD, inclination and azimuth; TVD and dog-leg fill in as you type. You can paste MD / Inc / Azi columns straight from Excel or import a WITSML file.',
      target: '#traj1Table',
      before: async () => { inputTab('trajectory'); await wait(200); },
    },
    {
      title: 'Well schematic',
      text: 'The casing program is defined once at the <b>borehole</b> — this is that definition, drawn on the right with TOC and cement. Each string has a size, weight and grade from the catalogue, the hole it is run in, and the TOC. A scenario works on its own copy: next tab.',
      target: ['#schematicBoreholeView', '#schematicCanvas'],
      before: async () => { inputTab('schematic'); await wait(200); },
    },
    {
      title: 'Casing program, string and mud',
      text: 'Casing / BHA holds this scenario\'s <b>copy of the casing program</b> — edit it here without touching the borehole — and the BHA, entered <b>bit first</b>. On the Drilling Fluid tab the form shows only the rheology model you pick, and each hole section can carry its own fluid.',
      target: ['#schematicScenarioSlot', '#bhaTable'],
      before: async () => { inputTab('bha'); await wait(200); },
    },
    {
      title: 'Run it',
      text: 'We just pressed <b>Run</b> for you. The footer tabs hold every result: torque &amp; drag, hydraulics, surge/swab, casing design, kick tolerance, AFE. Hover a chart for the crosshair; freeze a curve to compare against later changes.',
      target: '#outputTabs',
      before: async () => {
        if (typeof qpCompute === 'function') await qpCompute();
        outputTab('torque'); await wait(300);
      },
    },
    {
      title: 'What each result needs',
      text: 'Every output tab reads a few input tabs. This is the map — a tab that is missing something tells you what to add. You can open this table any time from the <b>?</b> button in the footer.',
      target: '#outputTabs',
      wide: true,
      html: () => needsHTML(),
      before: async () => { await wait(100); },
    },
    {
      title: 'Make it yours',
      text: 'Change the mud weight here, then open <b>SPP / ECD</b> in the footer and watch ECD move. When you are ready, start your own well with <b>+ Project</b> in the header. You can replay this tour from the <b>Tour</b> button.',
      target: '#mudWeight',
      before: async () => { inputTab('fluid'); await wait(200); },
    },
  ];

  // ── Overlay ─────────────────────────────────────────────────────────────────
  let _idx = -1, _spot = null, _card = null, _onMove = null;

  function _els() {
    if (_spot) return;
    _spot = document.createElement('div'); _spot.className = 'tour-spot'; _spot.hidden = true;
    _card = document.createElement('div'); _card.className = 'tour-card'; _card.hidden = true;
    document.body.appendChild(_spot); document.body.appendChild(_card);
    _onMove = () => { if (_idx >= 0) _place(STEPS[_idx]); };
    window.addEventListener('resize', _onMove);
    window.addEventListener('scroll', _onMove, true);
    document.addEventListener('keydown', _onKey);
  }
  function _onKey(e) {
    if (_idx < 0) { if (_needsOpen && e.key === 'Escape') hideNeeds(); return; }
    if (e.key === 'Escape') skip();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
    else if (e.key === 'ArrowLeft') back();
  }
  function _rectOf(target) {
    const sels = Array.isArray(target) ? target : [target];
    let r = null;
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      r = r ? { left: Math.min(r.left, b.left), top: Math.min(r.top, b.top),
                right: Math.max(r.right, b.right), bottom: Math.max(r.bottom, b.bottom) }
            : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    }
    return r;
  }
  function _place(step) {
    const r = _rectOf(step.target);
    const pad = 6;
    if (r) {
      _spot.hidden = false;
      Object.assign(_spot.style, { left: (r.left - pad) + 'px', top: (r.top - pad) + 'px',
                                   width: (r.right - r.left + 2 * pad) + 'px', height: (r.bottom - r.top + 2 * pad) + 'px' });
    } else {
      _spot.hidden = true;                                   // target not on screen: card only
    }
    // Card below the target if it fits, else above, else centred; clamped to the viewport
    _card.hidden = false;
    const cw = _card.offsetWidth, ch = _card.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let left = r ? Math.min(Math.max(r.left, 12), vw - cw - 12) : (vw - cw) / 2;
    let top;
    if (!r) top = (vh - ch) / 2;
    else if (r.bottom + 12 + ch < vh) top = r.bottom + 12;
    else if (r.top - 12 - ch > 0) top = r.top - 12 - ch;
    else top = Math.max(12, vh - ch - 12);
    Object.assign(_card.style, { left: left + 'px', top: top + 'px' });
  }
  function _render(i) {
    const step = STEPS[i], last = i === STEPS.length - 1;
    _card.classList.toggle('wide', !!step.wide);
    _card.innerHTML = `
      <div class="tour-step">Step ${i + 1} of ${STEPS.length}</div>
      <div class="tour-title">${step.title}</div>
      <div class="tour-text">${step.text}</div>
      ${step.html ? step.html() : ''}
      <div class="tour-actions">
        <button class="btn btn-cancel" onclick="QP_TOUR.skip()">Skip tour</button>
        <span style="flex:1"></span>
        ${i > 0 ? '<button class="btn" onclick="QP_TOUR.back()">Back</button>' : ''}
        <button class="btn btn-primary" onclick="QP_TOUR.next()">${last ? 'Finish' : 'Next'}</button>
      </div>`;
    _place(step);
  }
  async function _go(i) {
    if (i < 0 || i >= STEPS.length) { _finish('done'); return; }
    _idx = i;
    try { if (STEPS[i].before) await STEPS[i].before(); } catch (e) { console.warn('tour step', i, e); }
    if (_idx !== i) return;                                  // user moved on meanwhile
    _render(i);
  }
  function _finish(status) {
    _idx = -1;
    if (_spot) _spot.hidden = true;
    if (_card) _card.hidden = true;
    try { localStorage.setItem(KEY, status); } catch (_) {}
    if (typeof setStatus === 'function') setStatus(status === 'done' ? 'Tour finished — start your own well with + Project' : 'Tour skipped — replay it any time from the Tour button');
  }

  // ── Welcome dialog ──────────────────────────────────────────────────────────
  let _welcome = null;
  function _showWelcome() {
    if (!_welcome) {
      _welcome = document.createElement('div');
      _welcome.className = 'modal-backdrop tour-welcome';
      _welcome.innerHTML = `
        <div class="modal" style="max-width:440px">
          <div class="modal-title">🦆 Welcome to QuackPlan</div>
          <p style="font-size:13px;line-height:1.5;margin:8px 0 14px">
            Take a two-minute tour? We'll create a <b>sample well</b> on your account and walk
            through it: trajectory, casing, string and mud, then run it and look at the results.
            The sample is an ordinary project you can delete afterwards.
          </p>
          <div class="modal-actions">
            <button class="btn btn-cancel" onclick="QP_TOUR.dismiss()">Not now</button>
            <button class="btn btn-primary" onclick="QP_TOUR.start()">Start the tour</button>
          </div>
        </div>`;
      document.body.appendChild(_welcome);
    }
    _welcome.classList.add('open');
  }
  function _hideWelcome() { if (_welcome) _welcome.classList.remove('open'); }

  // ── Public API ──────────────────────────────────────────────────────────────
  function offer(force) {
    if (!force) {
      if (navigator.webdriver) return false;                 // automated runs: never auto-offer
      let done = null; try { done = localStorage.getItem(KEY); } catch (_) {}
      if (done) return false;
    }
    _showWelcome();
    return true;
  }
  function dismiss() { _hideWelcome(); try { localStorage.setItem(KEY, 'skipped'); } catch (_) {} }
  async function start() {
    _hideWelcome();
    _els();
    if (typeof setStatus === 'function') setStatus('Preparing the sample well…');
    try {
      const { scenarioId, boreholeId } = await ensureSampleWell();
      if (typeof hierarchyRefresh === 'function') await hierarchyRefresh();
      if (typeof _selectNode === 'function') _selectNode({ id: scenarioId, type: 'scenario', parentId: boreholeId, name: 'Drilling 8½" hole' });
      await wait(1500);                                      // let the scenario load and draw
    } catch (e) {
      console.error('tour: sample well', e);
      if (typeof setStatus === 'function') setStatus('Could not create the sample well — check your connection and try the Tour button again', true);
      return;
    }
    _go(0);
  }
  function next() { _go(_idx + 1); }
  function back() { _go(Math.max(0, _idx - 1)); }
  function skip() { _finish('skipped'); }
  function active() { return _idx >= 0; }
  function step() { return _idx; }

  return { offer, dismiss, start, next, back, skip, active, step, showNeeds, hideNeeds, needsHTML, NEEDS, ensureSampleWell, SAMPLE_PROJECT, KEY };
})();
