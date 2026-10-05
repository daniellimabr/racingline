// 12 s telemetry chart (v24 drawTel(), lines 284-292): throttle, traction limit, rpm, slip, halo, drift bands.
import { TEL_SECONDS, type TelSample, type View } from './view.ts';

export const TEL_W = 640;
export const TEL_H = 190;

/** rpmScale: top of the rpm axis for the active car (carHud(car).rpmScale). */
export function drawTelemetry(t2: CanvasRenderingContext2D, view: View, now: number, dark: boolean, rpmScale: number): void {
  const W = TEL_W, H = TEL_H, pl = 34, pr = 8, pt = 8, pb = 22, iw = W - pl - pr, ih = H - pt - pb;
  t2.clearRect(0, 0, W, H);
  const grid = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', txt = dark ? '#9aa3b2' : '#6b7280';
  const t0 = now - TEL_SECONDS, X = (t: number) => pl + ((t - t0) / TEL_SECONDS) * iw, Y = (f: number) => pt + ih * (1 - f);
  const tel = view.tel;
  t2.fillStyle = 'rgba(58,143,217,0.16)';
  for (let i = 1; i < tel.length; i++) {
    if (!tel[i]!.dr) continue;
    const a = X(tel[i - 1]!.tt), b = X(tel[i]!.tt);
    t2.fillRect(a, pt, b - a + 0.5, ih);
  }
  t2.strokeStyle = grid;
  t2.lineWidth = 1;
  t2.font = '11px sans-serif';
  t2.fillStyle = txt;
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const y = Y(f);
    t2.beginPath();
    t2.moveTo(pl, y);
    t2.lineTo(pl + iw, y);
    t2.stroke();
    t2.fillText(Math.round(f * 100) + '%', 2, y + 4);
  }
  for (let s = 0; s <= TEL_SECONDS; s += 3) t2.fillText(s - TEL_SECONDS + 's', X(t0 + s) - 8, H - 6);
  const line = (fn: (d: TelSample) => number, col: string, w: number, dash: number[] = []) => {
    t2.strokeStyle = col;
    t2.lineWidth = w;
    t2.setLineDash(dash);
    t2.beginPath();
    tel.forEach((d, i) => {
      const x = X(d.tt), y = Y(Math.max(0, Math.min(1, fn(d))));
      if (i) t2.lineTo(x, y);
      else t2.moveTo(x, y);
    });
    t2.stroke();
    t2.setLineDash([]);
  };
  line((d) => d.lim, '#8a93a3', 1.5, [5, 4]);
  line((d) => d.rpm / rpmScale, '#e8902a', 1.5);
  line((d) => d.p, '#c45ad9', 2);
  line((d) => d.beta / (Math.PI / 2), '#3a8fd9', 2);
  line((d) => d.thr, '#5fd16b', 2.5);
}
