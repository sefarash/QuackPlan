// ===== CHART ZOOM =====
// Zoom + pan for every chart canvas.
//
//   drag a box           zoom INTO that area
//   wheel / pinch        zoom in / out at the pointer
//   Shift + drag         move the view while zoomed in
//   ＋ / − / ⟲ buttons   top-left corner of each chart (⟲ = back to 100%)
//
// Two modes, chosen by how the chart draws:
//
//  PLOT mode — charts with axes. The chart's grid function asks for the visible
//    window (QP_ZOOM.plotWindow), labels its tick marks with the values of that
//    window, then calls QP_ZOOM.begin(ctx). From there the chart's own draw code
//    runs UNCHANGED in its normal ("base") coordinates: a clip + transform maps
//    the window onto the plot rectangle. The axes, titles and legend stay where
//    they are; only the data moves. While the transform is on, the context is
//    patched so that
//      • strokes keep their line width and dash pattern (stroked untransformed),
//      • text keeps its size (drawn at the transformed anchor, unscaled),
//      • marker circles keep their radius,
//      • text / swatches the chart draws in the MARGINS (titles above the plot,
//        legends beside it) are held back and drawn in place, unclipped.
//    QP_ZOOM.end(ctx) (called by _legend / _lblFlush / CI.drawAnnotations)
//    switches back to screen space; QP_ZOOM.pt() maps a base point to the screen
//    for anything drawn after that (queued labels, annotation pins).
//
//  CANVAS mode — pictures without axes (final diagram, pie, compare): the whole
//    canvas is magnified, text included.
//
// At 100% nothing is clipped, transformed or patched — a chart draws exactly as
// it did before this module existed. View state is in-memory only.

const QP_ZOOM = (() => {
  const MAX_MAG = 40, STEP = 1.5;
  const P = (typeof CanvasRenderingContext2D !== 'undefined') ? CanvasRenderingContext2D.prototype : null;
  const _st = {};                                   // id → state
  let _pan = null, _box = null;

  const _full = () => ({ u0: 0, u1: 1, v0: 0, v1: 1 });
  const get = id => _st[id] || (_st[id] = {
    win: _full(), rect: null, mode: 'canvas', uniform: true,
    drawn: null, snap: null, timer: null, tools: null, active: false, deferred: [],
  });
  const _isFull = w => w.u0 <= 1e-9 && w.u1 >= 1 - 1e-9 && w.v0 <= 1e-9 && w.v1 >= 1 - 1e-9;
  const _mag = w => 1 / Math.min(w.u1 - w.u0, w.v1 - w.v0);

  function _clampWin(w) {
    const fix = (a, b) => {
      const d = Math.min(1, Math.max(1 / MAX_MAG, b - a));
      a = Math.min(Math.max(0, a), 1 - d);
      return [a, a + d];
    };
    [w.u0, w.u1] = fix(w.u0, w.u1);
    [w.v0, w.v1] = fix(w.v0, w.v1);
    if (w.u1 - w.u0 > 0.999 && w.v1 - w.v0 > 0.999) Object.assign(w, _full());
    return w;
  }

  // ── Coordinate maps ──────────────────────────────────────────────────────────
  // base point → screen (canvas px)
  function pt(id, x, y) {
    const s = get(id), R = s.rect, w = s.win;
    if (!R) return { x, y };
    return { x: R.l + ((x - R.l) / R.pw - w.u0) / (w.u1 - w.u0) * R.pw,
             y: R.t + ((y - R.t) / R.ph - w.v0) / (w.v1 - w.v0) * R.ph };
  }
  // screen (canvas px) → base point
  function toBase(id, cx, cy) {
    const s = get(id), R = s.rect, w = s.win;
    if (!R) return { x: cx, y: cy };
    return { x: R.l + (w.u0 + (cx - R.l) / R.pw * (w.u1 - w.u0)) * R.pw,
             y: R.t + (w.v0 + (cy - R.t) / R.ph * (w.v1 - w.v0)) * R.ph };
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
  // Is this SCREEN point inside the zoom rectangle (the visible plot)?
  function visible(id, sx, sy, tol) {
    const R = get(id).rect; if (!R) return true;
    const k = tol == null ? 1 : tol;
    return sx >= R.l - k && sx <= R.l + R.pw + k && sy >= R.t - k && sy <= R.t + R.ph + k;
  }
  // Where a base rectangle is on screen, clipped to the zoom rectangle
  function visibleRect(id, r) {
    const R = get(id).rect; if (!R) return r;
    const a = pt(id, r.l, r.t), b = pt(id, r.l + r.pw, r.t + r.ph);
    const l = Math.max(R.l, a.x), t = Math.max(R.t, a.y);
    return { l, t, pw: Math.min(R.l + R.pw, b.x) - l, ph: Math.min(R.t + R.ph, b.y) - t };
  }
  const zoomed = id => !_isFull(get(id).win);

  // ── Per-draw hooks ───────────────────────────────────────────────────────────
  // _chartSetup → apply(): fresh canvas. Default is CANVAS mode over the whole
  // canvas; a grid function upgrades the draw to PLOT mode via plotWindow().
  function apply(ctx, id) {
    const s = get(id);
    _end(ctx, s);
    s.rect = { l: 0, t: 0, pw: ctx.canvas.width, ph: ctx.canvas.height };
    s.mode = 'canvas'; s.uniform = true;
    _clampWin(s.win);
    s.snap = null;
    _begin(ctx, s);
    _syncTools(id);
  }

  // Grid functions: the plot rectangle g = {l, t, pw, ph}. Returns the visible
  // window as tick mappers — fx(f) / fy(f) turn "fraction f across / down the
  // plot" into "fraction of the full axis" — so ticks show the zoomed range.
  // Draw ticks + titles next, then call begin(ctx).
  function plotWindow(ctx, g, opts) {
    const id = ctx.canvas.id, s = get(id);
    _end(ctx, s);
    s.rect = { l: g.l, t: g.t, pw: g.pw, ph: g.ph };
    s.mode = 'plot'; s.uniform = !!(opts && opts.uniform);
    if (s.uniform) _squareWin(s.win);
    const w = s.win;
    return { zoomed: !_isFull(w),
             fx: f => w.u0 + f * (w.u1 - w.u0),
             fy: f => w.v0 + f * (w.v1 - w.v0),
             // screen x / y of an axis fraction (null when scrolled out of view)
             sx: f => { const k = (f - w.u0) / (w.u1 - w.u0); return (k < 0 || k > 1) ? null : g.l + k * g.pw; },
             sy: f => { const k = (f - w.v0) / (w.v1 - w.v0); return (k < 0 || k > 1) ? null : g.t + k * g.ph; } };
  }
  function begin(ctx) { _begin(ctx, get(ctx.canvas.id)); }
  function end(ctx)   { _end(ctx, get(ctx.canvas.id)); }
  // Temporarily draw in screen space (fixed overlays inside the plot)
  function pause(ctx)  { const s = get(ctx.canvas.id); s.paused = s.active; if (s.active) _end(ctx, s); }
  function resume(ctx) { const s = get(ctx.canvas.id); if (s.paused) { s.paused = false; _begin(ctx, s); } }

  function _squareWin(w) {                            // same magnification on both axes
    const d = Math.min(w.u1 - w.u0, w.v1 - w.v0);
    const cu = (w.u0 + w.u1) / 2, cv = (w.v0 + w.v1) / 2;
    w.u0 = cu - d / 2; w.u1 = cu + d / 2; w.v0 = cv - d / 2; w.v1 = cv + d / 2;
    _clampWin(w);
  }

  function _begin(ctx, s) {
    s.drawn = { win: { ...s.win }, rect: { ...s.rect } };
    if (s.active || _isFull(s.win)) return;
    const R = s.rect, w = s.win;
    const sx = 1 / (w.u1 - w.u0), sy = 1 / (w.v1 - w.v0);
    const tx = R.l - sx * (R.l + w.u0 * R.pw), ty = R.t - sy * (R.t + w.v0 * R.ph);
    ctx.save();
    if (s.mode === 'plot') { ctx.beginPath(); ctx.rect(R.l, R.t, R.pw, R.ph); ctx.clip(); ctx.beginPath(); }
    ctx.setTransform(sx, 0, 0, sy, tx, ty);
    s.active = true; s.deferred = [];
    if (s.mode === 'plot') _patch(ctx, s, { sx, sy, tx, ty });
  }

  function _end(ctx, s) {
    if (!s.active) return;
    s.active = false;
    _unpatch(ctx);
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // margin items held back while the plot clip was on
    const D = s.deferred; s.deferred = [];
    D.forEach(d => {
      ctx.save();
      ctx.globalAlpha = d.alpha;
      if (d.kind === 'rect') { ctx.fillStyle = d.fillStyle; ctx.fillRect(d.x, d.y, d.w, d.h); }
      else {
        ctx.font = d.font; ctx.textAlign = d.textAlign; ctx.textBaseline = d.textBaseline;
        ctx.fillStyle = d.fillStyle; ctx.strokeStyle = d.strokeStyle; ctx.lineWidth = d.lineWidth; ctx.lineJoin = d.lineJoin;
        ctx.setTransform(d.c, d.sn, -d.sn, d.c, d.x, d.y);
        if (d.maxW != null) ctx[d.kind](d.text, 0, 0, d.maxW); else ctx[d.kind](d.text, 0, 0);
      }
      ctx.restore();
    });
  }

  // ── Context patch (plot mode, while zoomed) ──────────────────────────────────
  function _patch(ctx, s, Z) {
    const R = s.rect;
    const ID = c => c.setTransform(1, 0, 0, 1, 0, 0);
    const tp = (m, x, y) => m.transformPoint(new DOMPoint(x, y));
    const outside = (bx, by) => bx < R.l - 0.5 || bx > R.l + R.pw + 0.5 || by < R.t - 0.5 || by > R.t + R.ph + 0.5;

    ctx.stroke = function (path) {
      if (path instanceof Path2D) return P.stroke.call(this, path);
      const m = this.getTransform(); ID(this); P.stroke.call(this); this.setTransform(m);
    };
    ctx.strokeRect = function (x, y, w, h) {
      const m = this.getTransform();
      const c = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]) => tp(m, a, b));
      const path = new Path2D();
      path.moveTo(c[0].x, c[0].y); c.slice(1).forEach(q => path.lineTo(q.x, q.y)); path.closePath();
      ID(this); P.stroke.call(this, path); this.setTransform(m);
    };
    ctx.arc = function (x, y, r, a0, a1, ccw) {        // markers keep their radius
      const m = this.getTransform(), q = tp(m, x, y);
      ID(this); P.arc.call(this, q.x, q.y, r, a0, a1, ccw); this.setTransform(m);
    };
    const text = kind => function (t, x, y, maxW) {
      const m = this.getTransform(), q = tp(m, x, y);
      const ang = Math.atan2(m.b / Z.sy, m.a / Z.sx), c = Math.cos(ang), sn = Math.sin(ang);
      const bx = (q.x - Z.tx) / Z.sx, by = (q.y - Z.ty) / Z.sy;     // anchor in base coords
      if (outside(bx, by)) {                                         // margin text: in place, unclipped
        s.deferred.push({ kind, text: t, x: bx, y: by, c, sn, maxW, font: this.font, textAlign: this.textAlign,
          textBaseline: this.textBaseline, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle,
          lineWidth: this.lineWidth, lineJoin: this.lineJoin, alpha: this.globalAlpha });
        return;
      }
      this.setTransform(c, sn, -sn, c, q.x, q.y);
      if (maxW != null) P[kind].call(this, t, 0, 0, maxW); else P[kind].call(this, t, 0, 0);
      this.setTransform(m);
    };
    ctx.fillText = text('fillText');
    ctx.strokeText = text('strokeText');
    ctx.fillRect = function (x, y, w, h) {
      const m = this.getTransform();
      const a = tp(m, x, y), b = tp(m, x + w, y + h);
      const ax = (a.x - Z.tx) / Z.sx, ay = (a.y - Z.ty) / Z.sy, bx = (b.x - Z.tx) / Z.sx, by = (b.y - Z.ty) / Z.sy;
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
      if (x1 < R.l || x0 > R.l + R.pw || y1 < R.t || y0 > R.t + R.ph) {   // wholly in the margin
        s.deferred.push({ kind: 'rect', x: x0, y: y0, w: x1 - x0, h: y1 - y0, fillStyle: this.fillStyle, alpha: this.globalAlpha });
        return;
      }
      P.fillRect.call(this, x, y, w, h);
    };
  }
  function _unpatch(ctx) {
    ['stroke', 'strokeRect', 'arc', 'fillText', 'strokeText', 'fillRect'].forEach(k => { delete ctx[k]; });
  }

  // ── Redraw / preview ─────────────────────────────────────────────────────────
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
  // T&D on every draw): the last drawn plot bitmap, moved / scaled to the new window.
  function _preview(id) {
    const canvas = document.getElementById(id), s = get(id);
    if (!canvas || !canvas.width || !s.drawn) return;
    if (!s.snap) {
      s.snap = document.createElement('canvas');
      s.snap.width = canvas.width; s.snap.height = canvas.height;
      s.snap.getContext('2d').drawImage(canvas, 0, 0);
      s.snapView = { win: { ...s.drawn.win }, rect: { ...s.drawn.rect } };
    }
    const R = s.snapView.rect, d = s.snapView.win, w = s.win;
    // source rectangle in the snapshot (px), then clip it to the snapshot's plot area
    const du = d.u1 - d.u0, dv = d.v1 - d.v0;
    const sx0 = R.l + (w.u0 - d.u0) / du * R.pw, sx1 = R.l + (w.u1 - d.u0) / du * R.pw;
    const sy0 = R.t + (w.v0 - d.v0) / dv * R.ph, sy1 = R.t + (w.v1 - d.v0) / dv * R.ph;
    const kx = R.pw / (sx1 - sx0), ky = R.ph / (sy1 - sy0);
    const cx0 = Math.max(sx0, R.l), cx1 = Math.min(sx1, R.l + R.pw), cy0 = Math.max(sy0, R.t), cy1 = Math.min(sy1, R.t + R.ph);
    const ctx = canvas.getContext('2d');
    _end(ctx, s);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath(); ctx.rect(R.l, R.t, R.pw, R.ph); ctx.clip();
    ctx.fillStyle = (typeof _qpColors === 'function' && id !== 'cmpCanvas') ? _qpColors().bg : '#0b1520';
    ctx.fillRect(R.l, R.t, R.pw, R.ph);
    if (cx1 > cx0 && cy1 > cy0) {
      ctx.drawImage(s.snap, cx0, cy0, cx1 - cx0, cy1 - cy0,
        R.l + (cx0 - sx0) * kx, R.t + (cy0 - sy0) * ky, (cx1 - cx0) * kx, (cy1 - cy0) * ky);
    }
    ctx.restore();
  }

  function _changed(id) {
    const s = get(id);
    _clampWin(s.win);
    if (s.uniform) _squareWin(s.win);
    _preview(id);
    _syncTools(id);
    clearTimeout(s.timer);
    s.timer = setTimeout(() => { s.timer = null; _redraw(id); }, 140);
  }

  // Fraction (0..1) of the zoom rectangle under a canvas-pixel point
  function _frac(s, cx, cy) {
    const R = s.rect;
    return { fx: Math.min(1, Math.max(0, (cx - R.l) / R.pw)), fy: Math.min(1, Math.max(0, (cy - R.t) / R.ph)) };
  }

  // Zoom by `factor`, keeping canvas point (cx, cy) fixed (default: the centre)
  function zoomBy(id, factor, cx, cy) {
    const s = get(id); if (!s.rect) return;
    const R = s.rect, w = s.win;
    if (cx == null) { cx = R.l + R.pw / 2; cy = R.t + R.ph / 2; }
    const f = _frac(s, cx, cy);
    const du = w.u1 - w.u0, dv = w.v1 - w.v0;
    const U = w.u0 + f.fx * du, V = w.v0 + f.fy * dv;
    const nu = Math.min(1, Math.max(1 / MAX_MAG, du / factor)), nv = Math.min(1, Math.max(1 / MAX_MAG, dv / factor));
    if (Math.abs(nu - du) < 1e-9 && Math.abs(nv - dv) < 1e-9) return;
    w.u0 = U - f.fx * nu; w.u1 = w.u0 + nu; w.v0 = V - f.fy * nv; w.v1 = w.v0 + nv;
    _changed(id);
  }

  // Zoom so the canvas-pixel rectangle (x, y, w, h) fills the plot
  function zoomToRect(id, x, y, w, h) {
    const s = get(id); if (!s.rect) return;
    const a = _frac(s, x, y), b = _frac(s, x + w, y + h), W = s.win;
    if (b.fx - a.fx < 0.01 || b.fy - a.fy < 0.01) return;        // nothing of it is on the plot
    const du = W.u1 - W.u0, dv = W.v1 - W.v0;
    const nw = { u0: W.u0 + a.fx * du, u1: W.u0 + b.fx * du, v0: W.v0 + a.fy * dv, v1: W.v0 + b.fy * dv };
    if (s.uniform) {                                              // keep the picture's proportions
      const d = Math.max(nw.u1 - nw.u0, nw.v1 - nw.v0), cu = (nw.u0 + nw.u1) / 2, cv = (nw.v0 + nw.v1) / 2;
      nw.u0 = cu - d / 2; nw.u1 = cu + d / 2; nw.v0 = cv - d / 2; nw.v1 = cv + d / 2;
    }
    Object.assign(W, nw);
    _changed(id);
  }
  function reset(id) {
    const s = get(id);
    if (_isFull(s.win)) return;
    s.win = _full();
    _changed(id);
  }
  function resetAll() { Object.keys(_st).forEach(id => { _st[id].win = _full(); }); }

  // A label-drag handler took this mousedown — don't pan / box-select as well.
  function cancelPan() { _pan = null; _endBox(); }
  function _endBox() { if (_box) { _box.el.remove(); _box = null; } }

  // ── Toolbar ──────────────────────────────────────────────────────────────────
  function _syncTools(id) {
    const s = get(id), canvas = document.getElementById(id);
    if (!s.tools || !canvas) return;
    s.tools.style.left = (canvas.offsetLeft + 6) + 'px';      // top-left corner: clear of the axis numbers
    s.tools.style.top  = (canvas.offsetTop + 6) + 'px';
    s.tools.classList.toggle('zoomed', !_isFull(s.win));
    s.tools.querySelector('.qz-pct').textContent = Math.round(_mag(s.win) * 100) + '%';
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
      if (!s.rect || (_isFull(s.win) && f <= 1)) return;
      e.preventDefault();
      zoomBy(id, f, cx, cy);
    }, { passive: false });

    canvas.addEventListener('mousedown', e => {
      if (e.button !== 0 || !s.rect) return;
      if (e.shiftKey) {                                 // Shift + drag: move the view
        if (!_isFull(s.win)) _pan = { id, x: e.clientX, y: e.clientY, win: { ...s.win } };
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

  function _boxRect() {                                 // selection clipped to the zoom rectangle, client px
    const canvas = document.getElementById(_box.id), r = canvas.getBoundingClientRect(), R = get(_box.id).rect;
    const k = (r.width || 1) / (canvas.width || 1);     // canvas px → client px
    const L = r.left + R.l * k, T = r.top + R.t * k, Rt = L + R.pw * k, Bt = T + R.ph * k;
    const cl = v => Math.min(Math.max(v, L), Rt), ct = v => Math.min(Math.max(v, T), Bt);
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
    if (!canvas || !s.rect) { _pan = null; return; }
    const r = canvas.getBoundingClientRect(), k = canvas.width / (r.width || 1);
    const dx = (e.clientX - _pan.x) * k, dy = (e.clientY - _pan.y) * k;
    const w0 = _pan.win, du = w0.u1 - w0.u0, dv = w0.v1 - w0.v0;
    const u0 = Math.min(Math.max(0, w0.u0 - dx / s.rect.pw * du), 1 - du);
    const v0 = Math.min(Math.max(0, w0.v0 - dy / s.rect.ph * dv), 1 - dv);
    s.win = { u0, u1: u0 + du, v0, v1: v0 + dv };
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

  return { attach, apply, plotWindow, begin, end, pause, resume, pt, toBase, eventToBase, visible, visibleRect,
           zoomed, zoomBy, zoomToRect, reset, resetAll, cancelPan, get };
})();
