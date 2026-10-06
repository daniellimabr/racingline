// S005-T13 m3 (Front End): the projected racing line turned by the key position, not by the real road-wheel angle,
// so while the catch hold kept the wheels straight with the key at full lock the line still drew a full-lock curve.
// The line now curves by the car's road-wheel angle (s.delta), the angle the physics really steers with.
import { describe, expect, it } from 'vitest';
import { createState, step, type SimState } from '../../src/core/sim.ts';
import type { InputFrame } from '../../src/core/input-frame.ts';
import { carStep, createCar, predict, type CarState, type SimParams } from '../../src/sim/index.ts';
import { idle, KMH, open, s15 } from './gt3-helpers.ts';

type S = SimState<CarState>;
const DEG = 180 / Math.PI;
const tick = (s: S, p: SimParams, k: Partial<InputFrame>): S => step(s, { ...idle, ...k }, p, carStep);

/** Total heading change along the predicted line, deg. */
function turn(s: CarState, p: SimParams): number {
  const pts = predict(s, p).pts;
  const h = (i: number): number => Math.atan2(pts[i + 1]![1] - pts[i]![1], pts[i + 1]![0] - pts[i]![0]);
  let t = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    let d = h(i) - h(i - 1);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    t += d;
  }
  return t * DEG;
}

function at(kmh: number): { s: S; p: SimParams } {
  const p = open(s15()), c = p.car, v = kmh * KMH;
  const rpm = (g: number): number => ((v / c.wheelRadius) * c.gears[g]! * c.finalDrive * 60) / (2 * Math.PI);
  let g = 0;
  while (g < c.gears.length - 1 && rpm(g) > c.autoUpRpm) g++;
  const s0 = createState(1, createCar(p));
  return { s: { ...s0, car: { ...s0.car, vx: v, v, gear: g, rpm: rpm(g), rateR: v / c.wheelRadius, rateF: v / c.wheelRadius } }, p };
}

describe('the projected line follows the real road-wheel angle (S005-T13 m3)', () => {
  it('while the catch hold keeps the wheels straight with the key at full lock, the line is straight', () => {
    let { s, p } = at(90);
    while (Math.abs(s.car.beta) < 12 / DEG) s = tick(s, p, { right: 1, throttle: 1 });
    let found: CarState | undefined;
    for (let i = 0; i < 6 * 60 && !found; i++) {
      s = tick(s, p, { left: 1, throttle: 1 });
      if (s.car.hold && s.car.st === -1 && Math.abs(s.car.delta) < 0.01 / DEG) found = s.car; // S005-T14: 0.2 -> 0.01 deg (0.2 deg bends a 42 m line by 3 deg)
    }
    expect(found, 'a tick with the key at full lock and the wheels straight').toBeDefined();
    expect(Math.abs(turn(found!, p)), 'deg turned along the line').toBeLessThan(0.5);
  });

  it('in a plain corner the line turns the same way and by about as much as before', () => {
    let { s, p } = at(60);
    for (let i = 0; i < 20; i++) s = tick(s, p, { right: 1, throttle: s.car.v < 60 * KMH ? 1 : 0 });
    const t = turn(s.car, p);
    expect(t, 'turns right').toBeGreaterThan(5);
    expect(Math.sign(s.car.delta)).toBe(1);
  });
});
