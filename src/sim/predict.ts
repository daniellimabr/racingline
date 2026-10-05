// Projected racing line (v24 predict(), lines 207-209): where the car goes if speed and steering
// are held, capped by grip. Points are in meters (v24 returned pixels: multiply by lot.scale).
import { aero, dLim, G, shape } from './physics.ts';
import type { SimParams } from './params.ts';
import type { CarState } from './state.ts';

const MIN_SPEED = 4; // m/s, the line never shrinks below this speed
const POINTS = 56;
/** Largest heading change drawn, rad, shrinking with speed (v24 capOf). */
const capOf = (kmh: number): number => (Math.max(40, Math.min(180, 210 - 1.33 * kmh)) * Math.PI) / 180;

export interface Prediction {
  pts: [number, number][]; // POINTS + 1 points from the car, meters
  slip: boolean; // the steering asks for more grip than the tires have
}

export function predict(s: CarState, p: SimParams): Prediction {
  const c = p.car, v = Math.max(s.v, MIN_SPEED), mu = c.grip, ae = aero(c, v);
  // Same aero helper as phys(): the grip cap grows with downforce (+ 0 exactly without aero).
  const mug = mu * G + mu * (ae.front + ae.rear);
  let k = Math.tan(shape(c, s.st) * dLim(c, v)) / c.wheelbase, slip = false;
  if (v * v * Math.abs(k) > mug) {
    k = (Math.sign(k) * mug) / (v * v);
    slip = true;
  }
  const cap = capOf(s.v * 3.6), len = 10 + v * 1.3, ds = len / POINTS;
  let x = s.x, y = s.y, h = s.h + s.beta, turned = 0;
  const pts: [number, number][] = [[x, y]];
  for (let i = 0; i < POINTS; i++) {
    let dh = k * ds;
    if (turned + Math.abs(dh) > cap) dh = Math.sign(dh) * Math.max(0, cap - turned);
    turned += Math.abs(dh);
    h += dh;
    x += Math.cos(h) * ds;
    y += Math.sin(h) * ds;
    pts.push([x, y]);
  }
  return { pts, slip };
}
