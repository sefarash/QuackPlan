# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠ RULE #1 — USER DATA IS SACRED

**No code change may ever affect, delete, overwrite, or strand user data.** Users store real
well-planning work (projects → wells → scenarios) in the production D1 database — and, for the
pre-server era, in browser IndexedDB/localStorage. This rule applies to EVERY change:

- **DB schema:** additive migrations only (`migrations/000N_*.sql`, new `if`-guarded steps).
  NEVER `DROP`/`DELETE`/rewrite existing tables or edit an already-shipped migration.
  Never run destructive SQL against the remote DB.
- **API/Worker:** endpoints must never mass-delete or overwrite nodes beyond exactly what the
  user asked for (deletes are scoped to the node + its descendants, per owner).
- **Client:** load/init paths must never auto-save empty/default state over stored data; saves go
  through `dbSaveScenarioData` (atomic per-key). Imports/restores are ADDITIVE — create new
  nodes, never replace or merge-over existing ones.
- **Serialization/rename:** never rename or repurpose stored data keys (`traj1`, `bha`, `fluid`,
  `schematic`, …) without a migration that carries the old data forward.
- **localStorage:** keys like `qp_token`, `qp_lastScenarioId`, `qp_sch_offsets_*`,
  `qp_fd_offsets_*` may be added to, but not cleared or repurposed.
- **Verify before deploy:** any change that touches persistence must be proven data-safe
  (round-trip test: existing data still loads unchanged after the change).

When in doubt, prefer leaving stale data unread over migrating it destructively — unread data is
recoverable, deleted data is not.

## Running the app

Local dev needs the Worker (the app is served by a Cloudflare Worker with a D1-backed API):

```
npm install                    # once — installs wrangler (dev tooling only; client stays framework-free)
npx wrangler d1 migrations apply quackplan-db --local   # once per fresh checkout
npx wrangler dev --local       # serves app + API at http://localhost:8787
```

Production: `npx wrangler deploy` (after `wrangler login`). Live at https://quackplan.com.

All client files are plain HTML/CSS/JS — no build step, no bundler, no framework. There are no
tests and no linter. Syntax-check JS files with:

```
node -e "const fs=require('fs'); new Function(fs.readFileSync('js/filename.js','utf8'))"
```

---

## Architecture

Single-page app. One HTML file, one CSS file, many global JS files loaded via `<script>` tags in `index.html`. No modules, no bundler, no framework — everything is global scope.

### Data flow

```
User input (DOM tables/forms)
  → qpCompute() in compute-engine.js          ← master orchestrator (async)
      → tdComputeAsync() in td-worker-client.js ← T&D in a Web Worker (falls back to sync tdCompute)
          → tdCompute() in td-engine.js        ← torque & drag (Johancsik soft-string), pure fn
      → _computeHyd() in compute-engine.js     ← hydraulics (main thread — reads DOM)
      → results stored in qpState (state.js)
  → redrawOutputPanel(name) in state.js        ← dispatches to draw functions
      → drawTorque / drawBuckling / drawOverpull / drawBroomstick (td-charts.js)
      → drawHydSweep / drawHydPie (hydraulics-ui.js)
      → drawAFE (afe-chart.js)
      → drawTrajPlot (trajectory-plot.js)
```

**T&D Web Worker.** `qpCompute()` is `async`: it offloads the main T&D run to a Worker
(`js/td-worker.js`, which `importScripts('td-engine.js')`) via `tdComputeAsync()`
(`js/td-worker-client.js`). `tdCompute()` is a pure, DOM-free function, so it runs
standalone in the Worker. Workers **cannot be constructed from a `file://` origin**, so
`tdComputeAsync()` transparently falls back to synchronous main-thread `tdCompute()` when
the Worker is unavailable (file://, old browser, or runtime failure) — it never rejects.
A generation counter (`_qpComputeGen`) drops a stale async result if a newer `qpCompute()`
started while awaiting. The four T&D chart draw functions still call `tdCompute()`
**synchronously** (for their inline FF-sensitivity curves) — only the primary
`qpCompute()` path is offloaded. `td-engine.js` is loaded on the main thread (via
`<script>`) too, for the fallback and the draw functions.

### Global state

`qpState` (state.js) holds:
- `survey` — the **effective** survey used by all computations: `[{md, inc, az, north, east, tvd, dls}]`. When tortuosity is active this is the tortured survey; otherwise it equals `baseSurvey`.
- `baseSurvey` — the **clean planned** survey straight from Option 1 / Option 2, without tortuosity. `tortRecalc()` always starts from this so tortuosity cannot stack on itself.
- `tdResult` — output of `tdCompute()`, passed to all T&D draw functions
- `hydResult` — output of `_computeHyd()`, passed to hydraulics draw functions
- `activeOutputTab` — name string of the currently visible output panel

### Survey pipeline

```
Option 1 (traj1Recalc)  ─┐
                          ├─→ computeSurvey()  →  qpState.baseSurvey
Option 2 (traj2Recalc)  ─┘       (survey-engine.js, minimum curvature)
                                                          │
                                                          ▼
                                          tortRecalc()  (if intervals)
                                          applyTortuosity()  →  qpState.survey
                                          (trajectory-solver.js)
                                                          │
                                                          ▼
                                                    qpCompute()
```

Option 2 mixed-criteria rows are pre-solved by `traj2BuildStations()` in `trajectory-solver.js` before being passed to `computeSurvey()`. `tortRecalc()` reads `qpState.baseSurvey` as its source and writes `qpState.survey`, then calls `qpCompute()` so all output panels update immediately.

### Chart coordinate conventions

Two grid helpers exist in `td-charts.js` with opposite Y orientations:

- `_chartGrid()` — Y=0 at canvas **bottom**, Y=max at **top** (Torque, Overpull, Hydraulics). `_chartLine()` maps: `y = t + (1 - p.y/yMax) * ph`
- `_chartGridDepthDown()` — Y=0 at canvas **top**, Y=max at **bottom** (Broomstick, Trajectory VS). `_chartLineDepthDown()` maps: `y = t + (p.y/yMax) * ph`

When calling `CI.register()`, set `depthDown: true` only for `_chartGridDepthDown` charts.

### Chart interaction layer (CI)

`js/chart-interaction.js` exports a single `CI` object (IIFE). Every output canvas must call:

1. `CI.storeLive(canvasId, curves)` — store current plotted curve data (array of `{pts, color, label}`) so freeze can snapshot it
2. `CI.register(canvasId, meta)` — register coordinate bounds `{pad, xMax, yMax, xLabel, yLabel, depthDown, xOffset?, yOffset?}` after drawing the grid
3. `CI.drawFrozen(ctx, canvasId)` — draw frozen snapshots (call before live curves)
4. `CI.drawAnnotations(ctx, canvasId)` — draw annotation pins (call after live curves)

Canvas elements also need `CI.attach(canvasId)` called once on `DOMContentLoaded` (in the inline script at the bottom of `index.html`).

### Adding a new output tab

1. Add `<div id="panel-{name}" class="output-panel">` with a `<canvas id="{name}Canvas">` in `index.html`
2. Add `<button class="output-tab" onclick="switchOutputTab('{name}',this)">` in the footer
3. Add `else if (name === '{name}') drawMyChart();` in `redrawOutputPanel()` in `state.js`
4. Add `CI.attach('{name}Canvas')` to the DOMContentLoaded array in `index.html`
5. Create `js/my-chart.js` following the pattern: `_chartSetup` → compute data → `CI.storeLive` → `CI.register` → `CI.drawFrozen` → draw lines → `CI.drawAnnotations`
6. Add `<script src="js/my-chart.js">` before `compare-ui.js` in `index.html`

### Reading input from the DOM

There is no reactive state for inputs — all input panels read directly from DOM at compute time:
- `bhaGet()` (bha-input.js) — reads BHA table rows
- `fluidGet()` (fluid-input.js) — reads fluid form fields
- `activityGet()` (activity-input.js) — reads activity, services, casing tables
- `_readSchematicRows()` (well-schematic-draw.js) — reads schematic table rows

Torque and Overpull draw functions call `tdCompute()` directly for each FF sensitivity curve rather than reusing the stored result.

### Unit system (`js/units.js`)

`QP_UNITS` holds the active system (`imperial` | `metric`, persisted in localStorage; header toggle). **Imperial is canonical**: everything stored in the database (D1 via the API), in `qpState`, and inside every compute engine is imperial. Conversion happens *only* at the display/input boundary:

- `QP_UNITS.fromDisplay(qty, v)` — input field (display) → imperial, at read/save time
- `QP_UNITS.toDisplay(qty, v)` — imperial → display, when rendering cells/labels/charts
- `QP_UNITS.label(qty)` — the unit string for the header/axis
- `QP_UNITS.onChange((newSys, oldSys) => …)` — re-render hook; convert visible input fields with `QP_UNITS.convert(qty, v, oldSys, newSys)`

Quantities: `depth, diam, mw, press, force, torque, torque_k, flow, linwt, dls, angle, visc, yieldstress, mass, volume, pgrad`. In imperial every factor is 1, so converted code is byte-for-byte identical to pre-units behaviour. **Converted: Trajectory Option 1 + plot, Fluid, full Hydraulics (charts + MW/flow sliders), Well Schematic, BHA table, AFE + Activity depth, Casing design, Kick Tolerance (PPFG table + chart, KT inputs/results — temperature is an inline offset conversion since the module is factor-only; the engine keeps imperial internally), and all four T&D charts (Torque, Buckling, Overpull, Broomstick).** The unit system now applies across every output panel. T&D chart controls are read display→imperial via `fromDisplay` (empty fields fall back to the imperial HTML default un-converted); charts compute in imperial then convert axes/points/labels to display; `_tdUpdateControlLabels()` (td-charts.js) relabels the control unit spans on unit change / DOMContentLoaded. `torque_k` is the ×1000-scaled torque quantity for the torque axis + Max-Torque input (imperial `kft·lb`, metric `kN·m`). The casing ratings have an in-memory canonical store; `_readCDRatings` uses it (not stale DOM) while `_cdUnitsToggling` is set during a unit toggle. The schematic depth chokepoints are `_readSchematicRows`/`schematicSave` (fromDisplay) and `schematicAddRow` (toDisplay); `_readSchematicRows` returns imperial to every consumer (T&D, hydraulics, casing, trajectory plot). BHA chokepoints: `bhaGet`/`bhaSave` (fromDisplay), `_makeBhaRowHTML` (toDisplay); any `adjWt × length` weight calc must convert length to imperial ft first (adjWt is lb/ft).

**Range sliders** (hydraulics MW/flow): `output-controls.js` stores them in imperial via `_OC_UNITS` and shows display values. On load / unit toggle the slider min/max must be set from the number inputs BEFORE the value (a range input clamps its value to the stale range otherwise) — see `_ocRetuneSliders()`, which captures the old value, converts the min/max inputs, syncs the range, then re-applies the converted value.

### Persistence

**See RULE #1 at the top — no change may ever affect user data.**

- `db-engine.js` — thin client for the Worker API (`/api/nodes`, `/api/auth`); data lives in
  **Cloudflare D1** (`worker/index.js`, `migrations/`), private per user account. Function names
  and promise contracts are unchanged from the old IndexedDB engine, so callers didn't change.
  Per-key scenario saves are atomic (`json_set`) — no read-modify-write races.
- `js/auth-ui.js` — login/signup overlay; session token in localStorage `qp_token`;
  `hierarchyBoot()` loads the tree only after auth.
- Output-panel controls are saved per-scenario into the scenario node (`outputControls` key).
- `localStorage` also holds: unit system, theme, `qp_lastScenarioId`, label-drag offsets
  (`qp_sch_offsets_*`, `qp_fd_offsets_*`).
- Freeze snapshots and annotation state (CI) are in-memory only and lost on page refresh.
- Safety nets: per-scenario ⬇ Export / ⬆ Import (import creates a NEW project) and whole-tree
  ⬇ Backup / ⬆ Restore (additive, id-remapped) — in the toolbar next to the Well Schematic.

### Catalogue and custom overrides

**Well Schematic** (`trajectory-input.js`): Size (OD), Weight, and Grade dropdowns each include a `Custom…` option. Selecting it reveals a text input in the same cell. Custom values are saved as `odCustom`, `wtCustom`, `gradeCustom` fields alongside the select values. `_readSchematicRows()` in `well-schematic-draw.js` checks for custom values and uses them in canvas labels when no catalogue spec is present.

**BHA** (`bha-input.js`): Drill Pipe, Drill Collar, and HWDP OD dropdowns include `Custom…`. Selecting it reveals a number input; typing updates the hidden `.bha-od-n` value via `_bhaOdCustomInput()`. Grade/Connection cascade clears when custom OD is active. The `catOD='custom'` value is persisted so the row restores correctly on reload.

---

## Key files

| File | Purpose |
|------|---------|
| `js/td-engine.js` | Johancsik soft-string T&D model — `tdCompute()` is the main entry point |
| `js/survey-engine.js` | Minimum curvature — `computeSurvey()` |
| `js/rheology-engine.js` | HB / BP / PL rheology — `computeRheology()` |
| `js/trajectory-solver.js` | Option 2 mixed-criteria solver + `applyTortuosity()` |
| `js/chart-interaction.js` | Crosshair, freeze, annotation layer — `CI` object |
| `js/state.js` | `qpState`, `switchOutputTab()`, `redrawOutputPanel()` |
| `js/compute-engine.js` | `qpCompute()` orchestrator + hydraulics calculation |
| `js/well-schematic-draw.js` | Right-panel schematic canvas + `_readSchematicRows()` |
| `js/output-controls.js` | Output panel control persistence (localStorage) |
| `js/hierarchy-ui.js` | Project/well/scenario tree — collapsible, persists collapse state |
| `js/bha-catalogue.js` | Drill pipe, drill collar, HWDP catalogue data + lookup helpers |

---

## Implemented features (current)

| Area | Status |
|------|--------|
| Trajectory Option 1 (MD / Inc / Azi) | Done |
| Trajectory Option 2 (mixed criteria: MD, Inc/Azi, TVD, DLS, Hold) | Done |
| Tortuosity (random + sinusoidal) — wired into T&D and all outputs | Done |
| Torque & Drag (Johancsik soft-string, 3 FF curves) | Done |
| Buckling analysis | Done |
| Overpull sensitivity | Done |
| Broomstick plot | Done |
| Hydraulics (HB/BP/PL rheology, ECD, pressure loss) | Done |
| Well schematic canvas (grade, weight, TVD, MD labels at shoe) | Done |
| BHA table (DP / DC / HWDP catalogue + custom OD override) | Done |
| Casing design (burst / collapse SF) | Done |
| AFE cost estimation | Done |
| Trajectory plan view + VS plot | Done |
| Project / well / scenario hierarchy (collapsible, IndexedDB) | Done |
| Output panel control persistence (localStorage) | Done |
| Catalogue custom overrides (schematic OD / weight / grade; BHA OD) | Done |

---

## Future integration roadmap

The compute engines (`tdCompute`, `computeSurvey`, `computeRheology`, etc.) are pure functions that accept plain JS arrays and return plain JS objects. They are completely decoupled from the data layer. This is the key architectural property that makes all future integration phases feasible without rewriting the calculation core.

### Phase 1 — Structured JSON export / import (no server needed)
Export the full scenario (survey, BHA, fluid, schematic, T&D results) as a versioned JSON document. Import restores the full state. This JSON schema becomes the **internal data contract** that all later integration phases map to and from.

Priority: defines the data model that phases 2–5 depend on.

### Phase 2 — CSV export (no server needed)
Flat CSV files for: survey stations, BHA string, T&D results (hook load vs depth), hydraulics summary. Covers the majority of real-world data exchange (engineers copy/paste into Excel today).

### Phase 3 — WITSML import (read-only)

**File-based (no server needed):** Add a file input that accepts `.xml`. Parse with the browser's built-in `DOMParser`, extract `<md>`, `<incl>`, `<azi>` from `<trajectoryStation>` elements, map to `{md, inc, az}`, call `traj1Recalc()`. No architecture change required.

**Live WITSML server:** Requires a proxy server (see Phase 4) because browsers block direct cross-origin requests to WITSML endpoints. The JS call becomes `fetch('/api/witsml?well=...')` — minimal change to application code, but "open index.html" no longer works standalone.

WITSML versions in common use: 1.3.1, 1.4.1, 2.0. Each has a different schema. Target 1.4.1 first (most widely deployed on rigs).

### Phase 4 — Node.js proxy server (thin)
A lightweight Express server (~100 lines) that:
- Serves the app (replacing direct file open)
- Forwards requests to WITSML servers and EDR APIs, bypassing browser CORS restrictions
- Handles API keys / basic auth so credentials stay server-side

Scenario data stays in the browser's IndexedDB — the server is stateless. No database required. `qpState` and all persistence code are unchanged.

Deployment: `node server.js` locally, or a small cloud instance. This is the minimum viable server footprint.

### Phase 5 — REST API (third-party tools pull from QuackPlan)
Expose computed results so external tools can query them:

```
GET /api/scenario/:id/survey          → survey stations array
GET /api/scenario/:id/td-results      → hook load, torque vs depth
GET /api/scenario/:id/hydraulics      → ECD, pressure loss, flow sweep
GET /api/scenario/:id/bha             → BHA string with specs
GET /api/scenario/:id/export          → full Phase 1 JSON document
```

This requires scenarios to move from browser IndexedDB to a server-side store (SQLite or Postgres), which is the most significant architectural change in the roadmap. Every `dbSaveScenarioData()` call in `db-engine.js` would be replaced with a `fetch('/api/...')` POST. The hierarchy UI and load/save logic in `hierarchy-ui.js` would need corresponding updates.

Side effect: scenarios become shareable across users and devices.

### Phase 5b — Webhook push (QuackPlan notifies third parties)
When a scenario is computed, POST the results to a registered URL. Third-party registers once; QuackPlan pushes on every `qpCompute()`. Simpler integration contract than polling a REST API. Requires Phase 4 server to be in place.

### Integration decision tree

```
Third party needs data from QuackPlan?
  └─ Can they accept a file?        → Phase 1 / 2 (JSON or CSV export)
  └─ Can they receive a webhook?    → Phase 5b
  └─ They need to pull on demand?   → Phase 5 REST API

QuackPlan needs data from third party?
  └─ File upload acceptable?        → Phase 3 file-based
  └─ Must connect to live system?   → Phase 4 proxy + Phase 3 live WITSML
```

### What will NOT change regardless of phase

- All computation engines — they are integration-agnostic pure functions
- Canvas drawing code — reads from `qpState`, doesn't care how data arrived
- HTML/CSS UI structure — no framework migration required
- `qpState` data flow pattern (`survey → compute → draw`)
- The no-bundler, no-framework constraint — can be maintained through all phases

---

## Multi-user roadmap

Multi-user is a spectrum. Each level builds on the previous one and the jump in engineering complexity is non-linear. Do not skip levels.

### Level 1 — User accounts (auth, private data, any device)

Each user logs in; their wells are private to them but stored centrally so they can access them from any machine.

**What changes:**
- Scenarios move from browser `IndexedDB` to a server-side database. Every `dbSaveScenarioData()` call in `db-engine.js` becomes a `fetch('/api/...')` POST. `db-engine.js` is the single file to replace.
- Auth layer: signup, login, session token (JWT or cookie). The app checks for a valid session on load; unauthenticated users see a login screen.
- The project hierarchy (currently flat per-browser) becomes per-user in the database.

**Recommended stack (low ops burden):**
- **Cloudflare Workers + D1** (SQLite at the edge, generous free tier, zero server management) — best fit for a solo dev.
- **Supabase** (Postgres + built-in auth + auto-generated REST API) — faster to stand up if SQL familiarity is low.

**Effort:** 1–2 weeks. This is the gate that unlocks all subsequent levels.

**Code impact:** `db-engine.js` rewrite + login UI. Compute engines, chart code, and input panels are untouched.

---

### Level 2 — Sharing (read-only links)

A user generates a share link for a well plan. The recipient can view results but not edit.

**What changes on top of Level 1:**
- Permission model: each scenario/well gets a `visibility` flag (`private` | `shared`) and an `owner_id`.
- Share-link generation: a short token stored in the database maps to a scenario ID. Anyone with the token can `GET` the scenario but not `POST`/`PATCH`.
- The UI adds a "Share" button that copies the link to clipboard.
- The app renders a read-only mode when loaded with a share token (inputs disabled, no save calls).

**Effort:** ~1 week on top of Level 1.

**Code impact:** permission check middleware server-side; `readonly` flag passed to the app that disables all `onchange` handlers and save calls.

---

### Level 3 — Real-time collaboration (multiple editors, same well)

Two engineers edit the same scenario simultaneously and see each other's changes.

**This is where complexity increases non-linearly. Do not underestimate it.**

**Problems that must be solved:**

| Problem | Options | Notes |
|---|---|---|
| Conflict resolution | Last-write-wins / operational transforms / CRDTs | Last-write-wins is simplest but loses data; CRDTs (e.g. Yjs) are correct but complex |
| Real-time transport | WebSockets (Socket.io) or Server-Sent Events | WebSockets needed for bi-directional sync |
| Presence awareness | "Alice is editing BHA row 3" indicator | Requires cursor/field tracking |
| Optimistic UI | Show local changes immediately before server confirms | Adds rollback complexity |
| Offline / reconnect | What happens when a user loses connection mid-edit | Must reconcile on reconnect |

**Recommended library if pursuing this:** [Yjs](https://yjs.dev/) — a battle-tested CRDT library that can sync arbitrary JS objects. It has a learning curve but removes the need to write custom conflict resolution.

**Effort:** 4–8 weeks minimum. Linear, Figma, and Notion took years to get this right. Budget 5× your initial estimate.

**Do not attempt Level 3 before Level 1 and 2 are stable and in production.**

---

### Level 4 — Organizations and teams

Companies have many users, role-based permissions, shared resource libraries (casing catalogues, fluid templates), and billing per seat.

**What changes on top of Level 3:**
- `org_id` added to every entity (user, well, scenario, catalogue entry).
- Role model: `admin` | `engineer` | `viewer` per org. Admins manage members and billing; engineers create/edit; viewers read-only.
- Shared catalogues: org-level BHA component libraries, casing specs, fluid templates that all members can access.
- Billing: seat count, plan limits, usage metering.
- Audit log: who changed what, when — required by many operators.

**Effort:** 2–4 months of sustained engineering. This is a product in itself, not a feature.

---

### Multi-user decision guide

```
Do you need users on different devices?    → Level 1 (start here)
Do engineers need to share results?        → Level 2
Do two engineers edit the same well?       → Level 3 (high effort, validate need first)
Do you have multiple companies/teams?      → Level 4
```

### Architectural prerequisite for any level

**Phase 1 JSON export (integration roadmap) must be done first.** The JSON schema it produces becomes the canonical data model that the server database stores, the API exchanges, and the sync layer operates on. Building multi-user without a defined data contract first leads to schema churn that costs weeks.

### What will NOT change at any level

- All computation engines (`tdCompute`, `computeSurvey`, `computeRheology`, etc.) — pure functions, no network dependency
- Canvas drawing and chart interaction code
- Input panel HTML and read-at-compute-time pattern
- `qpState` in-memory flow (`survey → compute → draw`) — the server just becomes the source that populates it on load
