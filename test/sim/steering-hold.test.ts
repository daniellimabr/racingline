// S004-AC-01/02, rewritten for S005-AC-04 (Daniel 2026-10-06): a held key moves the steering at the Sprint 004
// speed-dependent rate and nothing pulls against it; the opposite key brings it back through centre and across.
// Releasing every key now lets the wheel return slowly to centre (S005-T2, steering-return.test.ts), so "holding"
// here means "key held". Scripted key input on the open lot, both cars; the keyboard still reports held 0/1.
import { describe, expect, it } from 'vitest';
import { createState, step, type SimState } from '../../src/core/sim.ts';
import type { InputFrame } from '../../src/core/input-frame.ts';
import { carStep, createCar, predict, steerLockTime, type CarState, type SimParams } from '../../src/sim/index.ts';
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

describe('a held key is never fought by the return (S005-AC-04)', () => {
  it.each(cars)('%s: while a key is held each tick adds exactly the Sprint 004 travel, even deep in a corner', (_n, car) => {
    for (const kmh of [40, 120, 200]) {
      const p = open(car());
      let s = rolling(p, kmh);
      for (let k = 0; k < 20 * HZ && s.car.st < 1; k++) {
        const before = s.car, want = Math.min(1, before.st + 1 / HZ / steerLockTime(p.car, before.v));
        s = step(s, right, p, carStep);
        expect(s.car.st, `${kmh} km/h tick ${k}`).toBe(want);
      }
      expect(s.car.st).toBe(1);
      // Held at full lock: the key keeps it there however hard the tyres pull back.
      for (const st of drive(p, s, right, () => false, 2).st) expect(st).toBe(1);
    }
  });

  it.each(cars)('%s: both keys together hold the steering, at speed too', (_n, car) => {
    for (const kmh of [40, 120]) {
      const p = open(car());
      const { s } = drive(p, rolling(p, kmh), right, (c) => c.st >= 0.4, 5);
      for (const st of drive(p, s, { ...idle, left: 1, right: 1 }, () => false, 1).st) expect(st).toBe(s.car.st);
    }
  });

  it.each(cars)('%s: parked, a released wheel stays where it was put', (_n, car) => {
    const p = open(car());
    const { s } = drive(p, rolling(p, 0), left, (c) => c.st <= -1, 5);
    expect(s.car.st).toBe(-1);
    for (const st of drive(p, s, idle, () => false, 2).st) expect(st).toBe(-1);
  });

  it.each(cars)('%s: released at speed, the wheel only ever moves towards centre', (_n, car) => {
    for (const kmh of [60, 200]) {
      const p = open(car());
      const { s } = drive(p, rolling(p, kmh), left, (c) => c.st <= -0.25, 20);
      let prev = s.car.st;
      for (const st of drive(p, s, idle, () => false, 3).st) {
        expect(st).toBeGreaterThanOrEqual(prev);
        expect(st).toBeLessThanOrEqual(0);
        prev = st;
      }
      expect(prev, `${kmh} km/h: it did return`).toBeGreaterThan(s.car.st);
    }
  });

  // S005-T13 m3: the line now curves by the road-wheel angle (delta) rather than the key position, so the comparison holds
  // the earlier wheel angle instead of the earlier key position.
  it('the racing line assumes the current steering is held, so it follows the wheel as it returns', () => {
    const p = open(s15());
    const { s } = drive(p, rolling(p, 40), right, (c) => c.st >= 0.3, 5);
    const bend = (c: CarState): number => {
      const pts = predict(c, p).pts, [x0, y0] = pts[0]!, [x1, y1] = pts[1]!, [x2, y2] = pts[2]!;
      return Math.atan2(y2 - y1, x2 - x1) - Math.atan2(y1 - y0, x1 - x0);
    };
    let after = s;
    for (let i = 0; i < HZ; i++) after = step(after, idle, p, carStep);
    expect(after.car.st).toBeLessThan(s.car.st);
    expect(bend(after.car)).toBeGreaterThan(0);
    expect(bend(after.car)).toBeLessThan(bend({ ...after.car, delta: s.car.delta }));
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
});
