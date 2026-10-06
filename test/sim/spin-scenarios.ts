// Scripted key-input scenarios for the two S003 spins (T2 measurements, T3 tests). Open lot, both cars.
// 1. Braking while turning: brake held from a speed, right key for the first `tap` s, then the brake kept
//    held to the stop, or released as soon as the car slides (body slip above DRIFT_BETA).
// 2. Lifting off: steering at the grip limit and an on/off throttle holding speed for 3 s, then the throttle
//    lifted and/or the steering released.
// S004-T2: steering now stays where it is put, so "releasing" it means what a player does: the opposite key
// brings it back to centre (at the speed-dependent rate) and is let go there. The lift-off corner was full
// lock (S003); full lock now takes 1-2.4 s to reach and to unwind above 120 km/h and asks for up to seven
// times the grip at 200 km/h, so the corner now steers until the racing line reports slip, as a player
// watching the line would, which is the grip limit the S003 criterion names.
import { createState, step, type SimState } from '../../src/core/sim.ts';
import type { InputFrame } from '../../src/core/input-frame.ts';
import { carStep, createCar, DRIFT_BETA, predict, steerLockTime, type CarParams, type CarState, type SimParams } from '../../src/sim/index.ts';
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
  peakBeta: number; // rad, largest body slip
}

function upTo(p: SimParams, kmh: number): S {
  let s = createState(1, createCar(p));
  for (let i = 0; s.car.v < kmh * KMH; i++) {
    if (i > 90 * HZ) throw new Error(`${p.car.id} never reached ${kmh} km/h`);
    s = step(s, { ...idle, throttle: 1 }, p, carStep);
  }
  return s;
}

/** Keys that bring the steering back to centre: the opposite key, let go within half a tick of travel. */
export function toCentre(car: CarParams, c: CarState): { left: number; right: number } {
  const half = 1 / HZ / 2 / steerLockTime(car, c.v);
  return { left: c.st > half ? 1 : 0, right: c.st < -half ? 1 : 0 };
}

/** Steps until the car is nearly stopped or `maxS` seconds pass. */
function watch(p: SimParams, s0: S, keys: (tick: number, car: CarState) => InputFrame, maxS: number): Outcome {
  let s = s0, spun = false, yaw = 0, slide = 0, loss = 0, n = 0, peakBeta = 0;
  for (let k = 0; k < maxS * HZ && s.car.v >= 1; k++) {
    const before = s.car;
    s = step(s, keys(k, before), p, carStep);
    const c = s.car;
    spun ||= c.mode === 'spin';
    yaw += (Math.abs(c.r) / HZ) * DEG;
    if (Math.abs(c.beta) > DRIFT_BETA) slide += 1 / HZ;
    peakBeta = Math.max(peakBeta, Math.abs(c.beta));
    if (Math.abs(c.beta) > SIDEWAYS && c.v > 3) { loss += (before.v - c.v) * HZ; n++; }
  }
  return { spun, yaw, slide, sideDecel: n ? loss / n : 0, peakBeta };
}

/** Brake from `kmh` with the right key for the first `tap` s; brake held throughout, or released once sliding. */
export function brakeTurn(car: CarParams, kmh: number, holdBrake: boolean, tap = 0.2): Outcome {
  const p = open(car);
  let released = false;
  return watch(p, upTo(p, kmh), (k, c) => {
    if (!holdBrake && Math.abs(c.beta) > DRIFT_BETA) released = true;
    return { ...idle, brake: released ? 0 : 1, ...(k < tap * HZ ? { right: 1, left: 0 } : toCentre(car, c)) };
  }, 40);
}

/** After the corner: steering brought back to centre, kept at the grip limit, or left where it is (no keys). */
export type SteerAfter = 'centre' | 'limit' | 'leave';

/**
 * Steering at the grip limit (right key until the racing line reports slip, then let go) and a speed-holding
 * on/off throttle for 3 s, then the throttle lifted and/or the steering handled as `steer` says.
 */
export function liftOff(car: CarParams, kmh: number, lift: boolean, steer: SteerAfter): Outcome {
  const p = open(car), V = kmh * KMH;
  let s = upTo(p, kmh);
  const corner = (c: CarState): InputFrame => ({ ...idle, throttle: c.v < V ? 1 : 0, right: !predict(c, p).slip && c.st < 1 ? 1 : 0 });
  for (let k = 0; k < 3 * HZ; k++) s = step(s, corner(s.car), p, carStep);
  return watch(p, s, (_k, c) => {
    const keys = corner(c);
    const st = steer === 'centre' ? toCentre(car, c) : steer === 'leave' ? { left: 0, right: 0 } : {};
    return { ...keys, throttle: lift ? 0 : keys.throttle, ...st };
  }, 8);
}

/** Steering travel whose countersteer lock points the front wheels along the travel (road-wheel angle = body slip). */
export function catchAngle(car: CarParams, beta: number): number {
  const y = Math.min(1, Math.abs(beta) / car.maxSteer), a = car.steerLinear, b = car.steerQuad;
  return (Math.sign(beta) * (-a + Math.sqrt(a * a + 4 * b * y))) / (2 * b);
}

/** Keys that move the steering toward `target`, let go within half a tick of travel. */
export function toward(car: CarParams, c: CarState, target: number): { left: number; right: number } {
  const half = 1 / HZ / 2 / steerLockTime(car, c.v);
  return { left: c.st > target + half ? 1 : 0, right: c.st < target - half ? 1 : 0 };
}

/** How the driver catches a rear slide: follow the slip with the countersteer, or hold the countersteer key while it grows. */
export type CatchHand = 'follow' | 'key';

export interface Whip {
  overshoot: number; // rad, largest body slip the other way after the catch (the whip)
  secondary: boolean; // that slip passed DRIFT_BETA: a second slide that needs a second catch
  spun: boolean;
}

/**
 * Rear-slide catch (S004-T3): the car starts at `kmh` with body slip `beta0` (rad) and yaw rate into the slide,
 * steering centred, no pedals. The hand countersteers ('follow': aims the front wheels along the travel until
 * the slip is under 0.1 rad; 'key': holds the countersteer key while the slip grows), then brings the steering
 * back to centre with the opposite key. Watched for 6 s.
 */
export function whip(car: CarParams, kmh: number, beta0: number, hand: CatchHand): Whip {
  const p = open(car), V = kmh * KMH;
  let s = createState(1, { ...createCar(p), vx: V * Math.cos(beta0), vy: V * Math.sin(beta0), v: V, beta: beta0, r: -0.6, gear: kmh < 80 ? 2 : 3 });
  let caught = false, prev = beta0, overshoot = 0, spun = false;
  for (let k = 0; k < 6 * HZ && s.car.v > 2; k++) {
    const c = s.car;
    if (!caught && (hand === 'follow' ? Math.abs(c.beta) < 0.1 : k > 0 && Math.abs(c.beta) < Math.abs(prev))) caught = true;
    prev = c.beta;
    const keys = caught ? toCentre(car, c) : hand === 'follow' ? toward(car, c, catchAngle(car, c.beta)) : { left: 0, right: 1 };
    s = step(s, { ...idle, ...keys }, p, carStep);
    if (caught) overshoot = Math.max(overshoot, -Math.sign(beta0) * s.car.beta);
    spun ||= s.car.mode === 'spin';
  }
  return { overshoot, secondary: overshoot > DRIFT_BETA, spun };
}
