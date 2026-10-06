// S004-AC-03 (Daniel 2026-10-06): the steering moves very quickly at low speed and slowly as speed rises,
// barely at 300 km/h. The curve is car data (steerLockTime, steerLockTimeTop, steerLockTopSpeed,
// steerLockCurve): time from centre to full lock = low + (top - low) * (v / topSpeed) ^ curve.
// Measured with the key held and the speed pinned by the test (the car is put back on a straight line
// at the same speed every tick), so only the steering travel is timed.
import { describe, expect, it } from 'vitest';
import { createState, step, type SimState } from '../../src/core/sim.ts';
import { DataError } from '../../src/data/check.ts';
import { carStep, createCar, loadCarParams, steerLockTime, type CarParams, type CarState } from '../../src/sim/index.ts';
import s15Json from '../../src/cars/s15-drift.json';
import { gt3, idle, KMH, open, s15 } from './gt3-helpers.ts';

const HZ = 60;
const SPEEDS = [20, 60, 120, 200, 300]; // km/h
const SLOWER_AT_300 = 10; // at 300 km/h full lock takes at least this many times longer than at 20 km/h

/** Seconds from centre to full right lock at a pinned speed. */
function lockTime(car: CarParams, kmh: number): number {
  const p = open(car), V = kmh * KMH;
  const pin = (s: SimState<CarState>): SimState<CarState> => ({ ...s, car: { ...s.car, vx: V, vy: 0, r: 0, beta: 0, v: V, h: 0 } });
  let s = pin(createState(1, { ...createCar(p), gear: 5 }));
  let k = 0;
  for (; s.car.st < 1; k++) {
    if (k > 60 * HZ) throw new Error(`${car.id} never reached full lock at ${kmh} km/h`);
    s = pin(step(s, { ...idle, right: 1 }, p, carStep));
  }
  return k / HZ;
}

describe('steering rate depends on speed (S004-AC-03)', () => {
  it.each([['S15', s15], ['GT3', gt3]] as const)('%s: full lock time grows with speed, quick at 20 km/h, slow at 300', (_n, car) => {
    const c = car(), t = SPEEDS.map((kmh) => lockTime(c, kmh));
    for (let i = 1; i < t.length; i++) expect(t[i]!, `${SPEEDS[i]} km/h vs ${SPEEDS[i - 1]}`).toBeGreaterThan(t[i - 1]!);
    expect(t[0]!, 'full lock at 20 km/h, s').toBeLessThanOrEqual(0.25);
    expect(t[4]! / t[0]!, '300 km/h vs 20 km/h').toBeGreaterThanOrEqual(SLOWER_AT_300);
    // The measured travel matches the car-data curve to within one tick.
    SPEEDS.forEach((kmh, i) => expect(Math.abs(t[i]! - steerLockTime(c, kmh * KMH))).toBeLessThanOrEqual(1 / HZ));
  });

  it('the curve is read from the car file', () => {
    const base = s15(), slow = loadCarParams({ ...s15Json, steerLockTimeTop: 2 * base.steerLockTimeTop }, 'test.json');
    expect(lockTime(slow, 300)).toBeGreaterThan(1.5 * lockTime(base, 300));
    const quick = loadCarParams({ ...s15Json, steerLockTime: 0.1 }, 'test.json');
    expect(lockTime(quick, 0)).toBeCloseTo(0.1, 1);
    expect(steerLockTime(base, base.steerLockTopSpeed)).toBe(base.steerLockTimeTop);
    expect(steerLockTime(base, 0)).toBe(base.steerLockTime);
  });

  it('rejects a curve that gets quicker with speed', () => {
    expect(() => loadCarParams({ ...s15Json, steerLockTime: 3, steerLockTimeTop: 1 }, 'test.json')).toThrow(DataError);
    expect(() => loadCarParams({ ...s15Json, steerLockTime: 3, steerLockTimeTop: 1 }, 'test.json')).toThrow(/steerLockTimeTop/);
  });
});
