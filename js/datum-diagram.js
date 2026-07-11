// ===== DATUM DIAGRAM =====
// Small fixed-scale "plan settings" style diagram (bottom of the right panel)
// showing the elevation datums — RKB / GL / MSL onshore, RKB / MSL / Seabed
// offshore — with the rig standing on the ground / over the water. Separated
// from the main well schematic so the datum relationships stay readable no
// matter how deep the well is (on a deep well the main schematic's depth scale
// crushes the near-surface zone into a few pixels).
//
// Datum semantics (imperial ft, from qpState.wellDatums):
//   onshore : rkb = RKB above GL (air gap), gl = GL elevation above MSL
//   offshore: rkb = RKB above MSL,          seaBedDepth = water depth below MSL

function drawDatumDiagram() {
  const canvas = document.getElementById('datumCanvas');
  if (!canvas) return;
  const wrap = canvas.parentElement;
  canvas.width  = wrap.clientWidth  || 300;
  canvas.height = wrap.clientHeight || 150;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8fbfd';
  ctx.fillRect(0, 0, W, H);

  const d = qpState.wellDatums;
  if (!d) {
    ctx.fillStyle = '#9ecce3'; ctx.font = '11px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Select a well to see its datums', W / 2, H / 2);
    return;
  }

  // Values are imperial ft → active display unit for labels
  const val = v => {
    const x = QP_UNITS.toDisplay('depth', +v || 0);
    return (Math.round(x * 100) / 100).toLocaleString() + ' ' + QP_UNITS.label('depth');
  };

  const env = d.environment === 'offshore' ? 'offshore' : 'onshore';

  // Fixed layout (NOT to depth scale — that's the whole point)
  const cx  = Math.min(78, W * 0.28);        // rig centre
  const X1  = Math.min(158, W * 0.55);       // datum line right end
  const LX  = X1 + 10;                       // label x
  const yRKB = 52;
  const yMid = Math.round(H * 0.60);         // GL (onshore) / MSL (offshore)
  const yLow = H - 18;                       // MSL (onshore) / Seabed (offshore)

  const label = (txt, y, color) => {
    ctx.fillStyle = color; ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, LX, y);
  };
  const dashLine = (y, color) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(X1, y); ctx.stroke();
    ctx.setLineDash([]);
  };
  const groundLine = y => {
    ctx.fillStyle = 'rgba(150, 120, 70, 0.13)';
    ctx.fillRect(0, y, W, H - y);
    ctx.strokeStyle = '#8a7040'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.lineWidth = 1;
    for (let gx = 4; gx < W; gx += 9) {
      ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx - 4, y + 4); ctx.stroke();
    }
  };

  // Environment tag (top-right)
  ctx.fillStyle = '#1a5f7a'; ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.fillText(env === 'offshore' ? 'Offshore' : 'Land', W - 8, 4);

  // Dashed vertical guide connecting the datums (like the reference sketch)
  ctx.strokeStyle = '#b0c4d0'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.moveTo(X1 - 8, yRKB); ctx.lineTo(X1 - 8, yLow); ctx.stroke();
  ctx.setLineDash([]);

  if (env === 'onshore') {
    groundLine(yMid);                                       // GL = ground surface
    _drawRigIcon(ctx, cx, yRKB, yMid);                      // floor at RKB, legs to GL
    dashLine(yRKB, '#1a5f7a'); label('RKB  ' + val(d.rkb), yRKB, '#1a5f7a');
    label('GL  ' + val(d.gl), yMid - 8, '#6f5a30');
    dashLine(yLow, '#0055aa'); label('MSL  ' + val(0), yLow, '#0055aa');
  } else {
    // Water between MSL and seabed
    ctx.fillStyle = 'rgba(0, 100, 210, 0.11)';
    ctx.fillRect(0, yMid, W, yLow - yMid);
    ctx.strokeStyle = 'rgba(0, 100, 210, 0.40)'; ctx.lineWidth = 1;
    for (let wx = 0; wx < W; wx += 10) {
      ctx.beginPath(); ctx.moveTo(wx, yMid);
      ctx.quadraticCurveTo(wx + 5, yMid - 3, wx + 10, yMid);
      ctx.stroke();
    }
    groundLine(yLow);                                       // seabed
    _drawRigIcon(ctx, cx, yRKB, yMid);                      // floor at RKB, legs to MSL
    dashLine(yRKB, '#1a5f7a'); label('RKB  ' + val(d.rkb), yRKB, '#1a5f7a');
    label('MSL  ' + val(0), yMid - 8, '#0055aa');
    label('SB  ' + val(d.seaBedDepth), yLow - 8, '#6f5a30');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  drawDatumDiagram();
  if (typeof QP_UNITS !== 'undefined') QP_UNITS.onChange(() => drawDatumDiagram());
});
window.addEventListener('resize', () => drawDatumDiagram());
