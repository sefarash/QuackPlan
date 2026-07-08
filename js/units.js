// ===== UNIT SYSTEM =====
// Imperial (field units) is CANONICAL: everything stored in IndexedDB and every
// compute engine works in imperial. This module converts only at the display /
// input boundary. Panels read user input with fromDisplay(...) → imperial before
// storing/computing, and show results with toDisplay(...) → current system.
//
// Metric conventions (SI drilling defaults):
//   depth m · diameter mm · mud weight kg/m³ · pressure kPa · force kN ·
//   torque N·m · flow L/min · linear weight kg/m · dogleg °/30m · angle °
//
// Usage:
//   QP_UNITS.label('depth')                  → 'ft'  or 'm'
//   QP_UNITS.toDisplay('depth', ft)          → value in current system
//   QP_UNITS.fromDisplay('depth', shown)     → value back in imperial (canonical)
//   QP_UNITS.set('metric') / .toggle()       → switch (persisted); fires onChange
//   QP_UNITS.onChange((newSys, oldSys) => …) → re-render hook
//   QP_UNITS.convert('depth', v, from, to)   → convert between explicit systems

const QP_UNITS = (() => {
  const KEY = 'qp_unit_system';
  let system = localStorage.getItem(KEY) === 'metric' ? 'metric' : 'imperial';
  const listeners = [];

  // metricValue = imperialValue × factor. Imperial factor is implicitly 1.
  const DEFS = {
    depth:  { factor: 0.3048,     imp: 'ft',      met: 'm'     },
    diam:   { factor: 25.4,       imp: 'in',      met: 'mm'    },
    mw:     { factor: 119.8264,   imp: 'ppg',     met: 'kg/m³' },
    press:  { factor: 6.894757,   imp: 'psi',     met: 'kPa'   },
    force:  { factor: 4.448222,   imp: 'klbf',    met: 'kN'    },
    torque: { factor: 1.3558179,  imp: 'ft·lb',   met: 'N·m'   },
    flow:   { factor: 3.785412,   imp: 'gpm',     met: 'L/min' },
    linwt:  { factor: 1.488164,   imp: 'lb/ft',   met: 'kg/m'  },
    dls:    { factor: 0.9842520,  imp: '°/100ft', met: '°/30m' },
    angle:  { factor: 1,          imp: '°',       met: '°'     },
  };

  function _factor(qty, sys) {
    const d = DEFS[qty];
    if (!d) return 1;
    return sys === 'metric' ? d.factor : 1;
  }

  function get()       { return system; }
  function isMetric()  { return system === 'metric'; }
  function factor(qty) { return _factor(qty, system); }

  function label(qty) {
    const d = DEFS[qty];
    if (!d) return '';
    return system === 'metric' ? d.met : d.imp;
  }

  // imperial (canonical) → current display
  function toDisplay(qty, val)   { return (+val) * _factor(qty, system); }
  // current display → imperial (canonical)
  function fromDisplay(qty, val) { return (+val) / _factor(qty, system); }
  // convert a value between two explicit systems
  function convert(qty, val, fromSys, toSys) {
    return (+val) / _factor(qty, fromSys) * _factor(qty, toSys);
  }

  function set(sys) {
    const s = sys === 'metric' ? 'metric' : 'imperial';
    if (s === system) return;
    const old = system;
    system = s;
    try { localStorage.setItem(KEY, s); } catch (_) {}
    listeners.forEach(fn => { try { fn(s, old); } catch (e) { console.error('unit onChange failed:', e); } });
  }
  function toggle()      { set(system === 'metric' ? 'imperial' : 'metric'); }
  function onChange(fn)  { if (typeof fn === 'function') listeners.push(fn); }

  return { get, isMetric, factor, label, toDisplay, fromDisplay, convert, set, toggle, onChange };
})();

// UI glue: the header button reflects and switches the active unit system.
function qpToggleUnits() { QP_UNITS.toggle(); }
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('unitToggle');
  const sync = () => { if (btn) btn.textContent = QP_UNITS.isMetric() ? 'Metric' : 'Imperial'; };
  sync();
  QP_UNITS.onChange(sync);
});
