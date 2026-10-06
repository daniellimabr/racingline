// Scripted key-input scenarios for the two S003 spins (T2 measurements, T3 tests). Open lot, both cars.
// 1. Braking while turning: brake held from a speed, right key for the first `tap` s, then the brake kept
//    held to the stop, or released as soon as the car slides (body slip above DRIFT_BETA).
// 2. Lifting off: full right lock and an on/off throttle holding speed for 3 s, then the throttle lifted
//    and/or the steering released.
import { createState, step, type SimState } from '../../src/core/sim.ts';
import type { InputFrame } from '../../src/core/input-frame.ts';
import { carStep, createCar, DRIFT_BETA, type CarParams, type CarState, type SimParams } from '../../src/sim/index.ts';
import { idle, KMH, open } from './gt3-helpers.ts';

const HZ = 60;
const DEG = 180 / Math.PI;
const SIDEWAYS = 0.5; // rad, body slip above which the car counts as sliding sideways

type S = SimState<CarState>;

export interface Outcome {
  spun: boolean; // the car reached spin mode
  yaw: number; // deg, total rotation
  slide: number; // s with body slip above DRIFT_BETA
  sideDecel: number; // m/s2, mean speed loss while sliding sideways (0 if never)
}

function upTo(p: SimParams, kmh: number): S {
  let s = createState(1, createCar(p));
  for (let i = 0; s.car.v < kmh * KMH; i++) {
    if (i > 90 * HZ) throw new Error(`${p.car.id} never reached ${kmh} km/h`);
    s = step(s, { ...idle, throttle: 1 }, p, carStep);
  }
  return s;
}

/** Steps until the car is nearly stopped or `maxS` seconds pass. */
function watch(p: SimParams, s0: S, keys: (tick: number, car: CarState) => InputFrame, maxS: number): Outcome {
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
export function brakeTurn(car: CarParams, kmh: number, holdBrake: boolean, tap = 0.2): Outcome {
  const p = open(car);
  let released = false;
  return watch(p, upTo(p, kmh), (k, c) => {
    if (!holdBrake && Math.abs(c.beta) > DRIFT_BETA) released = true;
    return { ...idle, brake: released ? 0 : 1, right: k < tap * HZ ? 1 : 0 };
  }, 40);
}

/** Full lock and a speed-holding on/off throttle for 3 s, then the throttle lifted and/or the steering released. */
export function liftOff(car: CarParams, kmh: number, lift: boolean, releaseSteer: boolean): Outcome {
  const p = open(car), V = kmh * KMH;
  let s = upTo(p, kmh);
  const corner = (c: CarState): InputFrame => ({ ...idle, throttle: c.v < V ? 1 : 0, right: 1 });
  for (let k = 0; k < 3 * HZ; k++) s = step(s, corner(s.car), p, carStep);
  return watch(p, s, (_k, c) => {
    const keys = corner(c);
    return { ...keys, throttle: lift ? 0 : keys.throttle, right: releaseSteer ? 0 : 1 };
  }, 8);
}
