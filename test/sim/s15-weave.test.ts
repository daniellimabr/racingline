// S002-T10: yaw-rate weave at about 200 km/h with full steering lock and throttle held (blind test,
// 2026-10-05: S15 yaw rate swung between -23 and +3.8 deg/s over 1.8 s, GT3 steady).
// Scripted input: full throttle from rest to 200 km/h in the open lot, then full lock plus throttle for 4 s.
// Settled means: after 1 s at full lock the yaw rate keeps the steering's sign, and between 2 and 4 s
// it swings less than 8 deg/s from peak to peak.
//
// Root cause (no wobble involved): the S15 is exactly neutral at its grip limit (same tyre curve and grip
// on both axles, static front load 0.55 = CG lever share 0.55), so once the front saturates the rear sits
// at its own peak and nothing damps the yaw; the damping that is left falls with speed. The GT3 must
// settle; the S15 weave is characterized so a change to it shows up here.
// S003-T3 (Daniel option 2B, 2026-10-05): the 5% rear cornering margin made the weave smaller and quicker
// (before: reverses to -3.8 deg/s, swing 17.8 deg/s, period 1.8 s).
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

/** Seconds between the first two local maxima of the yaw rate (one weave period). */
function period(r: number[]): number {
  const peaks = r.flatMap((x, i) => (i > 0 && i < r.length - 1 && x > r[i - 1]! && x >= r[i + 1]! ? [i] : []));
  if (peaks.length < 2) throw new Error('fewer than two yaw-rate peaks');
  return (peaks[1]! - peaks[0]!) / TICKS_PER_S;
}

describe('yaw rate settles at 200 km/h with full lock (S002-T10)', () => {
  it('GT3 (control)', () => expectSettled(yawAtFullLock(gt3())));

  // Daniel 2026-10-05 chose to keep this: neutral S15 at the limit, see SPRINT-PLAN-002 T10.
  it('S15 keeps its weave (characterization: reverses to -1.2 deg/s, swing 13.3 deg/s, period 1.4 s)', () => {
    const r = yawAtFullLock(s15()), from2s = r.slice(2 * TICKS_PER_S);
    const swing = Math.max(...from2s) - Math.min(...from2s);
    expect(swing).toBeGreaterThan(10);
    expect(swing).toBeLessThan(17);
    expect(Math.min(...r.slice(1 * TICKS_PER_S))).toBeLessThan(0); // the yaw rate briefly reverses
    expect(period(r)).toBeGreaterThan(1.2);
    expect(period(r)).toBeLessThan(1.6);
  });
});
