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
- `survey` — full minimum-curvature survey array `[{md, inc, az, north, east, tvd, dls}]`
- `tdResult` — output of `tdCompute()`, passed to all T&D draw functions
- `hydResult` — output of `_computeHyd()`, passed to hydraulics draw functions
- `activeOutputTab` — name string of the currently visible output panel

### Survey pipeline

User fills Trajectory input tab → `trajectory-input.js` calls `computeSurvey()` (survey-engine.js, minimum curvature) → stores result in `qpState.survey`. Option 2 mixed-criteria rows are pre-solved by `trajectory-solver.js` before being passed to `computeSurvey()`. Tortuosity is applied via `applyTortuosity()` in survey-engine.js.

### Chart coordinate conventions

Two grid helpers exist in `td-charts.js` with opposite Y orientations:

- `_chartGrid()` — Y=0 at canvas **bottom**, Y=max at **top** (used by Torque, Overpull, Hydraulics). `_chartLine()` maps: `y = t + (1 - p.y/yMax) * ph`
- `_chartGridDepthDown()` — Y=0 at canvas **top**, Y=max at **bottom** (used by Broomstick, Trajectory VS). `_chartLineDepthDown()` maps: `y = t + (p.y/yMax) * ph`

When calling `CI.register()`, set `depthDown: true` only for `_chartGridDepthDown` charts. The CI crosshair tooltip inverts the coordinate accordingly.

### Chart interaction layer (CI)

`js/chart-interaction.js` exports a single `CI` object (IIFE). Every output canvas must call:

1. `CI.storeLive(canvasId, curves)` — store current plotted curve data (array of `{pts, color, label}`) so freeze can snapshot it
2. `CI.register(canvasId, meta)` — register coordinate bounds `{pad, xMax, yMax, xLabel, yLabel, depthDown, xOffset?, yOffset?}` after drawing the grid
3. `CI.drawFrozen(ctx, canvasId)` — draw frozen snapshots (call before live curves)
4. `CI.drawAnnotations(ctx, canvasId)` — draw annotation pins (call after live curves)

Canvas elements also need `CI.attach(canvasId)` called once on `DOMContentLoaded` (in the inline script at the bottom of `index.html`).

The `xOffset`/`yOffset` meta fields shift the tooltip coordinate origin — used by the plan view canvas so the tooltip shows real Easting/Northing rather than plot-relative values.

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

These are called from `qpCompute()` and from draw functions that need to re-run sensitivity computations (Torque, Overpull each call `tdCompute()` directly for each FF value rather than reusing the stored result).

### Persistence

`db-engine.js` handles `localStorage` serialization. The hierarchy tree and all scenario inputs are persisted automatically on change. Freeze snapshots and annotation state in CI are in-memory only and lost on page refresh.

## Key files

| File | Purpose |
|------|---------|
| `js/td-engine.js` | Johancsik soft-string T&D model — `tdCompute()` is the main entry point |
| `js/survey-engine.js` | Minimum curvature — `computeSurvey()` |
| `js/rheology-engine.js` | HB / BP / PL rheology — `computeRheology()` |
| `js/trajectory-solver.js` | Option 2 mixed-criteria solver |
| `js/chart-interaction.js` | Crosshair, freeze, annotation layer — `CI` object |
| `js/state.js` | `qpState`, `switchOutputTab()`, `redrawOutputPanel()` |
| `js/compute-engine.js` | `qpCompute()` orchestrator + hydraulics calculation |
| `js/well-schematic-draw.js` | Right-panel schematic canvas + `_readSchematicRows()` |
