# Casing Design — gap analysis and roadmap

Written 2026-09-06 after the rheology / surge-swab / TOC work. Tracks what the
Casing Design panel (`js/casing-design.js`, `js/casing-triaxial.js`) still needs
to be defensible to a design reviewer, in the order the work should be done.
Tick items off here as they ship; keep the "Status" column honest.

## Where we are (2026-09-06)

| Well-integrity area | Status | Notes |
|---|---|---|
| Load cases | Partial | One burst case (uniform MASP), one collapse case (full evacuation to gas, run-in mud above TOC + cement slurry below), axial = hanging weight / overpull / ballooning / DLS bending, Von Mises ellipse with SFs and API box. Single point per case, no depth profile. |
| Barrier envelope | None | No barrier schematic, no two-barrier check, nothing on wellhead / hanger / packers. |
| Cement placement | Minimal | TOC per string stored (`toc`), drawn on schematic + final diagram, used as collapse backup. No coverage / zonal-isolation checks. |
| Material selection | Partial | Catalogue grade, weight, yield, joint yield. No sour-service screening, no corrosion / wear allowance, no connection ratings beyond joint tension. |
| Lifecycle effects | None | No temperature, APB, wear, fatigue. |
| Verification / monitoring | None | Only a single surface P-test pressure as a uniform burst load. |

## Recommended order

Steps 1–3 are engine work: do them together on a branch with a Node reference
test (as for `test/rheology-reference.mjs`). Steps 4–5 are UI + data and can
ship individually. Steps 1–5 ≈ one week.

### Step 1 — Depth-profiled load cases (burst and collapse) — ~3 days — [ ] not started

Everything else hangs off this. Replace the single-point checks with
load-versus-depth curves for each case, evaluated at every survey station,
against the rating. Second chart view beside the Von Mises ellipse: load and
rating versus depth with the minimum design factor and where it occurs.

Inputs already available: survey (MD/TVD), PPFG (pp/fg vs TVD), catalogue spec
(OD/ID/weight/grade/burst/collapse/joint yield), TOC + cement slurry density
(`cdCementMW`), per-section mud weights (Fluid Program → `fluidForSection`),
P-test input, gas gradient constant.

What is missing:

- [ ] **Engine.** A pure function `casingLoads(string, survey, ppfg, fluids, opts)`
      returning internal / external / differential pressure and axial load at
      every station for each case (today everything is computed inside the draw
      routine with DOM reads, one point per case).
- [ ] **Axial load vs depth** (buoyant weight below each station), needed for the
      biaxial collapse correction and the per-depth triaxial check.
- [ ] **API 5C3 biaxial collapse reduction** under tension.
- [ ] **Fix:** liner top is taken as the previous shoe instead of the row's hanger
      depth (`topMD = withSpec[i-1].bot`).
- [ ] Load cases:
  - [ ] Burst, gas to surface — MASP at surface, gas gradient to shoe inside;
        backup run-in mud above TOC, pore pressure below.
  - [ ] Burst, pressure test — P-test + mud gradient inside, same backup.
  - [ ] Collapse, lost returns — mud level drops to balance the lowest pore
        pressure at the next section's TD with that section's mud; full mud outside.
  - [ ] Collapse, cementing — slurry outside TOC→shoe (optional lead/tail split),
        mud above; displacement mud inside.
  - [ ] Collapse, full evacuation — exists; needs the depth profile.
- [ ] **Outputs:** load-vs-depth chart (toggle with the ellipse), per-string results
      table (governing depth, ΔP, DF, pass/fail per case), casing design section
      in the report (none today).
- [ ] **Test:** `test/casing-reference.mjs` against a textbook example (Bourgoyne
      casing design chapter or API 5C3 worked examples). Add `npm run test:casing`
      and include it in `test:models`.

### Step 2 — Wear and corrosion allowance — ~½ day — [ ] not started

One input per string (percent wall loss, default 0) reducing the effective wall
thickness before burst, collapse and the ellipse are computed. Do it right after
step 1 so people don't get a second change in results once they trust the curves.

### Step 3 — Temperature effect on axial load — ~1 day — [ ] not started

Adopt the DrillPlan-level approach (public correlations; see "Temperature model"
below) rather than StressCheck's simplified assumptions:

- [ ] Static profile (surface temperature + geothermal gradient) moved out of Kick
      Tolerance into well data and persisted (Kick Tolerance keeps using it).
- [ ] As-cemented profile — Kutasov & Taig'i cementing correlation, with the
      166 °F BHST rule (below it, use the static profile).
- [ ] Circulating profile — Kutasov & Taig'i, for drilling load cases and P-test.
- [ ] Production / injection profile — Erpelding & Miller (OTC 7537), user gives
      rate and fluid; defaults 20 MMscf/d gas, 10 bbl/min at 70 °F injection.
- [ ] Thermal axial load = operating − as-cemented, applied to the free length
      above TOC and the cemented interval; shifts the load points on the ellipse.
- [ ] Per-grade yield de-rating with temperature (small table).
- [ ] Verify the correlations against a published example before wiring in.

Out of scope: transient thermal simulation, annular pressure buildup, wellhead
movement (WellCat / OLGA territory).

### Step 4 — Sour-service screening — ~½ day — [ ] not started

Well-level H2S / CO2 flag, `sour` attribute in the casing catalogue, warning in
the string table and report when a non-sour grade is selected in a sour well
(NACE MR0175). No engine change.

### Step 5 — Cement coverage check — ~½ day — [ ] not started

Warn when TOC does not overlap the previous shoe by a set margin, or when TOC is
below a formation top flagged as needing isolation (needs a formation-tops table;
the PPFG table could host it).

### Step 6 — Connection ratings — 1–2 days — [ ] not started

Needs catalogue data we do not have (connection burst / collapse / compression
ratings). Do after the calculation side is settled.

### Later / separate module

- Annular pressure buildup, fatigue, long-term degradation (HPHT / subsea).
- Barrier envelope schematic and verification tracking (integrity-management
  records, not design calculations).

## Temperature model (reference)

From an internal DrillPlan vs Landmark comparison (Beach Energy, Aug 2026):

| Tool | Static | Cementing / installed | Circulating | Production / injection | Notes |
|---|---|---|---|---|---|
| StressCheck | surface T + gradient | none (uses circulating at shoe) | API circulating T, straight line through mid-point of static, floored at mid-point | constant T = undisturbed at perforations; injection = constant surface T | simplified, not suitable for HPHT |
| DrillPlan | formation T editor | Kutasov & Taig'i (static if BHST < 166 °F) | Kutasov & Taig'i | Erpelding & Miller (20 MMscf/d; 10 bbl/min @ 70 °F) | BP manual method; within ±10 °F of WellCat (±20 °F > 3000 ft water) |
| WellCat | surface T + gradient | transient simulation | transient simulation | transient simulation | APB, wellhead movement, multi-string |

QuackPlan today: static line only, in Kick Tolerance, used solely for influx gas
density; not persisted. Target for step 3: the DrillPlan column.

References: Kutasov & Taig'i, *Better Deep-hole BHCT Estimations Possible*;
Erpelding & Miller, *Tubing Temperature Correlations for Injection and Production
Based on Simulation and Field Experience*, OTC 7537 (1994); BP Tubular Design
Manual (Stanley, 2014).

## Related open items (not casing design)

- td-engine may stack BHA components inverted vs the documented bit-first table
  (`_buildElements` in `js/td-engine.js`) — flagged 2026-09-05, unconfirmed.
- Kick Tolerance temperature inputs are not persisted per scenario (offset unit
  conversion kept them out of `outputControls`); step 3 resolves this.
