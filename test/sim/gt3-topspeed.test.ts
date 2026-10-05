// S002-AC-06: the GT3 at full throttle (automatic gearbox) reaches a drag-limited plateau below its
// 6th-gear limit, at the ADR-004 top speed of 284 km/h within +-3 km/h.
import { expect, it } from 'vitest';
import { createState, step } from '../../src/core/sim.ts';
import { carStep, createCar, ratio } from '../../src/sim/index.ts';
import { gt3, idle, KMH, open } from './gt3-helpers.ts';

it('plateaus at 284 +- 3 km/h in 6th, below the rev cut (S002-AC-06)', () => {
  const p = open(gt3());
  let s = createState(1, createCar(p));
  const full = { ...idle, throttle: 1 };
  const speeds: number[] = [];
  for (let i = 0; i < 60 * 120; i++) {
    s = step(s, full, p, carStep);
    if (i % 60 === 0) speeds.push(s.car.v);
  }
  const v = s.car.v;
  const gearLimit = (p.car.cutRpm / 60) * 2 * Math.PI / ratio(p.car, 5) * p.car.wheelRadius;
  expect(s.car.gear).toBe(5);
  expect(Math.abs(v - speeds[speeds.length - 11]!)).toBeLessThan(0.1 * KMH); // flat over the last 10 s
  expect(v).toBeLessThan(gearLimit);
  expect(s.car.cut).toBe(false);
  expect(Math.abs(v / KMH - 284)).toBeLessThanOrEqual(3);
});
