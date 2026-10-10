// ===== CHART ZOOM =====
// Zoom + pan for every chart canvas, as a VIEW transform: _chartSetup
// (td-charts.js) calls QP_ZOOM.apply(ctx, id) after clearing the canvas, so the
// chart's own draw code runs unchanged in its normal ("base") coordinates and
// comes out magnified — lines and text are redrawn sharp, not stretched.
//
//   drag a box           zoom INTO that area (the rectangle fills the chart)
//   wheel / pinch        zoom in / out at the pointer
//   Shift + drag         move the view while zoomed in
//   ＋ / − / ⟲ buttons   bottom-left corner of each chart (⟲ = back to 100%)
//
// Anything that maps the mouse back onto the chart (CI crosshair + right-click,
// the label-drag handlers) goes through QP_ZOOM.eventToBase / toBase.
// View state is in-memory only (per canvas) — nothing is stored.

const QP_ZOOM = (() => {
  const MAX_Z = 8, STEP = 1.4;
  const _st = {};                                   // id → { z, ox, oy, drawn, snap, timer, tools }
  let _pan = null;                                  // active Shift+drag pan
  let _box = null;                                  // active drag-a-box selection

  const get = id => _st[id] || (_st[id] = { z: 1, ox: 0, oy: 0, drawn: { z: 1, ox: 0, oy: 0 }, snap: null });

  function _clamp(s, canvas) {
    s.z  = Math.min(MAX_Z, Math.max(1, s.z));
    s.ox = Math.min(Math.max(0, s.ox), canvas.width  * (s.z - 1));
    s.oy = Math.min(Math.max(0, s.oy), canvas.height * (s.z - 1));
    if (s.z === 1) { s.ox = 0; s.oy = 0; }
  }

  // Called by the chart's setup, on a freshly cleared canvas.
  function apply(ctx, id) {
    const s = get(id);
    _clamp(s, ctx.canvas);
    ctx.setTransform(s.z, 0, 0, s.z, -s.ox, -s.oy);
    s.drawn = { z: s.z, ox: s.ox, oy: s.oy };
    s.snap = null;
    _syncTools(id);
  }

  // Canvas pixel → the chart's base coordinates
  function toBase(id, cx, cy) {
    const s = get(id);
    return { x: (cx + s.ox) / s.z, y: (cy + s.oy) / s.z, z: s.z };
  }
  function _canvasXY(canvas, e) {
    const r = canvas.getBoundingClientRect();
    return { cx: (e.clientX - r.left) * (canvas.width / (r.width || 1)),
             cy: (e.clientY - r.top)  * (canvas.height / (r.height || 1)) };
  }
  function eventToBase(canvas, e) {
    const { cx, cy } = _canvasXY(canvas, e);
    return toBase(canvas.id, cx, cy);
  }
  // Base rectangle → where it is on screen (canvas pixels), for overlays
  function toScreenRect(id, r) {
    const s = get(id);
    return { l: r.l * s.z - s.ox, t: r.t * s.z - s.oy, pw: r.pw * s.z, ph: r.ph * s.z };
  }

  // ── Redraw ───────────────────────────────────────────────────────────────────
  function _redraw(id) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    if (id === 'cmpCanvas') {
      if (typeof _cmpDrawChart === 'function' && window._cmpLastResults) _cmpDrawChart(window._cmpLastResults);
      return;
    }
    const panel = canvas.closest('.output-panel');
    const name  = panel ? panel.id.replace(/^panel-/, '') : null;
    if (name && typeof redrawOutputPanel === 'function') redrawOutputPanel(name);
  }

  // Instant feedback while the real redraw is pending (some charts recompute
  // T&D on every draw): the last drawn bitmap, moved / scaled to the new view.
  function _preview(id) {
    const canvas = document.getElementById(id), s = get(id);
    if (!canvas || !canvas.width) return;
    if (!s.snap) {
      s.snap = document.createElement('canvas');
      s.snap.width = canvas.width; s.snap.height = canvas.height;
      s.snap.getContext('2d').drawImage(canvas, 0, 0);
      s.snapView = { ...s.drawn };
    }
    const d = s.snapView, k = s.z / d.z;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = (typeof _qpColors === 'function') ? _qpColors().bg : '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(s.snap, k * d.ox - s.ox, k * d.oy - s.oy, canvas.width * k, canvas.height * k);
    ctx.restore();
  }

  function _changed(id) {
    const canvas = document.getElementById(id), s = get(id);
    if (!canvas) return;
    _clamp(s, canvas);
    _preview(id);
    _syncTools(id);
    clearTimeout(s.timer);
    s.timer = setTimeout(() => { s.timer = null; _redraw(id); }, 140);
  }

  // Zoom by `factor`, keeping canvas point (cx, cy) fixed (default: the centre)
  function zoomBy(id, factor, cx, cy) {
    const canvas = document.getElementById(id), s = get(id);
    if (!canvas) return;
    if (cx == null) { cx = canvas.width / 2; cy = canvas.height / 2; }
    const z2 = Math.min(MAX_Z, Math.max(1, s.z * factor));
    if (z2 === s.z) return;
    const bx = (cx + s.ox) / s.z, by = (cy + s.oy) / s.z;
    s.z = z2; s.ox = bx * z2 - cx; s.oy = by * z2 - cy;
    _changed(id);
  }
  function reset(id) {
    const s = get(id);
    if (s.z === 1 && !s.ox && !s.oy) return;
    s.z = 1; s.ox = 0; s.oy = 0;
    _changed(id);
  }
  function resetAll() { Object.keys(_st).forEach(id => { const s = _st[id]; s.z = 1; s.ox = 0; s.oy = 0; }); }

  // Zoom so the canvas-pixel rectangle (x, y, w, h) fills the chart (aspect kept)
  function zoomToRect(id, x, y, w, h) {
    const canvas = document.getElementById(id), s = get(id);
    if (!canvas || w < 2 || h < 2) return;
    const c  = toBase(id, x + w / 2, y + h / 2);                 // box centre, base coords
    const z2 = Math.min(MAX_Z, Math.max(1, s.z * Math.min(canvas.width / w, canvas.height / h)));
    s.z = z2; s.ox = c.x * z2 - canvas.width / 2; s.oy = c.y * z2 - canvas.height / 2;
    _changed(id);
  }

  // A label-drag handler took this mousedown — don't pan / box-select as well.
  function cancelPan() { _pan = null; _endBox(); }
  function _endBox() { if (_box) { _box.el.remove(); _box = null; } }

  // ── Toolbar ──────────────────────────────────────────────────────────────────
  function _syncTools(id) {
    const s = get(id), canvas = document.getElementById(id);
    if (!s.tools || !canvas) return;
    s.tools.style.left = (canvas.offsetLeft + 6) + 'px';
    s.tools.style.top  = (canvas.offsetTop + canvas.offsetHeight - 28) + 'px';
    s.tools.classList.toggle('zoomed', s.z > 1);
    s.tools.querySelector('.qz-pct').textContent = Math.round(s.z * 100) + '%';
    canvas.classList.toggle('qp-zoomed', s.z > 1);
  }

  function attach(id) {
    const canvas = document.getElementById(id);
    if (!canvas || canvas.dataset.zoomAttached) return;
    canvas.dataset.zoomAttached = '1';
    const s = get(id);
    const host = canvas.parentElement;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const tools = document.createElement('div');
    tools.className = 'qp-zoom-tools';
    tools.innerHTML =
      '<button type="button" data-z="out" title="Zoom out">−</button>' +
      '<button type="button" data-z="in"  title="Zoom in — or drag a box over the area you want to enlarge, or scroll at the pointer">+</button>' +
      '<button type="button" data-z="reset" class="qz-reset" title="Back to the whole chart. While zoomed: Shift + drag moves the view.">⟲ <span class="qz-pct">100%</span></button>';
    tools.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.z === 'in') zoomBy(id, STEP);
      else if (b.dataset.z === 'out') zoomBy(id, 1 / STEP);
      else reset(id);
    });
    host.appendChild(tools);
    s.tools = tools;
    _syncTools(id);

    // Wheel / pinch: zoom at the pointer. At 100% a zoom-OUT tick is left
    // alone so the page (or a chart + table panel) still scrolls normally.
    canvas.addEventListener('wheel', e => {
      const { cx, cy } = _canvasXY(canvas, e);
      const pinch = e.ctrlKey || e.metaKey;
      const f = Math.exp(-e.deltaY * (pinch ? 0.01 : 0.0025));
      if (s.z <= 1 && f <= 1) return;
      e.preventDefault();
      zoomBy(id, f, cx, cy);
    }, { passive: false });

    canvas.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (e.shiftKey) {                                 // Shift + drag: move the view
        if (s.z > 1) _pan = { id, x: e.clientX, y: e.clientY, ox: s.ox, oy: s.oy, moved: false };
        return;
      }
      // Drag: rubber-band the area to enlarge
      e.preventDefault();                               // no text selection while dragging
      const el = document.createElement('div');
      el.className = 'qp-zoom-box';
      el.style.display = 'none';
      host.appendChild(el);
      _box = { id, el, x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
    });
  }

  function _boxRect() {                                 // selection, clipped to the canvas, in client px
    const canvas = document.getElementById(_box.id), r = canvas.getBoundingClientRect();
    const cl = v => Math.min(Math.max(v, r.left), r.right), ct = v => Math.min(Math.max(v, r.top), r.bottom);
    const xa = cl(_box.x0), xb = cl(_box.x1), ya = ct(_box.y0), yb = ct(_box.y1);
    return { canvas, r, x: Math.min(xa, xb), y: Math.min(ya, yb), w: Math.abs(xb - xa), h: Math.abs(yb - ya) };
  }

  window.addEventListener('mousemove', e => {
    if (_box) {
      _box.x1 = e.clientX; _box.y1 = e.clientY;
      const b = _boxRect();
      if (b.w < 6 && b.h < 6) { _box.el.style.display = 'none'; return; }
      _box.el.style.display = 'block';
      _box.el.style.left   = (b.canvas.offsetLeft + b.x - b.r.left) + 'px';
      _box.el.style.top    = (b.canvas.offsetTop  + b.y - b.r.top)  + 'px';
      _box.el.style.width  = b.w + 'px';
      _box.el.style.height = b.h + 'px';
      return;
    }
    if (!_pan) return;
    const canvas = document.getElementById(_pan.id), s = get(_pan.id);
    if (!canvas) { _pan = null; return; }
    const r = canvas.getBoundingClientRect(), k = canvas.width / (r.width || 1);
    const dx = (e.clientX - _pan.x) * k, dy = (e.clientY - _pan.y) * k;
    if (!_pan.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    _pan.moved = true;
    s.ox = _pan.ox - dx; s.oy = _pan.oy - dy;
    _changed(_pan.id);
  });
  window.addEventListener('mouseup', () => {
    _pan = null;
    if (!_box) return;
    const b = _boxRect(), id = _box.id;
    _endBox();
    if (b.w < 12 || b.h < 12) return;                   // a click, not a selection
    const k = b.canvas.width / (b.r.width || 1);        // client px → canvas px
    zoomToRect(id, (b.x - b.r.left) * k, (b.y - b.r.top) * k, b.w * k, b.h * k);
  });

  return { attach, apply, toBase, eventToBase, toScreenRect, zoomBy, zoomToRect, reset, resetAll, cancelPan, get };
})();
