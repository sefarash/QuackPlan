// ===== FORMATION TEMPERATURE (static profile) =====
// One well-level input: surface temperature + geothermal gradient, entered on
// the PPFG tab and stored on the BOREHOLE as the additive key 'thermal'
// ({ surfT °F, geoGrad °F/100ft } — imperial, like every stored value).
// Used by: Kick Tolerance (influx gas density at the kick zone and weak point),
// Hydraulics (opt-in P/T-corrected mud density → ECD) and Casing Design
// (opt-in yield derating at the shoe temperature).
//
// The input fields keep their old ids (ktSurfTemp / ktGeoGrad) so the unit
// toggle in kick-tolerance.js converts them as before. Temperature is an offset
// conversion, so it is handled with the _ktTemp* helpers, not QP_UNITS.

const QP_THERMAL_DEFAULT = { surfT: 70, geoGrad: 1.5 };

// Current profile in imperial (°F, °F/100ft), read from the input fields.
function qpThermal() {
  const st = document.getElementById('ktSurfTemp')?.value;
  const gg = document.getElementById('ktGeoGrad')?.value;
  return {
    surfT:   (st === '' || st == null) ? QP_THERMAL_DEFAULT.surfT   : _ktTempToImp(+st),
    geoGrad: (gg === '' || gg == null) ? QP_THERMAL_DEFAULT.geoGrad : _ktGeoToImp(+gg),
  };
}

// Static formation temperature (°F) at a TVD (ft)
function qpTempAt(tvd, th) {
  th = th || qpThermal();
  return th.surfT + th.geoGrad / 100 * Math.max(0, tvd || 0);
}

function thermalSave() {
  const tid = qpSaveTarget('thermal');
  if (!tid) return;
  const th = qpThermal();
  dbSaveScenarioData(tid, 'thermal', { surfT: +th.surfT.toFixed(2), geoGrad: +th.geoGrad.toFixed(4) });
}

function thermalChanged() {
  thermalSave();
  if (typeof qpCompute === 'function') qpCompute();
  else if (qpState.activeOutputTab === 'kt') drawKickTolerance();
}

// Load (no save): stored imperial values → display fields; absent → defaults.
function thermalLoadState(data) {
  const d = { ...QP_THERMAL_DEFAULT, ...(data || {}) };
  const st = document.getElementById('ktSurfTemp');
  const gg = document.getElementById('ktGeoGrad');
  if (st) st.value = +_ktTempToDisp(+d.surfT).toFixed(1);
  if (gg) gg.value = +_ktGeoToDisp(+d.geoGrad).toFixed(3);
}

// One-line description for result notes, in display units.
function qpThermalText() {
  const th = qpThermal();
  return `${_ktTempToDisp(th.surfT).toFixed(0)} ${_ktUTemp()} + ${_ktGeoToDisp(th.geoGrad).toFixed(2)} ${_ktUGeo()}`;
}

// ── Mud density at pressure and temperature (Hydraulics, opt-in) ─────────────
// ρ(P,T) = ρ0 · exp[γ·P − α·(T − T_surface)], ρ0 = the mud weight measured at
// surface. Typical published coefficients for the base fluid + solids (Peters
// et al. 1990; Kårstad & Aadnøy 1998 give the same order): water-based muds
// compress and expand less than oil- / synthetic-based.
const QP_MUD_PVT = {
  WBM: { gamma: 2.8e-6, alpha: 1.9e-4 },   // 1/psi, 1/°F
  OBM: { gamma: 5.0e-6, alpha: 3.4e-4 },
  SBM: { gamma: 5.0e-6, alpha: 3.4e-4 },
};

// Equivalent static density (ppg) at `tvd` ft for a surface mud weight `mw`:
// hydrostatic pressure integrated down the static temperature profile.
function qpESD(mw, mudType, tvd, th) {
  if (!(tvd > 0)) return mw;
  th = th || qpThermal();
  const c = QP_MUD_PVT[mudType] || QP_MUD_PVT.WBM;
  const n = Math.max(20, Math.ceil(tvd / 50));
  const dz = tvd / n;
  let P = 0;
  for (let i = 0; i < n; i++) {
    const z = (i + 0.5) * dz;
    const T = th.geoGrad / 100 * z;                    // T − T_surface
    // half-step pressure for the midpoint density
    const Pm = P + 0.052 * mw * Math.exp(c.gamma * P - c.alpha * T) * dz / 2;
    P += 0.052 * mw * Math.exp(c.gamma * Pm - c.alpha * T) * dz;
  }
  return P / (0.052 * tvd);
}

// ── Casing yield derating (Casing Design, opt-in) ─────────────────────────────
// Carbon / low-alloy casing steels lose roughly 0.03 % of minimum yield per °F
// above room temperature (68 °F) — the common linear rule of thumb. Use the
// mill's data for CRA grades or above ~400 °F.
const QP_YIELD_DERATE_PER_F = 0.0003;
function qpYieldDerate(tempF) {
  return Math.max(0.5, 1 - QP_YIELD_DERATE_PER_F * Math.max(0, tempF - 68));
}

// Casing Design: derating for a string whose shoe is at `shoeTVD` (the hottest
// point of the string under the static profile). k = 1 when switched off.
function qpCasingDerate(shoeTVD) {
  if (!document.getElementById('cdTempDerate')?.checked) return { on: false, k: 1, T: null };
  const T = qpTempAt(shoeTVD);
  return { on: true, k: qpYieldDerate(T), T };
}
