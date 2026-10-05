// S002-AC-09: the S15 pulls harder in 2nd gear at low rpm. Change: 2nd ratio 1.902 -> 2.1 (S002-T5),
// so wheel force in 2nd is at least 10 % above Sprint 001's at every rpm, every other gear and the
// torque curve stay as they were, and 2nd gear from 40 to 80 km/h is quicker. Daniel feel-checks it.
import { describe, expect, it } from 'vitest';
import { createState, step } from '../../src/core/sim.ts';
import { carStep, createCar, loadCarParams, ratio, type CarParams } from '../../src/sim/index.ts';
import { torqueAt } from '../../src/sim/physics.ts';
import { idle, KMH, open, s15 } from './gt3-helpers.ts';
import s15Json from '../../src/cars/s15-drift.json';

const SPRINT_001_GEAR2 = 1.902;
const now = s15();
const before = loadCarParams({ ...s15Json, gear2: SPRINT_001_GEAR2 }, 's15-sprint-001.json');
const RPM2 = 60 / (2 * Math.PI);

/** Wheel drive force, N, in gear index g at engine rpm (same terms as phys() Afull, times mass). */
const force = (c: CarParams, g: number, rpm: number) => (torqueAt(c, rpm) * ratio(c, g) * c.drivelineEff) / c.wheelRadius;

/** Seconds from 40 to 80 km/h at full throttle with 2nd held (manual), starting at 2500 rpm in 2nd. */
function secs40to80(c: CarParams): number {
  const p = open(c);
  const v0 = (2500 / RPM2 / ratio(c, 1)) * c.wheelRadius;
  let s = createState(1, { ...createCar(p), auto: false, gear: 1, vx: v0, v: v0, rpm: 2500 });
  let t = 0, t40 = 0;
  while (s.car.v < 80 * KMH) {
    s = step(s, { ...idle, throttle: 1 }, p, carStep);
    t += 1 / 60;
    if (!t40 && s.car.v >= 40 * KMH) t40 = t;
    if (t > 30) throw new Error('never reached 80 km/h');
  }
  expect(s.car.gear).toBe(1);
  return t - t40;
}

describe('S15 2nd gear at low rpm (S002-AC-09)', () => {
  it.each([2500, 3000, 3500])('gives at least 10 percent more wheel force at %i rpm', (rpm) => {
    expect(force(now, 1, rpm) / force(before, 1, rpm)).toBeGreaterThanOrEqual(1.1);
  });

  it('leaves every other gear and the torque curve unchanged', () => {
    for (const g of [0, 2, 3, 4, 5]) expect(force(now, g, 3000)).toBe(force(before, g, 3000));
    expect(now.peakTorque).toBe(before.peakTorque);
  });

  it('goes from 40 to 80 km/h in 2nd at least 0.1 s quicker than Sprint 001', () => {
    expect(secs40to80(now)).toBeLessThan(secs40to80(before) - 0.1);
  });
});
