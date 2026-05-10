// ===== CHART INTERACTION LAYER =====
// Crosshair overlay, right-click freeze, right-click annotations.
//
// Each draw function calls:
//   CI.register(id, meta)      — store coordinate bounds after drawing grid
//   CI.storeLive(id, curves)   — store current live curve data for freeze
//   CI.drawFrozen(ctx, id)     — render frozen snapshots (before live curves)
//   CI.drawAnnotations(ctx,id) — render annotation pins (after live curves)
//
// meta shape: { pad:{l,t,pw,ph}, xMax, yMax, xLabel, yLabel, depthDown }
//   depthDown=false → depth 0 at canvas bottom (torque/overpull/_chartGrid)
//   depthDown=true  → depth 0 at canvas top    (broomstick/_chartGridDepthDown)

const CI = (() => {
  const _state = {};
  let   _menu  = null;
  let   _tip   = null;

  function _st(id) {
    if (!_state[id]) _state[id] = { meta: null, live: null, frozen: [], annotations: [] };
    return _state[id];
  }

  // ── API called by draw functions ───────────────────────────────────────────

  function register(id, meta) {
    _st(id).meta = meta;
  }

  function storeLive(id, curves) {
    _st(id).live = curves;
  }

  function getFrozen(id) {
    return _st(id).frozen;
  }

  function drawFrozen(ctx, id) {
    const s = _st(id);
    if (!s.meta || !s.frozen.length) return;
    const { pad: { l, t, pw, ph }, xMax, yMax, depthDown } = s.meta;

    ctx.save();
    s.frozen.forEach((snap, si) => {
      ctx.globalAlpha = 0.40;
      ctx.setLineDash([5, 3]);
      snap.curves.forEach(c => {
        ctx.strokeStyle = c.color;
        ctx.lineWidth   = 1.5;
        ctx.lineJoin    = 'round';
        ctx.beginPath();
        c.pts.forEach((p, i) => {
          const x = l + (p.x / xMax) * pw;
          const y = depthDown ? t + (p.y / yMax) * ph : t + (1 - p.y / yMax) * ph;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
      });
      // Label tag — colored swatch + label text
      ctx.globalAlpha = 0.80;
      ctx.setLineDash([]);
      const tagColor = snap.curves[0]?.color || '#1a5f7a';
      const ty = t + 4 + si * 14;
      ctx.fillStyle = tagColor;
      ctx.fillRect(l + 4, ty + 1, 8, 8);
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = '#1a2b38';
      ctx.fillText(`❄ ${snap.label}`, l + 15, ty);
    });
    ctx.restore();
    ctx.setLineDash([]);
  }

  function drawAnnotations(ctx, id) {
    const s = _st(id);
    if (!s.meta || !s.annotations.length) return;
    const { pad: { l, t, pw, ph }, xMax, yMax, depthDown } = s.meta;

    s.annotations.forEach(ann => {
      const cx = l + (ann.xVal / xMax) * pw;
      const cy = depthDown ? t + (ann.yVal / yMax) * ph : t + (1 - ann.yVal / yMax) * ph;

      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();

      ctx.font = '11px sans-serif';
      const tw = ctx.measureText(ann.text).width;
      const bw = tw + 16, bh = 22;
      const bx = cx + 8, by = cy - bh / 2;

      ctx.fillStyle = 'rgba(26,43,56,0.88)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 4);
      else ctx.rect(bx, by, bw, bh);
      ctx.fill();

      ctx.fillStyle = '#e8f5fc';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(ann.text, bx + 8, by + bh / 2);
    });
  }

  // ── Attach events to a canvas (call once on load) ──────────────────────────

  function attach(id) {
    const canvas = document.getElementById(id);
    if (!canvas) return;

    canvas.parentElement.style.position = 'relative';

    let ov = document.getElementById(id + '_ov');
    if (!ov) {
      ov = document.createElement('canvas');
      ov.id = id + '_ov';
      ov.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
      canvas.parentElement.appendChild(ov);
    }

    if (!_tip) {
      _tip = document.createElement('div');
      _tip.id = 'qp_tip';
      _tip.style.cssText = [
        'position:fixed', 'display:none', 'z-index:2000', 'pointer-events:none',
        'background:#1a2b38', 'color:#e8f5fc', 'border-radius:5px',
        'padding:5px 10px', 'font:11px/1.6 monospace', 'white-space:pre',
        'box-shadow:0 2px 10px rgba(0,0,0,.4)',
      ].join(';');
      document.body.appendChild(_tip);
    }

    canvas.addEventListener('mousemove',   e => _onMove(e, id, ov, canvas));
    canvas.addEventListener('mouseleave',  ()  => _onLeave(ov, canvas));
    canvas.addEventListener('contextmenu', e   => _onRClick(e, id, canvas));
  }

  // ── Mouse move ─────────────────────────────────────────────────────────────

  function _onMove(e, id, ov, canvas) {
    const s = _st(id);
    if (!s.meta) return;

    const rect  = canvas.getBoundingClientRect();
    const sx    = canvas.width  / rect.width;
    const sy    = canvas.height / rect.height;
    const cx    = (e.clientX - rect.left) * sx;
    const cy    = (e.clientY - rect.top)  * sy;
    const { pad: { l, t, pw, ph } } = s.meta;

    if (cx < l || cx > l + pw || cy < t || cy > t + ph) {
      _clearOv(ov, canvas); _tip.style.display = 'none'; return;
    }

    ov.width  = canvas.width;
    ov.height = canvas.height;
    const oc = ov.getContext('2d');
    oc.clearRect(0, 0, ov.width, ov.height);
    oc.strokeStyle = 'rgba(26,95,122,.60)';
    oc.lineWidth   = 1;
    oc.setLineDash([4, 3]);
    oc.beginPath(); oc.moveTo(cx, t);     oc.lineTo(cx, t + ph); oc.stroke();
    oc.beginPath(); oc.moveTo(l, cy);     oc.lineTo(l + pw, cy); oc.stroke();
    oc.setLineDash([]);

    const coords      = _toData(cx, cy, s.meta);
    _tip.textContent  = coords.label;
    _tip.style.display = 'block';
    _tip.style.left    = (e.clientX + 16) + 'px';
    _tip.style.top     = (e.clientY - 8)  + 'px';
  }

  function _onLeave(ov, canvas) {
    _clearOv(ov, canvas);
    if (_tip) _tip.style.display = 'none';
  }

  function _clearOv(ov, canvas) {
    ov.width = canvas.width || 1;
    ov.getContext('2d').clearRect(0, 0, ov.width, ov.height);
  }

  // ── Right-click ────────────────────────────────────────────────────────────

  function _onRClick(e, id, canvas) {
    e.preventDefault();
    _closeMenu();

    const rect = canvas.getBoundingClientRect();
    const cx   = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const cy   = (e.clientY - rect.top)  * (canvas.height / rect.height);
    const s    = _st(id);
    const inPl = s.meta && _inPlot(cx, cy, s.meta.pad);
    const coords = (s.meta && inPl) ? _toData(cx, cy, s.meta) : null;

    const items = [
      {
        icon: '❄', text: 'Freeze current curves',
        fn: () => _doFreeze(id),
      },
      ...s.frozen.map((snap, si) => ({
        icon: '✎', text: `Edit "${snap.label}"`,
        fn: () => _openSnapEdit(id, si),
      })),
      s.frozen.length ? {
        icon: '🗑', text: `Clear ${s.frozen.length} frozen snapshot${s.frozen.length > 1 ? 's' : ''}`,
        fn: () => { _st(id).frozen = []; _redraw(id); },
      } : null,
      coords ? {
        icon: '💬', text: 'Add annotation here',
        fn: () => _doAnnotate(id, coords),
      } : null,
      s.annotations.length ? {
        icon: '✕', text: `Clear ${s.annotations.length} annotation${s.annotations.length > 1 ? 's' : ''}`,
        fn: () => { _st(id).annotations = []; _redraw(id); },
      } : null,
    ].filter(Boolean);

    _menu = document.createElement('div');
    _menu.id = 'qp_ctx';
    _menu.style.cssText = [
      `left:${e.clientX}px`, `top:${e.clientY}px`,
      'position:fixed', 'z-index:3000', 'min-width:210px',
      'background:#fff', 'border:1px solid #9ecce3',
      'border-radius:7px', 'box-shadow:0 6px 24px rgba(0,0,0,.22)',
      'overflow:hidden', 'font:13px sans-serif',
    ].join(';');

    items.forEach(item => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:9px 16px;cursor:pointer;display:flex;gap:9px;align-items:center;color:#1a2b38;';
      row.innerHTML = `<span style="font-size:15px">${item.icon}</span><span>${item.text}</span>`;
      row.onmouseenter = () => row.style.background = '#e8f5fc';
      row.onmouseleave = () => row.style.background = '';
      row.onclick = () => { _closeMenu(); item.fn(); };
      _menu.appendChild(row);
    });

    document.body.appendChild(_menu);
    setTimeout(() => document.addEventListener('click', _closeMenu, { once: true }), 10);
  }

  function _closeMenu() { _menu?.remove(); _menu = null; }

  function _doFreeze(id) {
    const s = _st(id);
    if (!s.live?.length) { alert('No data — run Compute first.'); return; }
    const n = s.frozen.length + 1;
    s.frozen.push({
      curves: s.live.map(c => ({ ...c, pts: c.pts.slice() })),
      label: `Snap ${n}`,
    });
    _redraw(id);
  }

  function _doAnnotate(id, coords) {
    const text = prompt(`Annotation at ${coords.label.replace('\n', ' | ')}:`, '');
    if (!text?.trim()) return;
    _st(id).annotations.push({ ...coords, text: text.trim() });
    _redraw(id);
  }

  function _openSnapEdit(id, snapIdx) {
    document.getElementById('qp_snap_modal')?.remove();

    const snap = _st(id).frozen[snapIdx];
    if (!snap) return;

    const modal = document.createElement('div');
    modal.id = 'qp_snap_modal';
    modal.style.cssText = [
      'position:fixed', 'z-index:4000',
      'top:50%', 'left:50%', 'transform:translate(-50%,-50%)',
      'background:#fff', 'border:1px solid #9ecce3',
      'border-radius:10px', 'box-shadow:0 8px 32px rgba(0,0,0,.28)',
      'padding:20px 24px', 'min-width:280px', 'font:13px sans-serif', 'color:#1a2b38',
    ].join(';');

    const curveRows = snap.curves.map((c, ci) => `
      <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
        <input type="color" id="qp_sc_${ci}" value="${c.color}"
          style="width:32px;height:26px;border:1px solid #ccd;border-radius:4px;cursor:pointer;padding:1px">
        <span style="flex:1;color:#5a7a8e">${c.label || 'Curve ' + (ci + 1)}</span>
      </div>`).join('');

    modal.innerHTML = `
      <div style="font:bold 13px sans-serif;margin-bottom:14px;color:#1a5f7a">✎ Edit Snapshot</div>
      <label style="display:block;margin-bottom:4px;color:#5a7a8e;font-size:11px">LABEL</label>
      <input id="qp_snap_lbl" type="text" value="${snap.label}"
        style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #9ecce3;border-radius:5px;font:13px sans-serif">
      <div style="margin-top:12px;margin-bottom:4px;color:#5a7a8e;font-size:11px">CURVE COLORS</div>
      ${curveRows}
      <div style="display:flex;gap:10px;margin-top:18px">
        <button id="qp_snap_save"
          style="flex:1;padding:7px;background:#1a5f7a;color:#fff;border:none;border-radius:5px;cursor:pointer;font:13px sans-serif">
          Save
        </button>
        <button id="qp_snap_cancel"
          style="flex:1;padding:7px;background:#e8f0f5;color:#1a2b38;border:none;border-radius:5px;cursor:pointer;font:13px sans-serif">
          Cancel
        </button>
      </div>`;

    document.body.appendChild(modal);

    document.getElementById('qp_snap_save').onclick = () => {
      snap.label = document.getElementById('qp_snap_lbl').value.trim() || snap.label;
      snap.curves.forEach((c, ci) => {
        c.color = document.getElementById(`qp_sc_${ci}`)?.value || c.color;
      });
      modal.remove();
      _redraw(id);
    };
    document.getElementById('qp_snap_cancel').onclick = () => modal.remove();
  }

  // ── Coordinate helpers ─────────────────────────────────────────────────────

  function _toData(cx, cy, meta) {
    const { pad: { l, t, pw, ph }, xMax, yMax, xLabel, yLabel, depthDown,
            xOffset = 0, yOffset = 0 } = meta;
    const xVal = xMax * (cx - l) / pw + xOffset;
    const yVal = (depthDown ? yMax * (cy - t) / ph : yMax * (1 - (cy - t) / ph)) + yOffset;
    return {
      xVal, yVal,
      label: `${yLabel}: ${yVal.toFixed(0)}\n${xLabel}: ${xVal.toFixed(0)}`,
    };
  }

  function _inPlot(cx, cy, pad) {
    return cx >= pad.l && cx <= pad.l + pad.pw && cy >= pad.t && cy <= pad.t + pad.ph;
  }

  function _redraw(id) {
    const map = {
      torqueCanvas: 'torque', bucklingCanvas: 'buckling',
      overpullCanvas: 'overpull', broomstickCanvas: 'broomstick',
      hydSweepCanvas: 'hydraulics', afeCanvas: 'afe',
      trajVsCanvas: 'trajplot', trajPlanCanvas: 'trajplot',
      cdBurstCanvas: 'cd', cdCollapseCanvas: 'cd',
      ktCanvas: 'kt',
    };
    if (typeof redrawOutputPanel === 'function')
      redrawOutputPanel(map[id] || (typeof qpState !== 'undefined' && qpState.activeOutputTab));
  }

  return { attach, register, storeLive, getFrozen, drawFrozen, drawAnnotations };
})();
