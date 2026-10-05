// S003-AC-01 (S003-T2): records how both cars spin today, before Daniel picks a fix. Characterization only:
// when the T3 fix lands these numbers change on purpose and the T3 tests (brake-turn, lift-off) take over.
// Scripted key input on an open lot, as a player would press keys.
//
// 1. Braking while turning: brake held from 100 or 150 km/h, right key for the first 0.2 s, then the brake is
//    kept held, or released as soon as the car slides (body slip above 0.25 rad).
//    Cause: weight moves forward under braking, the rear brake share then asks for more than the rear tyres
//    can give, the rear brake is clipped at 98% of the rear grip and leaves the rear only 20% for cornering,
//    so any yaw grows into a spin; with the brake held the rear stays saturated and the car barely slows
//    sideways (the brake pushes along the car's length, not against the slide).
// 2. Lifting off at the limit: full right lock with an on/off throttle holding speed for 3 s, then all keys
//    released. Cause: both cars are balanced exactly neutral, so the small forward weight shift after a
//    lift (drag and engine braking) is enough to make the rear let go.
// Numbers and options: docs/sprints/SPRINT-003/T2-spin-options.md (outside the repo).
import { describe, expect, it } from 'vitest';
import { createState, step, type SimState } from '../../src/core/sim.ts';
import { carStep, createCar, DRIFT_BETA, type CarParams, type CarState, type SimParams } from '../../src/sim/index.ts';
import { gt3, idle, KMH, open, s15 } from './gt3-helpers.ts';

const HZ = 60;
const DEG = 180 / Math.PI;
const SIDEWAYS = 0.5; // rad, body slip above which the car counts as sliding sideways

type S = SimState<CarState>;

function upTo(p: SimParams, kmh: number): S {
  let s = createState(1, createCar(p));
  for (let i = 0; s.car.v < kmh * KMH; i++) {
    if (i > 90 * HZ) throw new Error(`${p.car.id} never reached ${kmh} km/h`);
    s = step(s, { ...idle, throttle: 1 }, p, carStep);
  }
  return s;
}

interface Outcome {
  spun: boolean; // the car reached spin mode
  yaw: number; // deg, total rotation
  slide: number; // s with body slip above DRIFT_BETA
  sideDecel: number; // m/s2, mean speed loss while sliding sideways (0 if never)
}

/** Steps until the car is nearly stopped or `maxS` seconds pass. */
function watch(p: SimParams, s0: S, keys: (tick: number, car: CarState) => typeof idle, maxS: number): Outcome {
  let s = s0, spun = false, yaw = 0, slide = 0, loss = 0, n = 0;
  for (let k = 0; k < maxS * HZ && s.car.v >= 1; k++) {
    const before = s.car;
    s = step(s, keys(k, before), p, carStep);
    const c = s.car;
    spun ||= c.mode === 'spin';
    yaw += (Math.abs(c.r) / HZ) * DEG;
    if (Math.abs(c.beta) > DRIFT_BETA) slide += 1 / HZ;
    if (Math.abs(c.beta) > SIDEWAYS && c.v > 3) { loss += (before.v - c.v) * HZ; n++; }
  }
  return { spun, yaw, slide, sideDecel: n ? loss / n : 0 };
}

/** Brake from `kmh` with the right key for the first `tap` s; brake held throughout, or released once sliding. */
function brakeTurn(car: CarParams, kmh: number, holdBrake: boolean, tap = 0.2): Outcome {
  const p = open(car);
  let released = false;
  return watch(p, upTo(p, kmh), (k, c) => {
    if (!holdBrake && Math.abs(c.beta) > DRIFT_BETA) released = true;
    return { ...idle, brake: released ? 0 : 1, right: k < tap * HZ ? 1 : 0 };
  }, 40);
}

/** Full lock and a speed-holding on/off throttle for 3 s, then the throttle lifted and/or the steering released. */
function liftOff(car: CarParams, kmh: number, lift: boolean, releaseSteer: boolean): Outcome {
  const p = open(car), V = kmh * KMH;
  let s = upTo(p, kmh);
  const corner = (c: CarState) => ({ ...idle, throttle: c.v < V ? 1 : 0, right: 1 });
  for (let k = 0; k < 3 * HZ; k++) s = step(s, corner(s.car), p, carStep);
  return watch(p, s, (_k, c) => {
    const keys = corner(c);
    return { ...keys, throttle: lift ? 0 : keys.throttle, right: releaseSteer ? 0 : 1 };
  }, 8);
}

/** `x` within `tol` (share) of `target`. */
function near(x: number, target: number, tol = 0.1): void {
  expect(x).toBeGreaterThan(target * (1 - tol));
  expect(x).toBeLessThan(target * (1 + tol));
}

describe('spin baseline before the S003 fix (S003-AC-01)', () => {
  describe('braking with 0.2 s of steering', () => {
    it('straight braking does not spin either car (control)', () => {
      for (const car of [s15(), gt3()]) for (const kmh of [100, 150]) expect(brakeTurn(car, kmh, true, 0).spun).toBe(false);
    });

    it('S15 spins at 100 and 150 km/h; the held brake makes the slide about 3.5-4x longer and slows sideways ~2 m/s2', () => {
      const h100 = brakeTurn(s15(), 100, true), r100 = brakeTurn(s15(), 100, false);
      const h150 = brakeTurn(s15(), 150, true), r150 = brakeTurn(s15(), 150, false);
      for (const o of [h100, r100, h150, r150]) expect(o.spun).toBe(true);
      near(h150.yaw, 3847); // deg, about 10.7 turns (matches the S002-T11 blind test)
      near(h150.slide, 18.45); // s
      near(r150.slide, 4.35);
      near(h150.sideDecel, 1.9, 0.15); // m/s2 held, against 7.5 released
      near(r150.sideDecel, 7.5, 0.15);
      near(h100.slide, 7.57);
      near(r100.slide, 2.18);
      expect(h150.slide / r150.slide).toBeGreaterThan(3.5);
      expect(h100.slide / r100.slide).toBeGreaterThan(3);
    });

    it('GT3 spins at 150 km/h (and at 100 km/h with 0.5 s of steering); the held brake makes the slide about 3x longer', () => {
      const h150 = brakeTurn(gt3(), 150, true), r150 = brakeTurn(gt3(), 150, false);
      expect(h150.spun).toBe(true);
      expect(r150.spun).toBe(true);
      near(h150.yaw, 606);
      near(h150.slide, 5.48);
      near(r150.slide, 1.7);
      near(h150.sideDecel, 3.2, 0.15);
      expect(h150.slide / r150.slide).toBeGreaterThan(2.8);
      expect(brakeTurn(gt3(), 100, true).spun).toBe(false);
      const h100 = brakeTurn(gt3(), 100, true, 0.5);
      expect(h100.spun).toBe(true);
      near(h100.slide, 6.75);
    });
  });

  describe('lifting off at full lock, steering released', () => {
    it.each([
      ['S15', s15, 120, 236],
      ['S15', s15, 200, 353],
      ['GT3', gt3, 120, 217],
    ] as const)('%s at %i km/h spins (about %i deg of rotation)', (_n, car, kmh, yaw) => {
      const o = liftOff(car(), kmh, true, true);
      expect(o.spun).toBe(true);
      near(o.yaw, yaw);
    });

    it('GT3 at 200 km/h keeps its line, and releasing the steering without lifting spins neither car (controls)', () => {
      expect(liftOff(gt3(), 200, true, true).spun).toBe(false);
      for (const [car, kmh] of [[s15(), 120], [s15(), 200], [gt3(), 120]] as const) expect(liftOff(car, kmh, false, true).spun).toBe(false);
    });
  });
});
