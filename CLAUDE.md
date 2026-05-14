# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

No build step, no npm, no server required. Open directly in a browser:

```
open index.html
```

All files are plain HTML/CSS/JS. There are no tests, no linter, and no package.json. Syntax-check JS files with:

```
node -e "const fs=require('fs'); new Function(fs.readFileSync('js/filename.js','utf8'))"
```

---

## Architecture

Single-page app. One HTML file, one CSS file, many global JS files loaded via `<script>` tags in `index.html`. No modules, no bundler, no framework — everything is global scope.

### Data flow

```
User input (DOM tables/forms)
  → qpCompute() in compute-engine.js          ← master orchestrator
      → tdCompute() in td-engine.js            ← torque & drag (Johancsik soft-string)
      → _computeHyd() in compute-engine.js     ← hydraulics
      → results stored in qpState (state.js)
  → redrawOutputPanel(name) in state.js        ← dispatches to draw functions
      → drawTorque / drawBuckling / drawOverpull / drawBroomstick (td-charts.js)
      → drawHydSweep / drawHydPie (hydraulics-ui.js)
      → drawAFE (afe-chart.js)
      → drawTrajPlot (trajectory-plot.js)
```

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

### Persistence

- `db-engine.js` — IndexedDB for hierarchy tree and all scenario inputs (survey, BHA, schematic, fluid, trajectory options). Persisted automatically on every change.
- `js/output-controls.js` — `localStorage` for output panel control values (FF sliders, TAB, block weight, MW, flow rate). Restored on page load; a single delegated listener on `document.body` saves on every `change`/`input` event.
- Freeze snapshots and annotation state (CI) are in-memory only and lost on page refresh.

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
