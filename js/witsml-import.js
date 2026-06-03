// ===== WITSML IMPORT — Phase 3 =====
// File-based read-only import of WITSML trajectory files.
// Supports: WITSML 1.3.1, 1.4.1 (most common), and 2.0
// No server required — uses the browser's built-in DOMParser.
//
// After parsing, stations are loaded into Option 1 (MD / Inc / Azi)
// and traj1Recalc() is called so all outputs update immediately.

function witsmlImportFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const result = _wmlParse(e.target.result);
      if (!result || !result.stations.length) {
        alert('No trajectory stations found.\nSupported formats: WITSML 1.3.1, 1.4.1, 2.0');
        return;
      }
      _wmlApply(result, file.name);
    } catch (err) {
      alert('Failed to parse file:\n' + err.message);
    }
  };
  reader.readAsText(file);
  input.value = '';
}

// ── Parser ────────────────────────────────────────────────────────────────────

function _wmlParse(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');

  // Abort on XML parse error
  const parseErr = doc.getElementsByTagName('parsererror')[0];
  if (parseErr) throw new Error(parseErr.textContent.slice(0, 300));

  // Detect version by which station element name is present
  // v1.x  → <trajectoryStation>  with <md>, <incl>, <azi>
  // v2.0  → <TrajectoryStation>  with <MD>, <Inclination>, <Azimuth>
  const st1 = doc.getElementsByTagName('trajectoryStation');
  const st2 = doc.getElementsByTagName('TrajectoryStation');

  const isV2    = st2.length > 0 && st1.length === 0;
  const stEls   = isV2 ? st2 : st1;
  const version = isV2 ? '2.0' : '1.x';

  if (!stEls.length) return null;

  // Optional well name for status message
  const wellNameEl =
    doc.getElementsByTagName('nameWell')[0] ||
    doc.getElementsByTagName('NameWell')[0] ||
    doc.getElementsByTagName('Name')[0];
  const wellName = wellNameEl ? wellNameEl.textContent.trim() : '';

  const stations = [];

  for (const st of stEls) {
    let mdObj, incObj, aziObj;

    if (isV2) {
      mdObj  = _wmlChild(st, 'MD');
      incObj = _wmlChild(st, 'Inclination');
      aziObj = _wmlChild(st, 'Azimuth');
    } else {
      mdObj  = _wmlChild(st, 'md');
      incObj = _wmlChild(st, 'incl');
      aziObj = _wmlChild(st, 'azi');
    }

    if (!mdObj || !incObj || !aziObj) continue;

    const md  = _wmlToFt(mdObj);   // always convert to ft
    const inc = incObj.value;       // always degrees
    const az  = aziObj.value;       // always degrees

    if (isNaN(md) || isNaN(inc) || isNaN(az)) continue;

    stations.push({ md: +md.toFixed(3), inc: +inc.toFixed(4), az: +az.toFixed(4) });
  }

  // WITSML spec requires ascending MD, but sort defensively
  stations.sort((a, b) => a.md - b.md);

  return { version, wellName, stations };
}

// Read a direct child element by local tag name and return { value, uom }
function _wmlChild(parent, tagName) {
  const el = parent.getElementsByTagName(tagName)[0];
  if (!el) return null;
  const val = parseFloat(el.textContent);
  if (isNaN(val)) return null;
  return { value: val, uom: (el.getAttribute('uom') || '').toLowerCase() };
}

// Convert MD value to feet. WITSML uses 'm' for metric wells.
function _wmlToFt(obj) {
  const { value, uom } = obj;
  if (uom === 'm' || uom === 'meters' || uom === 'meter') return value * 3.280839895;
  if (uom === 'km')  return value * 3280.839895;
  return value; // assume ft / ftUS
}

// ── Apply ─────────────────────────────────────────────────────────────────────

function _wmlApply(result, filename) {
  // Load into Option 1 (clear existing rows first)
  const body = document.getElementById('traj1Body');
  if (!body) return;
  body.innerHTML = '';
  trajLoadRows(result.stations.map(s => ({ md: s.md, inc: s.inc, azi: s.az })));

  // Ensure Option 1 tab is active
  const opt1Tab = document.querySelector('.opt-tab[onclick*="opt1"]');
  const opt1Panel = document.getElementById('trajOpt1');
  if (opt1Tab && opt1Panel && !opt1Panel.classList.contains('active')) {
    document.querySelectorAll('.opt-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.opt-panel').forEach(p => p.classList.remove('active'));
    opt1Tab.classList.add('active');
    opt1Panel.classList.add('active');
  }

  // Show source label in panel title
  const srcSpan = document.getElementById('trajSurveySource');
  if (srcSpan) srcSpan.textContent = `— WITSML ${result.version}`;

  traj1Recalc();

  const label = result.wellName ? `"${result.wellName}"` : `"${filename}"`;
  setStatus(`WITSML ${result.version}: ${result.stations.length} stations imported from ${label}`);
}
