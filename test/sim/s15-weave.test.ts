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
// S004-T2: with the speed-dependent steering, full lock at 200 km/h takes about 2.4 s to reach instead of
// 0.8 s, so the S15 eases into the limit and no longer weaves (S003: reverses to -1.2 deg/s, swing
// 13.3 deg/s, period 1.4 s; now peaks at 13.9 deg/s after about 1 s, never reverses, swing 3.3 deg/s from
// 2 to 4 s). The weave needed a quick steering step at speed, which the steering no longer gives.
// S004-T2 Main Dev call (S15 cube curve, full lock at 200 km/h in 1.65 s): swing 6.9 deg/s from 2 to 4 s, still settles.
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

  // Daniel 2026-10-05 chose to keep the neutral S15 (SPRINT-PLAN-002 T10); since S004-T2 the slow steering at
  // 200 km/h no longer excites the weave. Characterization: settles, swing 2-4 s about 3.3 deg/s.
  it('S15 settles with the speed-dependent steering (S004-T2; it weaved before)', () => {
    const r = yawAtFullLock(s15()), from2s = r.slice(2 * TICKS_PER_S);
    expectSettled(r);
    const swing = Math.max(...from2s) - Math.min(...from2s);
    expect(swing).toBeGreaterThan(4);
    expect(swing).toBeLessThan(8);
    expect(period(r)).toBeGreaterThan(1.2);
    expect(period(r)).toBeLessThan(1.6);
  });
});
