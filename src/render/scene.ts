// Main canvas (v24 draw(), wheel(), drawDiagram(), drawTach(), lines 206-282). Reads the car and the
// sim's view helpers (predict, tractionState); never writes sim state. UI text is Portuguese, as in v24.
import { HALO_THRESHOLD, predict, tractionState, type CarState, type SimParams } from '../sim/index.ts';
import { WORLD_W, type LotArt } from './lot.ts';
import { DIAG, DIAG_FY, DIAG_RY, type View } from './view.ts';

export const SCREEN_W = 640;
export const SCREEN_H = 420;
const CX = SCREEN_W / 2, CY = SCREEN_H / 2, DEG = 57.3;

export interface Frame {
  car: CarState;
  params: SimParams;
  view: View;
  lot: LotArt;
  paused: boolean;
  dt: number; // real frame time, s (camera smoothing only)
}

type RGB = [number, number, number];

/** Share as a whole percent, never above 100. */
export const pct = (u: number): number => Math.round(Math.min(1, u) * 100);
/** v24 fmt(): decimal comma. */
export const fmt = (x: number, d = 0): string => x.toFixed(d).replace('.', ',');

/** Line color from pedal intent: amber coast, green throttle, red brake (brake wins). */
function pedalColor(t: number, b: number): string {
  const A: RGB = [255, 200, 61], R: RGB = [255, 70, 60], G: RGB = [80, 215, 100];
  let C = A, f = 0;
  if (b > 0.02) { C = R; f = Math.min(1, 0.35 + b); }
  else if (t > 0.02) { C = G; f = Math.min(1, 0.35 + t); }
  return 'rgb(' + A.map((a, i) => Math.round(a + (C[i]! - a) * f)).join(',') + ')';
}

const TRAIL_COLORS = ['rgba(95,209,107,0.6)', 'rgba(255,200,61,0.8)', 'rgba(255,90,78,0.9)'] as const;
const useColor = (u: number): string => (u >= 1 ? '#ff5a4e' : u >= 0.8 ? '#ffc83d' : '#5fd16b');
const HALO_STOPS: [number, RGB][] = [[0, [255, 215, 60]], [0.35, [255, 145, 40]], [0.7, [255, 60, 50]], [1, [215, 30, 110]]];

/** Halo color: yellow, orange, red, magenta as strength p goes 0..1. */
export function haloRgb(p: number): RGB {
  for (let i = 1; i < HALO_STOPS.length; i++) {
    const [a1, c1] = HALO_STOPS[i]!;
    if (p <= a1) {
      const [a0, c0] = HALO_STOPS[i - 1]!, f = (p - a0) / (a1 - a0);
      return c0.map((v, j) => Math.round(v + (c1[j]! - v) * f)) as RGB;
    }
  }
  return HALO_STOPS[HALO_STOPS.length - 1]![1];
}

function wheel(c: CanvasRenderingContext2D, x: number, y: number, ang: number, roll: number, rate: number, use: number, rw: number): void {
  const w = 11, h = 22;
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.fillStyle = '#16181c';
  c.fillRect(-w / 2, -h / 2, w, h);
  c.save();
  c.beginPath();
  c.rect(-w / 2, -h / 2, w, h);
  c.clip();
  if (rate > 45) {
    c.fillStyle = 'rgba(120,124,132,0.55)'; // spinning too fast to see the tread: blur
    c.fillRect(-w / 2 + 1, -h / 2, w - 2, h);
  } else {
    c.strokeStyle = '#3a3f47';
    c.lineWidth = 2;
    const sp = 5, off = (((roll * rw * 14) % sp) + sp) % sp;
    for (let yy = -h / 2 - sp + off; yy < h / 2 + sp; yy += sp) {
      c.beginPath();
      c.moveTo(-w / 2, yy);
      c.lineTo(w / 2, yy);
      c.stroke();
    }
  }
  c.restore();
  c.strokeStyle = useColor(use);
  c.lineWidth = 2.5;
  c.strokeRect(-w / 2 - 1.5, -h / 2 - 1.5, w + 3, h + 3);
  c.restore();
}

function drawDiagram(c: CanvasRenderingContext2D, s: CarState, view: View, rw: number): void {
  const DX = DIAG.x, DY = DIAG.y, DTR = DIAG.track;
  c.fillStyle = 'rgba(29,36,48,0.88)';
  c.fillRect(8, 8, 176, 152);
  c.save();
  c.beginPath();
  c.rect(8, 8, 176, 152);
  c.clip();
  for (const q of view.dsm) {
    c.fillStyle = 'rgba(225,225,225,' + 0.5 * q.life + ')';
    c.beginPath();
    c.arc(q.x, q.y, q.s, 0, 7);
    c.fill();
  }
  c.strokeStyle = '#5a6578';
  c.lineWidth = 1.5;
  c.beginPath();
  if (typeof c.roundRect === 'function') c.roundRect(DX - 17, DIAG_FY - 16, 34, DIAG.wheelbase + 32, 8);
  else c.rect(DX - 17, DIAG_FY - 16, 34, DIAG.wheelbase + 32);
  c.stroke();
  c.strokeStyle = '#8a93a3';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(DX - DTR / 2, DIAG_FY);
  c.lineTo(DX + DTR / 2, DIAG_FY);
  c.moveTo(DX - DTR / 2, DIAG_RY);
  c.lineTo(DX + DTR / 2, DIAG_RY);
  c.moveTo(DX, DIAG_FY);
  c.lineTo(DX, DIAG_RY);
  c.stroke();
  // Blue arrow: where the car is really going (slip angle).
  const vang = -Math.PI / 2 + s.beta, al = Math.min(46, 10 + s.v * 1.2);
  if (s.v > 1) {
    c.strokeStyle = '#7ec8ff';
    c.fillStyle = '#7ec8ff';
    c.lineWidth = 2.5;
    const ex = DX + Math.cos(vang) * al, ey = DY + Math.sin(vang) * al;
    c.beginPath();
    c.moveTo(DX, DY);
    c.lineTo(ex, ey);
    c.stroke();
    c.save();
    c.translate(ex, ey);
    c.rotate(vang);
    c.beginPath();
    c.moveTo(6, 0);
    c.lineTo(-4, -4.5);
    c.lineTo(-4, 4.5);
    c.closePath();
    c.fill();
    c.restore();
  }
  wheel(c, DX - DTR / 2, DIAG_FY, s.delta, s.wF, s.rateF, s.useF, rw);
  wheel(c, DX + DTR / 2, DIAG_FY, s.delta, s.wF, s.rateF, s.useF, rw);
  wheel(c, DX - DTR / 2, DIAG_RY, 0, s.wR, s.rateR, s.useR, rw);
  wheel(c, DX + DTR / 2, DIAG_RY, 0, s.wR, s.rateR, s.useR, rw);
  c.restore();
  c.font = '500 13px sans-serif';
  c.fillStyle = '#f4f1ea';
  c.textAlign = 'center';
  c.fillText('Direção ' + (s.delta >= 0 ? '' : '−') + Math.abs(Math.round(s.delta * DEG)) + '°', DX, 24);
  c.font = '11px sans-serif';
  c.fillStyle = '#7ec8ff';
  c.fillText('Deriva ' + Math.abs(Math.round(s.beta * DEG)) + '°', DX, 152);
  c.textAlign = 'left';
  c.font = '500 11px sans-serif';
  c.fillStyle = useColor(s.useF);
  c.fillText(s.lockF ? 'TRAV' : pct(s.useF) + '%', DX + DTR / 2 + 10, DIAG_FY + 4);
  c.fillStyle = useColor(s.useR);
  c.fillText(pct(s.useR) + '%', DX + DTR / 2 + 10, DIAG_RY + 4);
  c.fillStyle = '#8a93a3';
  c.font = '10px sans-serif';
  c.fillText('diant.', DX - DTR / 2 - 38, DIAG_FY + 4);
  c.fillText('tras.', DX - DTR / 2 - 34, DIAG_RY + 4);
}

/** Arc tachometer in front of the car, gear at the tip, rpm readout with "M" when manual. */
function drawTach(c: CanvasRenderingContext2D, s: CarState, p: SimParams, sx: number, sy: number): void {
  const IDLE = p.car.idleRpm, RED = p.car.redlineRpm, CUT = p.car.cutRpm;
  const R = 48, a0 = s.h - 1.05, a1 = s.h + 1.05;
  const f = Math.max(0, Math.min(1, (s.rpm - IDLE) / (CUT - IDLE))), fr = (RED - IDLE) / (CUT - IDLE), am = a0 + (a1 - a0) * f;
  c.save();
  c.lineCap = 'butt';
  c.strokeStyle = 'rgba(20,24,30,0.55)';
  c.lineWidth = 9;
  c.beginPath();
  c.arc(sx, sy, R, a0, a1);
  c.stroke();
  c.strokeStyle = 'rgba(255,90,78,0.45)';
  c.beginPath();
  c.arc(sx, sy, R, a0 + (a1 - a0) * fr, a1);
  c.stroke();
  const col = s.cut ? (Math.sin(s.tt * 40) > 0 ? '#ff3b3b' : '#ffffff') : s.rpm > RED ? '#ff5a4e' : s.rpm > 5500 ? '#ffc83d' : '#5fd16b';
  c.strokeStyle = col;
  c.lineWidth = 5;
  c.beginPath();
  c.arc(sx, sy, R, a0, am);
  c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.6)';
  c.lineWidth = 1;
  for (let k = 1; k <= 7; k++) {
    const ff = (k * 1000 - IDLE) / (CUT - IDLE);
    if (ff < 0 || ff > 1) continue;
    const a = a0 + (a1 - a0) * ff;
    c.beginPath();
    c.moveTo(sx + Math.cos(a) * (R - 5), sy + Math.sin(a) * (R - 5));
    c.lineTo(sx + Math.cos(a) * (R + 5), sy + Math.sin(a) * (R + 5));
    c.stroke();
  }
  const gx = sx + Math.cos(a1 + 0.22) * (R + 2), gy = sy + Math.sin(a1 + 0.22) * (R + 2);
  c.fillStyle = 'rgba(20,24,30,0.85)';
  c.beginPath();
  c.arc(gx, gy, 11, 0, 7);
  c.fill();
  c.fillStyle = s.shiftT > 0 ? '#7ec8ff' : '#f4f1ea';
  c.font = '500 13px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(String(s.gear + 1), gx, gy + 0.5);
  const lx = sx + Math.cos(a0 - 0.3) * (R + 4), ly = sy + Math.sin(a0 - 0.3) * (R + 4);
  c.font = '500 11px sans-serif';
  c.fillStyle = 'rgba(20,24,30,0.8)';
  const txt = fmt(Math.round(s.rpm / 100) / 10, 1) + 'k' + (s.auto ? '' : ' M');
  const tw = c.measureText(txt).width;
  c.fillRect(lx - tw / 2 - 4, ly - 8, tw + 8, 16);
  c.fillStyle = col;
  c.fillText(txt, lx, ly);
  c.restore();
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
}

function strokePath(c: CanvasRenderingContext2D, a: [number, number], b: [number, number]): void {
  c.beginPath();
  c.moveTo(a[0], a[1]);
  c.lineTo(b[0], b[1]);
  c.stroke();
}

const MODE_MSG: Record<string, string> = {
  spin: 'Rodou!', drift: 'Drift! Acelerador + contraesterço', rear: 'Saindo de traseira — contraesterce',
  front: 'Saindo de frente — menos direção',
};

export function drawScene(c: CanvasRenderingContext2D, f: Frame): void {
  const s = f.car, p = f.params, view = f.view, PX = p.lot.scale, LA = p.car.la, LB = p.car.lb;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#3f7a3a';
  c.fillRect(0, 0, SCREEN_W, SCREEN_H);
  // Camera: zoom out with speed, look ahead along the travel direction.
  const zt = 1.25 - Math.min(0.55, s.v * 0.013);
  view.zoom += (zt - view.zoom) * Math.min(1, 2 * f.dt);
  const vd = s.h + s.beta, z = view.zoom, la = s.v * 0.35 * PX;
  const cx = s.x * PX + Math.cos(vd) * la, cy = s.y * PX + Math.sin(vd) * la;
  c.setTransform(z, 0, 0, z, CX - cx * z, CY - cy * z);
  c.drawImage(f.lot.image, 0, 0);
  c.fillStyle = 'rgba(15,15,15,0.4)';
  for (const q of view.skids) c.fillRect(q[0] - 1.2, q[1] - 1.2, 2.4, 2.4);
  c.lineWidth = 2;
  for (let i = 1; i < view.trail.length; i++) {
    const a = view.trail[i - 1]!, b = view.trail[i]!;
    c.strokeStyle = TRAIL_COLORS[b[2]];
    strokePath(c, [a[0], a[1]], [b[0], b[1]]);
  }
  for (const q of view.smoke) {
    c.fillStyle = 'rgba(230,230,230,' + (0.18 * q.life) / q.max + ')';
    c.beginPath();
    c.arc(q.x, q.y, q.s, 0, 7);
    c.fill();
  }
  // Projected racing line (sim geometry in meters, drawn in world px).
  const pr = predict(s, p), pts = pr.pts.map(([x, y]): [number, number] => [x * PX, y * PX]);
  const col = pedalColor(s.t, s.b), ts = tractionState(s), on = ts.risk > HALO_THRESHOLD && s.v > 2;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  if (on) {
    // Traction halo: grows along the line and pulses when the limit is predicted.
    const rgb = haloRgb(ts.p).join(','), frac = 0.15 + 0.85 * ts.p, nEnd = Math.max(2, Math.round(pts.length * frac));
    let al = 0.3 + 0.45 * ts.p;
    if (ts.warn) al *= 0.6 + 0.4 * Math.sin(s.tt * 22);
    const w = 7 + 15 * ts.p;
    for (const [ww, k] of [[w * 1.7, 0.35], [w, 1]] as const) {
      c.lineWidth = ww;
      for (let i = 1; i < nEnd; i++) {
        const fade = 1 - 0.7 * (i / nEnd);
        c.strokeStyle = 'rgba(' + rgb + ',' + al * k * fade + ')';
        strokePath(c, pts[i - 1]!, pts[i]!);
      }
    }
  }
  c.strokeStyle = col;
  c.lineWidth = 5;
  for (let i = 1; i < pts.length; i++) {
    c.globalAlpha = 1 - (0.6 * i) / pts.length;
    strokePath(c, pts[i - 1]!, pts[i]!);
  }
  if (pr.slip) {
    // Dashed white overlay: the steering asks for more grip than the tires have.
    c.globalAlpha = 0.9;
    c.strokeStyle = '#fff';
    c.lineWidth = 1.5;
    c.setLineDash([4, 6]);
    c.beginPath();
    for (const q of pts) c.lineTo(q[0], q[1]);
    c.stroke();
    c.setLineDash([]);
  }
  c.globalAlpha = 0.6;
  const e = pts[pts.length - 1]!, pb = pts[pts.length - 3]!, an = Math.atan2(e[1] - pb[1], e[0] - pb[0]);
  c.save();
  c.translate(e[0], e[1]);
  c.rotate(an);
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(10, 0);
  c.lineTo(-5, -7);
  c.lineTo(-5, 7);
  c.closePath();
  c.fill();
  c.restore();
  c.globalAlpha = 1;
  // Car body, wheels (front ones steer), cockpit, headlights.
  const fa = LA * PX, ra = LB * PX, ov = 0.96 * PX, hw = 7.6;
  c.save();
  c.translate(s.x * PX, s.y * PX);
  c.rotate(s.h);
  c.fillStyle = '#111';
  for (const wy of [-hw + 1.5, hw - 1.5]) c.fillRect(-ra - 3.5, wy - 1.8, 7, 3.6);
  for (const wy of [-hw + 1.5, hw - 1.5]) {
    c.save();
    c.translate(fa, wy);
    c.rotate(s.delta);
    c.fillRect(-3.5, -1.8, 7, 3.6);
    c.restore();
  }
  c.fillStyle = '#e8402f';
  c.fillRect(-ra - ov, -hw + 1, fa + ra + 2 * ov, 2 * hw - 2);
  c.fillStyle = '#1d2430';
  c.fillRect(-2, -hw + 2.5, 9, 2 * hw - 5);
  c.fillStyle = '#ffe9a8';
  c.fillRect(fa + ov - 2, -hw + 2, 2, 3.5);
  c.fillRect(fa + ov - 2, hw - 5.5, 2, 3.5);
  c.restore();
  c.setTransform(1, 0, 0, 1, 0, 0);
  drawTach(c, s, p, (s.x * PX - cx) * z + CX, (s.y * PX - cy) * z + CY);
  // Axle label at the line tip: words, never a percentage above 100.
  const danger = on && ts.p > 0.75 && ts.rising;
  if (on) {
    const lx = Math.max(200, Math.min(520, (e[0] - cx) * z + CX + 14)), ly = Math.max(130, Math.min(270, (e[1] - cy) * z + CY - 10));
    const ax = ts.rear ? 'Traseira' : 'Dianteira';
    const label = danger ? ax + ' passando do ponto' : ts.risk >= 1 ? ax + ' no limite' : ax + ' ' + pct(ts.risk) + '%' + (ts.rising ? ' ↑' : '');
    c.font = '500 12px sans-serif';
    const tw = c.measureText(label).width;
    c.fillStyle = 'rgba(29,36,48,0.9)';
    c.fillRect(lx - 6, ly - 14, tw + 12, 20);
    c.fillStyle = 'rgb(' + haloRgb(Math.max(0.15, ts.p)).join(',') + ')';
    c.fillText(label, lx, ly);
  }
  drawDiagram(c, s, view, p.car.wheelRadius);
  // HUD panel: speed, gear, drift timer, pedal bars with traction-limit tick, steering, slip gauge, coaching line.
  c.fillStyle = 'rgba(29,36,48,0.88)';
  c.fillRect(12, 290, 268, 118);
  c.font = '500 14px sans-serif';
  c.fillStyle = '#f4f1ea';
  c.fillText(Math.round(s.v * 3.6) + ' km/h', 24, 311);
  c.font = '12px sans-serif';
  c.fillStyle = '#8a93a3';
  c.fillText(s.gear + 1 + 'ª ' + (s.auto ? 'auto' : 'manual') + ' · ' + Math.round(s.rpm / 100) * 100 + ' rpm', 100, 311);
  const best = s.drifts.length ? Math.max(...s.drifts.map((d) => d.dur)) : 0;
  c.fillStyle = s.cur ? '#7ec8ff' : '#8a93a3';
  c.fillText('Drift ' + fmt(s.cur ? s.cur.dur : 0, 1) + 's · recorde ' + fmt(best, 1) + 's · ' + s.drifts.length + ' registrados', 24, 328);
  c.fillStyle = '#2c3646';
  c.fillRect(24, 338, 118, 9);
  c.fillRect(154, 338, 114, 9);
  c.fillStyle = s.u > 1 ? '#ff8a3d' : '#5fd16b';
  c.fillRect(24, 338, 118 * s.t, 9);
  c.fillStyle = '#ff5a4e';
  c.fillRect(154, 338, 114 * s.b, 9);
  c.fillStyle = '#fff';
  c.fillRect(24 + 118 * s.lim - 1, 334, 2, 17);
  c.fillStyle = '#2c3646';
  c.fillRect(24, 357, 244, 8);
  c.fillStyle = '#ffc83d';
  const sx2 = 146 + s.st * 122;
  c.fillRect(Math.min(146, sx2), 357, Math.abs(s.st * 122), 8);
  c.fillStyle = '#d6dbe3';
  c.fillRect(145, 354, 2, 14);
  c.fillStyle = '#8a93a3';
  c.fillText('Derrapagem', 24, 383);
  c.fillStyle = '#2c3646';
  c.fillRect(100, 375, 168, 8);
  const bb = Math.min(1, Math.abs(s.beta) / 1.3);
  c.fillStyle = bb > 0.7 ? '#ff5a4e' : bb > 0.2 ? '#7ec8ff' : '#5fd16b';
  c.fillRect(184 - (s.beta < 0 ? bb * 84 : 0), 375, bb * 84, 8);
  c.fillStyle = '#d6dbe3';
  c.fillRect(183, 372, 2, 14);
  const warnMsg = on
    ? danger ? (ts.rear ? 'Traseira passando do ponto — alivie já' : 'Dianteira saturando — menos direção')
      : ts.warn ? (ts.rear ? 'Traseira chegando ao limite — alivie' : 'Dianteira chegando ao limite — menos direção/freio')
      : null
    : null;
  const msg = f.paused ? 'Pausado — analise a telemetria'
    : warnMsg ?? (s.cut ? 'Corte de giro — suba marcha (.) ou alivie' : null) ?? MODE_MSG[s.mode]
      ?? (s.lockF ? 'Dianteira travada — alivie o freio'
        : s.wspin ? 'Patinando — passou do limite de tração'
        : s.off ? 'Fora do pátio'
        : pr.slip ? 'Linha acima da aderência — freie'
        : ', reduz · . sobe · M automático');
  c.fillStyle = warnMsg ? 'rgb(' + haloRgb(Math.max(0.2, ts.p)).join(',') + ')'
    : s.cut ? '#ff8a7e'
    : s.mode === 'spin' || s.mode === 'rear' ? '#ff8a7e'
    : s.mode === 'drift' ? '#7ec8ff'
    : s.mode || s.wspin || s.lockF ? '#ffd770'
    : '#d6dbe3';
  c.fillText(msg, 24, 400);
  // Minimap of the lot.
  const L = f.lot.lot, m = 130 / WORLD_W;
  c.fillStyle = 'rgba(29,36,48,0.8)';
  c.fillRect(498, 8, 134, 104);
  c.save();
  c.translate(500, 10);
  c.fillStyle = '#4b4f55';
  c.fillRect(L.x0 * m, L.y0 * m, (L.x1 - L.x0) * m, (L.y1 - L.y0) * m);
  c.fillStyle = '#ff7a1a';
  for (const q of f.lot.cones) c.fillRect(q[0] * m - 1, q[1] * m - 1, 2, 2);
  c.fillStyle = '#e8402f';
  c.beginPath();
  c.arc(s.x * PX * m, s.y * PX * m, 3.5, 0, 7);
  c.fill();
  c.restore();
}
