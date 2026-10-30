// ===== UNIT SYSTEM =====
// Imperial (field units) is CANONICAL: everything stored in the database and
// every compute engine works in imperial. This module converts only at the
// display / input boundary. Panels read user input with fromDisplay(...) →
// imperial before storing/computing, and show results with toDisplay(...) →
// the active system.
//
// Four systems. A system is just a choice of unit per QUANTITY, so a mixed
// system (metres with psi and ppg) costs nothing extra:
//   imperial  — field units: ft · in · ppg · psi · klbf · ft·lb · gpm · °/100ft · °F
//   metric    — SI drilling: m · mm · kg/m³ · kPa · kN · N·m · L/min · °/30m · °C
//   apimix1   — "API Mix 1 — Australia / Oceania": m · in · ppg · psi · klbf ·
//               kft·lb · gpm · lb/100ft² · bbl · °/30m · m/min · °C · °C/100m
//   apimix2   — "API Mix 2 — Europe / Caspian": as apimix1 with mud density in SG
// (apimix1/2 follow the API Mixed unit sheet; they differ ONLY in mud density.)
//
// Usage:
//   QP_UNITS.label('depth')                  → 'ft' or 'm'
//   QP_UNITS.unit('mw')                      → unit code: 'ppg' | 'kgm3' | 'sg'
//   QP_UNITS.dp('mw')                        → sensible decimals for that unit
//   QP_UNITS.toDisplay('depth', ft)          → value in the active system
//   QP_UNITS.fromDisplay('depth', shown)     → value back in imperial (canonical)
//   QP_UNITS.set('apimix1')                  → switch (persisted); fires onChange
//   QP_UNITS.onChange((newSys, oldSys) => …) → re-render hook
//   QP_UNITS.convert('depth', v, from, to)   → convert between explicit systems
// Temperature is an OFFSET conversion (°C = °F × 5/9 − 160/9): the 'temp'
// quantity carries an offset, so toDisplay / fromDisplay / convert are the one
// path for it too — never scale a temperature with factor().

const QP_UNITS = (() => {
  const KEY = 'qp_unit_system';

  // Every unit, per quantity: displayValue = imperialValue × f + (o || 0).
  // The first unit of each quantity is the imperial (canonical) one.
  // dp = decimals a value in that unit is normally shown with.
  const UNITS = {
    depth:   { ft: { l: 'ft', f: 1, dp: 0 },           m:    { l: 'm',      f: 0.3048,    dp: 0 } },
    diam:    { in: { l: 'in', f: 1, dp: 3 },           mm:   { l: 'mm',     f: 25.4,      dp: 1 } },
    mw:      { ppg: { l: 'ppg', f: 1, dp: 2 },         kgm3: { l: 'kg/m³',  f: 119.8264,  dp: 0 },
               sg:  { l: 'SG',  f: 0.1198264, dp: 3 } },                   // SG ≡ g/cm³, water = 8.345 ppg
    press:   { psi: { l: 'psi', f: 1, dp: 0 },         kPa:  { l: 'kPa',    f: 6.894757,  dp: 0 } },
    force:   { klbf: { l: 'klbf', f: 1, dp: 1 },       kN:   { l: 'kN',     f: 4.448222,  dp: 1 } },
    torque:  { ftlb: { l: 'ft·lb', f: 1, dp: 0 },      Nm:   { l: 'N·m',    f: 1.3558179, dp: 0 } },
    torque_k:{ kftlb: { l: 'kft·lb', f: 1, dp: 1 },    kNm:  { l: 'kN·m',   f: 1.3558179, dp: 1 } }, // ×1000-scaled torque
    flow:    { gpm: { l: 'gpm', f: 1, dp: 0 },         Lmin: { l: 'L/min',  f: 3.785412,  dp: 0 } },
    linwt:   { lbft: { l: 'lb/ft', f: 1, dp: 2 },      kgm:  { l: 'kg/m',   f: 1.488164,  dp: 2 } },
    dls:     { deg100ft: { l: '°/100ft', f: 1, dp: 2 }, deg30m: { l: '°/30m', f: 0.9842520, dp: 2 } },
    angle:   { deg: { l: '°', f: 1, dp: 2 } },
    visc:    { cP: { l: 'cP', f: 1, dp: 1 },           mPas: { l: 'mPa·s',  f: 1,         dp: 1 } }, // 1 cP ≡ 1 mPa·s
    yieldstress: { lb100ft2: { l: 'lb/100ft²', f: 1, dp: 1 }, Pa: { l: 'Pa', f: 0.4788026, dp: 1 } },
    mass:    { lbs: { l: 'lbs', f: 1, dp: 0 },         kg:   { l: 'kg',     f: 0.4535924, dp: 0 } },
    volume:  { bbl: { l: 'bbl', f: 1, dp: 1 },         m3:   { l: 'm³',     f: 0.1589873, dp: 2 } },
    pgrad:   { psift: { l: 'psi/ft', f: 1, dp: 3 },    kPam: { l: 'kPa/m',  f: 22.62060,  dp: 2 } }, // pressure gradient
    speed:   { ftmin: { l: 'ft/min', f: 1, dp: 0 },    mmin: { l: 'm/min',  f: 0.3048,    dp: 1 } }, // trip speed
    temp:    { F: { l: '°F', f: 1, dp: 0 },            C:    { l: '°C',     f: 5 / 9, o: -160 / 9, dp: 1 } },
    tgrad:   { F100ft: { l: '°F/100ft', f: 1, dp: 2 }, C100m: { l: '°C/100m', f: 1.822688, dp: 2 } }, // geothermal gradient
    stress:  { kpsi: { l: 'kpsi', f: 0.001, dp: 0 },   MPa:  { l: 'MPa',    f: 0.00689476, dp: 0 } }, // canonical psi
  };

  // Unit per quantity for each system. Anything not listed falls back to the
  // quantity's first (imperial) unit, so a new quantity never breaks a system.
  const MIX = { depth: 'm', dls: 'deg30m', speed: 'mmin', temp: 'C', tgrad: 'C100m' };
  const SYSTEMS = {
    imperial: { name: 'Imperial (field)',               short: 'Imperial',  units: {} },
    metric:   { name: 'Metric (SI)',                    short: 'Metric',
                units: { depth: 'm', diam: 'mm', mw: 'kgm3', press: 'kPa', force: 'kN', torque: 'Nm',
                         torque_k: 'kNm', flow: 'Lmin', linwt: 'kgm', dls: 'deg30m', visc: 'mPas',
                         yieldstress: 'Pa', mass: 'kg', volume: 'm3', pgrad: 'kPam', speed: 'mmin',
                         temp: 'C', tgrad: 'C100m', stress: 'MPa' } },
    apimix1:  { name: 'API Mix 1 — Australia / Oceania', short: 'API Mix 1', units: { ...MIX } },
    apimix2:  { name: 'API Mix 2 — Europe / Caspian',    short: 'API Mix 2', units: { ...MIX, mw: 'sg' } },
  };
  const ORDER = ['imperial', 'metric', 'apimix1', 'apimix2'];

  const stored = localStorage.getItem(KEY);
  let system = SYSTEMS[stored] ? stored : 'imperial';
  const listeners = [];

  function _unit(qty, sys) {
    const q = UNITS[qty];
    if (!q) return null;
    const code = (SYSTEMS[sys] || SYSTEMS.imperial).units[qty];
    return q[code] || q[Object.keys(q)[0]];
  }
  const _to   = (u, v) => (+v) * u.f + (u.o || 0);        // imperial → unit
  const _from = (u, v) => ((+v) - (u.o || 0)) / u.f;      // unit → imperial

  function get()       { return system; }
  function isMetric()  { return system === 'metric'; }     // the full SI system only — format by unit(), not by this
  function name(sys)   { return (SYSTEMS[sys || system] || SYSTEMS.imperial).name; }
  function shortName(sys) { return (SYSTEMS[sys || system] || SYSTEMS.imperial).short; }
  function systems()   { return ORDER.map(k => ({ key: k, name: SYSTEMS[k].name, short: SYSTEMS[k].short })); }
  function factor(qty) { const u = _unit(qty, system); return u ? u.f : 1; }   // scale only — not for temp
  function unit(qty)   { const q = UNITS[qty]; if (!q) return ''; const u = _unit(qty, system); return Object.keys(q).find(k => q[k] === u) || ''; }
  function label(qty)  { const u = _unit(qty, system); return u ? u.l : ''; }
  function dp(qty)     { const u = _unit(qty, system); return u ? u.dp : 2; }
  function fmt(qty, val, decimals) { return _to(_unit(qty, system) || { f: 1 }, val).toFixed(decimals ?? dp(qty)); }

  // imperial (canonical) → current display
  function toDisplay(qty, val)   { const u = _unit(qty, system); return u ? _to(u, val) : +val; }
  // current display → imperial (canonical)
  function fromDisplay(qty, val) { const u = _unit(qty, system); return u ? _from(u, val) : +val; }
  // convert a value between two explicit systems
  function convert(qty, val, fromSys, toSys) {
    const a = _unit(qty, fromSys), b = _unit(qty, toSys);
    if (!a || !b) return +val;
    return _to(b, _from(a, val));
  }

  function set(sys) {
    const s = SYSTEMS[sys] ? sys : 'imperial';
    if (s === system) return;
    const old = system;
    system = s;
    try { localStorage.setItem(KEY, s); } catch (_) {}
    listeners.forEach(fn => { try { fn(s, old); } catch (e) { console.error('unit onChange failed:', e); } });
  }
  function toggle()      { set(ORDER[(ORDER.indexOf(system) + 1) % ORDER.length]); }   // cycles the systems
  function onChange(fn)  { if (typeof fn === 'function') listeners.push(fn); }

  return { get, isMetric, name, shortName, systems, factor, unit, label, dp, fmt,
           toDisplay, fromDisplay, convert, set, toggle, onChange };
})();

// UI glue: the header selector reflects and switches the active unit system.
function qpToggleUnits() { QP_UNITS.toggle(); }
function qpSetUnits(sys) { QP_UNITS.set(sys); }
document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('unitSelect');
  if (sel) {
    sel.innerHTML = QP_UNITS.systems().map(s => `<option value="${s.key}" title="${s.name}">${s.short}</option>`).join('');
    sel.title = 'Unit system: ' + QP_UNITS.name();
  }
  const sync = () => {
    if (sel) { sel.value = QP_UNITS.get(); sel.title = 'Unit system: ' + QP_UNITS.name(); }
    const btn = document.getElementById('unitToggle');
    if (btn) btn.textContent = QP_UNITS.shortName();
  };
  sync();
  QP_UNITS.onChange(sync);
});
