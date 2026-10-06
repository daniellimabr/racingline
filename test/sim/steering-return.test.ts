// S005-AC-01..03 (Daniel 2026-10-06): with no steering key pressed the steering returns to centre slowly, like a
// real wheel pulled back by caster and the tyres' self-aligning torque: stronger with speed and front grip,
// weaker when the front tyres slide past their peak, nothing when parked. The return is driven by the front
// axle's side force and slip (car data steerCentreGain, steerCasterShare, steerTrailFade), never a fixed rate.
// Protocol: the car rolls straight at the speed (automatic-box gear), an ideal hand holds the steering at st0 for
// HOLD_S with the throttle holding speed, then lets go; the throttle keeps holding speed while the wheel returns.
import { describe, expect, it } from 'vitest';
import { createState, step, type SimState } from '../../src/core/sim.ts';
import type { InputFrame } from '../../src/core/input-frame.ts';
import { carStep, createCar, loadCarParams, type CarParams, type CarState, type SimParams } from '../../src/sim/index.ts';
import { DataError } from '../../src/data/check.ts';
import { steer } from '../../src/sim/physics.ts';
import s15Json from '../../src/cars/s15-drift.json';
import { gt3, idle, KMH, open, s15 } from './gt3-helpers.ts';

type S = SimState<CarState>;
const HZ = 60, HOLD_S = 1, CENTRE = 0.02;
// Band Main Dev set from the measured times (docs/sprints/SPRINT-005/mailbox/physics-dev-to-main-dev-centring.md):
// from full lock at 100 km/h on asphalt the wheel is back within 0.02 of centre in this many seconds.
const BAND_100: Record<string, [number, number]> = { 's15-drift': [1.5, 3.5], gt3: [1.5, 3.5] };
const cars = [['S15', s15], ['GT3', gt3]] as const;
const tick = (s: S, p: SimParams, k: Partial<InputFrame>): S => step(s, { ...idle, ...k }, p, carStep);

/** Straight ahead at `kmh` in the gear the automatic box would hold (0 = parked). */
function at(c: CarParams, kmh: number): { s: S; p: SimParams } {
  const p = open(c), v = kmh * KMH;
  const rpm = (g: number): number => ((v / c.wheelRadius) * c.gears[g]! * c.finalDrive * 60) / (2 * Math.PI);
  let g = 0;
  while (g < c.gears.length - 1 && rpm(g) > c.autoUpRpm) g++;
  const s0 = createState(1, createCar(p));
  const car = { ...s0.car, vx: v, v, gear: g, rpm: Math.max(c.idleRpm, rpm(g)), rateR: v / c.wheelRadius, rateF: v / c.wheelRadius };
  return { s: { ...s0, car }, p };
}

/** Holds the wheel at st0, then lets go; returns the steering after each free tick (up to maxS seconds). */
function release(c: CarParams, kmh: number, st0: number, maxS = 20): { st: number[]; t: number; s: S } {
  let { s, p } = at(c, kmh);
  const v = kmh * KMH, thr = (x: S): number => (kmh > 0 && x.car.v < v ? 1 : 0);
  for (let i = 0; i < HOLD_S * HZ; i++) s = tick({ ...s, car: { ...s.car, st: st0 } }, p, { throttle: thr(s) });
  s = { ...s, car: { ...s.car, st: st0 } };
  const st: number[] = [];
  let t = Infinity;
  for (let i = 0; i < maxS * HZ; i++) {
    s = tick(s, p, { throttle: thr(s) });
    st.push(s.car.st);
    if (t === Infinity && Math.abs(s.car.st) <= CENTRE) t = (i + 1) / HZ;
  }
  return { st, t, s };
}

describe('the released wheel returns to centre slowly (S005-AC-01)', () => {
  it.each(cars)('%s: from full lock at 100 km/h, monotonic, in the set band, no overshoot', (_n, car) => {
    const c = car();
    for (const st0 of [1, -1]) {
      const { st, t } = release(c, 100, st0);
      const [lo, hi] = BAND_100[c.id]!;
      expect(t, `${st0} back within 0.02, s`).toBeGreaterThanOrEqual(lo);
      expect(t, `${st0} back within 0.02, s`).toBeLessThanOrEqual(hi);
      expect(t, 'far slower than the Sprint 003 7/s (0.15 s)').toBeGreaterThanOrEqual(1);
      let prev = Math.abs(st0);
      for (const x of st) {
        expect(Math.abs(x)).toBeLessThanOrEqual(prev); // never moves away from centre
        expect(x * st0, 'no overshoot past centre beyond 0.01').toBeGreaterThanOrEqual(-0.01);
        prev = Math.abs(x);
      }
    }
  });
});

describe('the return grows with speed and is nothing when parked (S005-AC-02)', () => {
  it.each(cars)('%s: faster at 200 than 100 than 50 km/h, from full and half lock', (_n, car) => {
    const c = car();
    for (const st0 of [1, 0.5]) {
      const t = [50, 100, 200].map((kmh) => release(c, kmh, st0).t);
      expect(t[1]!, `${st0}: 100 vs 50 km/h`).toBeLessThan(t[0]!);
      expect(t[2]!, `${st0}: 200 vs 100 km/h`).toBeLessThan(t[1]!);
    }
  });

  it.each(cars)('%s: parked and at walking pace the wheel moves less than 0.05 in 2 s', (_n, car) => {
    for (const kmh of [0, 5]) for (const st0 of [1, -0.5]) {
      const { st } = release(car(), kmh, st0, 2);
      expect(Math.abs(st[st.length - 1]! - st0), `${kmh} km/h from ${st0}`).toBeLessThan(0.05);
    }
  });
});

describe('the return is weaker while the front tyres slide (S005-AC-03)', () => {
  /**
   * Same speed, same steering, released: the car is set with a yaw rate that puts the front slip at `k` times the
   * tyre peak (no body slip, so no countersteer lock). Returns the steering travel in the first tick, per second.
   */
  function firstRate(c: CarParams, kmh: number, st0: number, k: number): number {
    const { s, p } = at(c, kmh), V = kmh * KMH, delta = steer(c, { ...s.car, st: st0, beta: 0 }, V);
    const r = (V * Math.tan(delta - k * c.tirePeakSlip * Math.sign(st0))) / c.la;
    const after = tick({ ...s, car: { ...s.car, st: st0, r } }, p, {});
    return (Math.abs(st0) - Math.abs(after.car.st)) * HZ;
  }

  it.each(cars)('%s: a front slipping 2.5x past its peak pulls back far less than one gripping at 0.7x', (_n, car) => {
    const c = car();
    for (const kmh of [50, 100, 200]) for (const st0 of [0.5, -1]) {
      const grip = firstRate(c, kmh, st0, 0.7), slide = firstRate(c, kmh, st0, 2.5);
      expect(grip, `${kmh} km/h ${st0} gripping returns`).toBeGreaterThan(0);
      expect(slide, `${kmh} km/h ${st0} sliding vs gripping`).toBeLessThan(0.6 * grip);
      expect(slide, `${kmh} km/h ${st0} the caster still pulls`).toBeGreaterThan(0);
    }
  });

  it('the S15 front slides at full lock from 50 km/h, and that full-lock release starts slower than half lock', () => {
    const c = s15();
    for (const kmh of [50, 100, 200]) {
      const full = release(c, kmh, 1, 0.1), half = release(c, kmh, 0.5, 0.1);
      expect(Math.abs(release(c, kmh, 1, 1 / HZ).s.car.af), `${kmh} km/h`).toBeGreaterThan(c.tirePeakSlip);
      expect(1 - full.st[5]!, `${kmh} km/h full vs half lock, first 0.1 s`).toBeLessThan(0.5 - half.st[5]!);
    }
  });

  it('less front grip pulls the wheel back more slowly (half the grip)', () => {
    const slick = loadCarParams({ ...s15Json, grip: 0.5 }, 'test.json');
    expect(release(slick, 100, 0.5).t).toBeGreaterThan(release(s15(), 100, 0.5).t);
  });

  it('the return strength is read from the car file, and zero gain keeps the wheel where it is', () => {
    const off = loadCarParams({ ...s15Json, steerCentreGain: 0 }, 'test.json');
    for (const x of release(off, 100, 0.5, 2).st) expect(x).toBe(0.5);
    for (const bad of [{ steerCentreGain: -1 }, { steerCasterShare: 1.5 }, { steerTrailFade: 0.5 }, { steerCentreGain: 'fast' }])
      expect(() => loadCarParams({ ...s15Json, ...bad }, 'test.json'), JSON.stringify(bad)).toThrow(DataError);
    const { steerCentreGain: _drop, ...missing } = s15Json;
    expect(() => loadCarParams(missing, 'test.json')).toThrow(/steerCentreGain/);
    const strong = loadCarParams({ ...s15Json, steerCentreGain: 2 * s15().steerCentreGain }, 'test.json');
    expect(release(strong, 100, 0.5).t).toBeLessThan(release(s15(), 100, 0.5).t);
  });
});
