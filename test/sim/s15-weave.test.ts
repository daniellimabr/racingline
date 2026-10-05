// S002-T10: yaw-rate weave at about 200 km/h with full steering lock and throttle held (blind test,
// 2026-10-05: S15 yaw rate swung between -23 and +3.8 deg/s over 1.8 s, GT3 steady).
// Scripted input: full throttle from rest to 200 km/h in the open lot, then full lock plus throttle for 4 s.
// Settled means: after 1 s at full lock the yaw rate keeps the steering's sign, and between 2 and 4 s
// it swings less than 8 deg/s from peak to peak.
//
// Root cause (no wobble involved): the S15 is exactly neutral at its grip limit (same tyre curve and grip
// on both axles, static front load 0.55 = CG lever share 0.55), so once the front saturates the rear sits
// at its own peak and nothing damps the yaw; the damping that is left falls with speed. The S15 case is
// marked as an expected failure until Daniel picks a fix (it changes how the car feels); when a fix
// lands this test starts failing, and `.fails` must be removed.
import { describe, expect, it } from 'vitest';
import { createState, step } from '../../src/core/sim.ts';
import { carStep, createCar, type CarParams } from '../../src/sim/index.ts';
import { gt3, idle, KMH, open, s15 } from './gt3-helpers.ts';

const DEG = 180 / Math.PI;
const TICKS_PER_S = 60;

/** Yaw rate (deg/s) for every tick of 4 s at full right lock with throttle, starting at 200 km/h. */
function yawAtFullLock(car: CarParams): number[] {
  const p = open(car);
  let s = createState(1, createCar(p));
  for (let i = 0; s.car.v < 200 * KMH; i++) {
    if (i > 60 * TICKS_PER_S) throw new Error(`${car.id} never reached 200 km/h`);
    s = step(s, { ...idle, throttle: 1 }, p, carStep);
  }
  const r: number[] = [];
  for (let i = 0; i < 4 * TICKS_PER_S; i++) {
    s = step(s, { ...idle, throttle: 1, right: 1 }, p, carStep);
    r.push(s.car.r * DEG);
  }
  return r;
}

function expectSettled(r: number[]): void {
  const after1s = r.slice(1 * TICKS_PER_S), from2s = r.slice(2 * TICKS_PER_S);
  expect(Math.min(...after1s), 'yaw rate reverses direction').toBeGreaterThan(0);
  expect(Math.max(...from2s) - Math.min(...from2s), 'yaw rate swing 2-4 s, deg/s').toBeLessThan(8);
}

describe('yaw rate settles at 200 km/h with full lock (S002-T10)', () => {
  it('GT3 (control)', () => expectSettled(yawAtFullLock(gt3())));

  // Today: peak 22.8 deg/s, reverses to -3.8 deg/s, swing 17.8 deg/s between 2 and 4 s.
  it.fails('S15 (known weave, waiting for Daniel to choose a fix)', () => expectSettled(yawAtFullLock(s15())));
});
