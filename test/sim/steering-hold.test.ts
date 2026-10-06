// S004-AC-01/02 (Daniel 2026-10-06): steering stays where it is put. Releasing the key holds the angle; the
// opposite key brings it back through centre and across to the other side. There is no self-centring.
// Scripted key input on the open lot, both cars; the keyboard still reports held 0/1.
import { describe, expect, it } from 'vitest';
import { createState, step, type SimState } from '../../src/core/sim.ts';
import type { InputFrame } from '../../src/core/input-frame.ts';
import { carStep, createCar, predict, type CarState, type SimParams } from '../../src/sim/index.ts';
import { gt3, idle, KMH, open, s15 } from './gt3-helpers.ts';

const HZ = 60;
type S = SimState<CarState>;
const cars = [['S15', s15], ['GT3', gt3]] as const;

/** Car rolling straight at `kmh` on the open lot. */
function rolling(p: SimParams, kmh: number): S {
  return createState(1, { ...createCar(p), vx: kmh * KMH, v: kmh * KMH, gear: 2 });
}

/** Holds `keys` until `done` or `maxS` seconds; returns the state and the steering after each tick. */
function drive(p: SimParams, s0: S, keys: InputFrame, done: (c: CarState) => boolean, maxS: number): { s: S; st: number[] } {
  let s = s0;
  const st: number[] = [];
  for (let k = 0; k < maxS * HZ && !done(s.car); k++) {
    s = step(s, keys, p, carStep);
    st.push(s.car.st);
  }
  return { s, st };
}

const right = { ...idle, right: 1 }, left = { ...idle, left: 1 };

describe('released steering holds its angle (S004-AC-01)', () => {
  it.each(cars)('%s: half lock to the right, released for 2 s, stays within 0.001', (_n, car) => {
    const p = open(car());
    const { s } = drive(p, rolling(p, 40), right, (c) => c.st >= 0.5, 5);
    expect(s.car.st).toBeGreaterThanOrEqual(0.5);
    const held = drive(p, s, idle, () => false, 2).st;
    expect(held).toHaveLength(2 * HZ);
    for (const st of held) expect(Math.abs(st - s.car.st)).toBeLessThanOrEqual(0.001);
  });

  it.each(cars)('%s: full lock stays at full lock after release, at rest and at speed', (_n, car) => {
    for (const kmh of [0, 120]) {
      const p = open(car());
      const { s } = drive(p, rolling(p, kmh), left, (c) => c.st <= -1, 20);
      expect(s.car.st).toBe(-1);
      for (const st of drive(p, s, idle, () => false, 2).st) expect(st).toBe(-1);
    }
  });

  it('the racing line keeps the same steering after release (the line now assumes what really happens)', () => {
    const p = open(s15());
    const { s } = drive(p, rolling(p, 40), right, (c) => c.st >= 0.3, 5);
    const after = step(s, idle, p, carStep);
    expect(after.car.st).toBe(s.car.st);
    // Same steering and speed in, same bend out: the line drawn before release still holds after it.
    const bend = (c: CarState): number => {
      const pts = predict(c, p).pts, [x0, y0] = pts[0]!, [x1, y1] = pts[1]!, [x2, y2] = pts[2]!;
      return Math.atan2(y2 - y1, x2 - x1) - Math.atan2(y1 - y0, x1 - x0);
    };
    expect(bend(after.car)).toBeCloseTo(bend({ ...after.car, st: s.car.st }), 12);
    expect(bend(after.car)).toBeGreaterThan(0);
  });
});

describe('the opposite key brings the steering back and across (S004-AC-02)', () => {
  it.each(cars)('%s: from full left, holding right passes centre and reaches full right', (_n, car) => {
    for (const kmh of [20, 120]) {
      const p = open(car());
      const { s } = drive(p, rolling(p, kmh), left, (c) => c.st <= -1, 20);
      const { s: end, st } = drive(p, s, right, (c) => c.st >= 1, 20);
      expect(end.car.st).toBe(1);
      expect(st.some((x) => Math.abs(x) < 0.2), 'passes through centre').toBe(true);
      for (let i = 1; i < st.length; i++) expect(st[i]!).toBeGreaterThan(st[i - 1]!); // steady travel, no pause
    }
  });

  it.each(cars)('%s: no self-centring at any speed (a quarter lock held 2 s without keys)', (_n, car) => {
    for (const kmh of [10, 60, 200]) {
      const p = open(car());
      const { s } = drive(p, rolling(p, kmh), left, (c) => c.st <= -0.25, 20);
      for (const st of drive(p, s, idle, () => false, 2).st) expect(st).toBe(s.car.st);
    }
  });

  it('both keys together hold the steering', () => {
    const p = open(s15());
    const { s } = drive(p, rolling(p, 40), right, (c) => c.st >= 0.4, 5);
    for (const st of drive(p, s, { ...idle, left: 1, right: 1 }, () => false, 1).st) expect(st).toBe(s.car.st);
  });
});
