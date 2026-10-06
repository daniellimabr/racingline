// S004-T11: yaw stability from blind test round 2. A road or race car settles when the inputs stop asking it
// to turn; these checks turn the five findings into limits (scripted keys unless noted; open lot, far edges).
// Causes found (docs/sprints/SPRINT-004/mailbox/physics-dev-to-main-dev-stability.md):
//   GT3 (findings 1, 2, 5): its tyres had no load sensitivity, so the forward weight shift under braking (about
//   0.3 of the weight at 2 g) moved so much cornering grip to the front that the braking car was unstable
//   above about 195 km/h (past the critical speed: any steering, even 0.01 deg, grew into a spin).
//   Fix: GT3 loadSensitivity 0 -> 0.3, the same mechanism the S15 got in S004-T3.
//   S15 (finding 3): with only a 5% rear cornering margin the S15 was neutral at the limit, so once a big steering
//   input had put both axles past their peak, straightening the wheels left the yaw rate running (about 28 deg/s).
//   Fix: S15 rearCornerGrip 1.05 -> 1.15, with the wheelspin side-grip loss starting earlier (spinLatOnset
//   0.4 -> 0.2) so the power-on drift stays.
// Before -> after (worst case of each block): F1 GT3 280 km/h spin -> 0.3 deg; F2 GT3 200 km/h 0.98 g spin -> 5 deg;
// F3 S15 150 km/h 62 deg -> 6 deg; F5 GT3 120 km/h 31 deg -> 5 deg; F4 S15 catch held to 5 deg: spin -> spin (open).
import { describe, expect, it } from 'vitest';
import { createState, step } from '../../src/core/sim.ts';
import { carStep, createCar, type CarParams, type SimParams } from '../../src/sim/index.ts';
import type { InputFrame } from '../../src/core/input-frame.ts';
import { gt3, idle, KMH, open, s15 } from './gt3-helpers.ts';

type S = ReturnType<typeof createState<ReturnType<typeof createCar>>>;
const DEG = 180 / Math.PI, G = 9.81;

/** Straight ahead at `kmh` in the gear the automatic box would hold, settled for 20 ticks holding speed. */
function at(car: CarParams, kmh: number): { s: S; p: SimParams } {
  const p = open(car), c = p.car, v = kmh * KMH;
  const rpm = (g: number): number => ((v / c.wheelRadius) * c.gears[g]! * c.finalDrive * 60) / (2 * Math.PI);
  let g = 0;
  while (g < c.gears.length - 1 && rpm(g) > c.autoUpRpm) g++;
  const s0 = createState(1, createCar(p));
  let s: S = { ...s0, car: { ...s0.car, vx: v, v, gear: g, rpm: rpm(g), rateR: v / c.wheelRadius, rateF: v / c.wheelRadius, t: 0.5 } };
  for (let i = 0; i < 20; i++) s = tick(s, p, { throttle: hold(s, v) });
  return { s, p };
}
const tick = (s: S, p: SimParams, k: Partial<InputFrame>): S => step(s, { ...idle, ...k }, p, carStep);
/** One tick with the ideal hand holding the wheel at `st` (S005-T2: a released wheel returns to centre; both keys hold it exactly). */
const held = (s: S, p: SimParams, k: Partial<InputFrame>, st: number): S => tick({ ...s, car: { ...s.car, st } }, p, { ...k, left: 1, right: 1 });
const hold = (s: S, v: number): number => (s.car.v < v ? 1 : 0);

/** Ideal hand: steering held at `st` (no key travel), speed held for `secs`. */
function steady(car: CarParams, kmh: number, st: number, secs: number): { s: S; p: SimParams } {
  const r = at(car, kmh), v = kmh * KMH;
  let s: S = r.s;
  for (let i = 0; i < secs * 60; i++) s = held(s, r.p, { throttle: hold(s, v) }, st);
  return { s: { ...s, car: { ...s.car, st } }, p: r.p };
}

/** Steady corner (ideal hand) at the largest lateral g up to `g` that does not slide. */
function corner(car: CarParams, kmh: number, g: number): { s: S; p: SimParams; g: number } {
  let lo = 0, hi = 1, best: { s: S; p: SimParams; g: number } | undefined;
  for (let it = 0; it < 14; it++) {
    const m = (lo + hi) / 2, r = steady(car, kmh, -m, 2.5), a = Math.abs(r.s.car.v * r.s.car.r) / G;
    if (a < g && Math.abs(r.s.car.beta) < 0.2) { lo = m; best = { ...r, g: a }; } else hi = m;
  }
  if (!best) throw new Error(`${car.id}: no steady corner at ${kmh} km/h`);
  return best;
}

describe('finding 1: braking straight from speed with a little steering left on (target: no spin, slip under 5 deg)', () => {
  it.each([
    ['GT3', 225, gt3], ['GT3', 250, gt3], ['GT3', 280, gt3], ['S15', 150, s15], ['S15', 200, s15], ['S15', 230, s15],
  ] as const)('%s from %i km/h after a 1-6 frame steering tap', (_n, kmh, car) => {
    for (const taps of [1, 2, 3, 6]) {
      let { s, p } = at(car(), kmh);
      const v = kmh * KMH;
      for (let i = 0; i < taps; i++) s = tick(s, p, { left: 1, throttle: hold(s, v) });
      for (let i = 0; i < 30; i++) s = tick(s, p, { throttle: hold(s, v) });
      let peak = 0;
      for (let n = 0; s.car.v > 1 && n < 1500; n++) { s = tick(s, p, { brake: 1 }); peak = Math.max(peak, Math.abs(s.car.beta)); }
      expect(peak * DEG, `${taps} frame tap`).toBeLessThan(5); // S004-T11 before: GT3 250 km/h 90 deg, 280 km/h 90 deg
    }
  });
});

describe('finding 2: braking for 1.5 s while cornering at up to 1.0 g (target: no spin, slip under 25 deg)', () => {
  it.each([
    ['GT3', 100, gt3], ['GT3', 150, gt3], ['GT3', 200, gt3], ['S15', 100, s15], ['S15', 150, s15], ['S15', 200, s15],
  ] as const)('%s at %i km/h, steering held', (_n, kmh, car) => {
    for (const g of [0.7, 1.0]) {
      const c0 = corner(car(), kmh, g), st = c0.s.car.st, p = c0.p;
      expect(c0.g, 'corner reached').toBeGreaterThan(g - 0.25);
      // Held by the hand (S004 meaning), and let go so the wheel returns by itself (S005-AC-05).
      for (const keep of [true, false]) {
        let s = c0.s, peak = 0;
        const t = (k: Partial<InputFrame>): S => (keep ? held(s, p, k, st) : tick(s, p, k));
        for (let i = 0; i < 90; i++) { s = t({ brake: 1 }); peak = Math.max(peak, Math.abs(s.car.beta)); }
        for (let i = 0; i < 120; i++) { s = t({}); peak = Math.max(peak, Math.abs(s.car.beta)); }
        expect(peak * DEG, `${c0.g.toFixed(2)} g, held ${keep}`).toBeLessThan(25); // S004-T11 before: GT3 150 km/h 0.99 g and 200 km/h spin
      }
    }
  });
});

describe('finding 3: zero steering and no pedals settles the yaw (target: under 2 deg/s within 1.5 s)', () => {
  it.each([['GT3', gt3], ['S15', s15]] as const)('%s from a steady corner, steering set straight at once', (_n, car) => {
    for (const kmh of [60, 120, 200]) for (const g of [0.5, 0.9]) {
      let { s, p } = corner(car(), kmh, g);
      s = { ...s, car: { ...s.car, st: 0 } };
      for (let i = 0; i < 90; i++) s = tick(s, p, {});
      expect(Math.abs(s.car.r) * DEG, `${kmh} km/h ${g} g`).toBeLessThan(2);
    }
  });

  it.each([['GT3', gt3], ['S15', s15]] as const)('%s after 0.5 s of left key, right key back to centre, then nothing', (_n, car) => {
    for (const kmh of [100, 120, 150, 200]) {
      let { s, p } = at(car(), kmh);
      for (let i = 0; i < 30; i++) s = tick(s, p, { left: 1 });
      for (let k = 0; s.car.st < 0 && k < 300; k++) s = tick(s, p, { right: 1 });
      let peak = 0;
      for (let i = 0; i < 90; i++) { s = tick(s, p, {}); peak = Math.max(peak, Math.abs(s.car.beta)); }
      expect(peak * DEG, `${kmh} km/h slip`).toBeLessThan(10); // S004-T11 before: S15 27 / 42 / 62 / 29 deg
      expect(Math.abs(s.car.r) * DEG, `${kmh} km/h yaw 1.5 s after`).toBeLessThan(2); // before: S15 about 28 deg/s
    }
  });
});

describe('finding 4: S15 keyboard catch held until the slip is under 5 deg, then the other key to centre', () => {
  // Open case for Main Dev (target: under 15 deg swing, no second slide). Not met: holding full countersteer until
  // the slip is under 5 deg leaves the car rotating the other way at about 115 deg/s, so even an instant return to
  // centre at that moment spins (60 and 120 km/h); returning to centre when the rotation reverses catches it with
  // 0 deg (that is the whip test's key hand). No tyre or balance change moved it; it needs a steering-input decision.
  // S005-T10 (Main Dev option 1B, catch hold): settled; the held key keeps the wheels along the direction of travel and
  // the other key unwinds them without the full lock coming back, so the swing is now 0.4 / 1.1 deg at 60 / 120 km/h.
  it.each([60, 120])('at %i km/h the swing the other way stays under 15 deg (catch hold)', (kmh) => {
    let { s, p } = at(s15(), kmh);
    if (kmh > 100) { // 120 km/h: a growing rear slide set directly (20 deg, yaw 25 deg/s into it, wheels straight)
      const v = s.car.v, b = -20 / DEG;
      s = { ...s, car: { ...s.car, vx: v * Math.cos(b), vy: v * Math.sin(b), beta: b, r: 25 / DEG, st: 0 } };
    } else { // 60 km/h: the tester's entry, a short steer then full throttle until the slide reaches 20 deg
      for (let i = 0; i < 20; i++) s = tick(s, p, { right: 1 });
      for (let n = 0; Math.abs(s.car.beta) < 20 / DEG && n < 600; n++) s = tick(s, p, { throttle: 1 });
    }
    const s0 = Math.sign(s.car.beta), counter = s0 > 0 ? { right: 1 } : { left: 1 };
    for (let n = 0; Math.abs(s.car.beta) >= 5 / DEG && n < 600; n++) s = tick(s, p, counter);
    const stC = s.car.st, back = stC > 0 ? { left: 1 } : { right: 1 };
    for (let n = 0; Math.sign(s.car.st) === Math.sign(stC) && s.car.st !== 0 && n < 600; n++) s = tick(s, p, back);
    let other = 0;
    for (let i = 0; i < 300; i++) { s = tick(s, p, {}); other = Math.max(other, -s.car.beta * s0); }
    expect(other).toBeLessThan(15 / DEG); // before the catch hold: a spin (over 1.3 rad) at both speeds
  });
});

describe('finding 5: GT3 lifting at the grip limit with the steering held (target: slip under 15 deg and recovers)', () => {
  it.each([120, 200])('at %i km/h', (kmh) => {
    const v = kmh * KMH;
    let lo = 0, hi = 1, best: { s: S; p: SimParams } | undefined;
    for (let it = 0; it < 14; it++) {
      const m = (lo + hi) / 2, r = steady(gt3(), kmh, m, 3);
      if (Math.abs(r.s.car.beta) < 6 / DEG && r.s.car.v > v - 2) { lo = m; best = r; } else hi = m;
    }
    const { s: s0, p } = best!, st = s0.car.st;
    expect(Math.abs(s0.car.v * s0.car.r) / G, 'at the limit').toBeGreaterThan(1.5);
    for (const keep of [true, false]) { // held by the hand, and let go so the wheel returns (S005-AC-05)
      let s = s0, peak = 0;
      for (let i = 0; i < 300; i++) { s = keep ? held(s, p, {}, st) : tick(s, p, {}); peak = Math.max(peak, Math.abs(s.car.beta)); }
      expect(peak * DEG, `held ${keep}`).toBeLessThan(15); // S004-T11 before: 31 deg at 120 km/h, 13 deg still at 13 deg after 5 s at 200
      expect(Math.abs(s.car.beta) * DEG, `held ${keep}: recovered after 5 s`).toBeLessThan(5);
    }
  });
});

describe('S005-AC-05: the wheel returning by itself never sets up an oscillation of steering or yaw', () => {
  // The car's own yaw overshoots zero a little when its steering is straightened (S15 at 200 km/h: 0.8 deg/s after an
  // instant centring), so the yaw swing with the slow return is held to that of setting the steering straight at once.
  /** Lets go and watches 6 s: steering must only move towards centre; yaw swing past zero, deg/s; `now` straightens at once. */
  function letGo(s0: S, p: SimParams, v: number, now = false): { stOk: boolean; swing: number; yawEnd: number; betaPeak: number } {
    const r0 = Math.sign(s0.car.r || s0.car.st);
    let s = now ? { ...s0, car: { ...s0.car, st: 0 } } : s0, prev = Math.abs(s.car.st), stOk = true, swing = 0, betaPeak = 0;
    for (let i = 0; i < 360; i++) {
      s = tick(s, p, { throttle: hold(s, v) });
      if (Math.abs(s.car.st) > prev || s.car.st * s0.car.st < 0) stOk = false;
      prev = Math.abs(s.car.st);
      swing = Math.max(swing, -r0 * s.car.r);
      betaPeak = Math.max(betaPeak, Math.abs(s.car.beta));
    }
    return { stOk, swing: swing * DEG, yawEnd: Math.abs(s.car.r) * DEG, betaPeak: betaPeak * DEG };
  }

  it.each([['GT3', gt3], ['S15', s15]] as const)('%s straight line with a little steering left on, 50-250 km/h', (_n, car) => {
    for (const kmh of [50, 100, 150, 200, 250]) for (const st of [0.05, -0.2]) {
      const { s, p } = at(car(), kmh), o = letGo({ ...s, car: { ...s.car, st } }, p, kmh * KMH);
      expect(o.stOk, `${kmh} km/h st ${st}: steering only returns`).toBe(true);
      expect(o.swing, `${kmh} km/h st ${st}: yaw swing the other way, deg/s`).toBeLessThan(1.5); // S15 250 km/h from -0.2: 1.0
      expect(o.yawEnd, `${kmh} km/h st ${st}: settled`).toBeLessThan(0.5);
    }
  });

  it.each([['GT3', gt3], ['S15', s15]] as const)('%s steady corner at 0.5 and 0.9 g, then let go, 60-200 km/h', (_n, car) => {
    for (const kmh of [60, 120, 200]) for (const g of [0.5, 0.9]) {
      const { s, p } = corner(car(), kmh, g), o = letGo(s, p, kmh * KMH), now = letGo(s, p, kmh * KMH, true);
      expect(o.stOk, `${kmh} km/h ${g} g: steering only returns`).toBe(true);
      expect(o.swing, `${kmh} km/h ${g} g: yaw swing the other way, deg/s`).toBeLessThanOrEqual(Math.max(0.2, now.swing));
      expect(o.swing).toBeLessThan(1.5);
      expect(o.betaPeak, `${kmh} km/h ${g} g: no slide`).toBeLessThan(6);
      expect(o.yawEnd, `${kmh} km/h ${g} g: settled after 6 s`).toBeLessThan(1);
    }
  });
});
