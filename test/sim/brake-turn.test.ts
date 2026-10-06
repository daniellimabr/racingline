// S003-AC-02: braking with 0.2 s of steering at 100-150 km/h does not spin either car, and a held brake
// makes a slide last no more than 2x the slide with the brake released (Daniel 2026-10-05, option 1B:
// the rear brake never takes more than `rearBrakeMaxShare` of the rear grip).
// S004-T2: after the steering tap the opposite key brings the steering back to centre (it no longer centres
// itself). With the slower steering above about 105 km/h, 0.5 s of steering at 150 km/h asks the GT3 for
// less than before and it no longer slides at all.
// S004-T3: with tyre load sensitivity (loadSensitivity 0.5) the S15 no longer slides here either (it spun once).
import { describe, expect, it } from 'vitest';
import { createState, step } from '../../src/core/sim.ts';
import type { InputFrame } from '../../src/core/input-frame.ts';
import { carStep, createCar, type CarParams, type SimParams } from '../../src/sim/index.ts';
import { gt3, idle, KMH, open, s15 } from './gt3-helpers.ts';
import { brakeTurn } from './spin-scenarios.ts';

const HELD_VS_RELEASED = 2; // agreed limit

describe('braking while turning (S003-AC-02)', () => {
  it.each([
    ['S15', 100, s15], ['S15', 150, s15], ['GT3', 100, gt3], ['GT3', 150, gt3],
  ] as const)('%s at %i km/h with 0.2 s of steering does not spin, brake held or released', (_n, kmh, car) => {
    const held = brakeTurn(car(), kmh, true), released = brakeTurn(car(), kmh, false);
    expect(held.spun).toBe(false);
    expect(released.spun).toBe(false);
    expect(held.yaw, 'rotation, deg').toBeLessThan(30);
    expect(held.slide).toBeLessThanOrEqual(HELD_VS_RELEASED * released.slide);
  });

  // With 0.5 s of steering the car may still spin once; the held brake must not stretch the slide.
  it.each([
    ['S15', 100, s15, false], ['S15', 150, s15, false], ['GT3', 150, gt3, false],
  ] as const)('%s at %i km/h with 0.5 s of steering: held-brake slide is at most 2x the released one', (_n, kmh, car, slides) => {
    const held = brakeTurn(car(), kmh, true, 0.5), released = brakeTurn(car(), kmh, false, 0.5);
    expect(released.slide > 0, 'the released-brake run slides').toBe(slides);
    expect(held.slide).toBeLessThanOrEqual(HELD_VS_RELEASED * released.slide);
    expect(held.yaw, 'no pirouette: under one and a half turns').toBeLessThan(540);
  });
});

// S005-AC-07: the GT3 in a steady corner (ideal hand, speed held), full brake pedal for 0.5 s, then released.
// S005-T3 measured (docs/sprints/SPRINT-005/mailbox/physics-dev-to-main-dev-slides.md): with the wheel let go after
// the brake the self-return straightens it and every case stays within 6 deg; with the wheel held where it was the
// GT3 slides 25-48 deg from 1.35 g at 100-150 km/h (12 deg at 200 km/h, where downforce helps). Cause: the brakes
// (0.6 front / 0.4 rear) ask the rear for more than its share once weight moves forward, so the rear passes its
// peak while braking and, with both ends past their peak, the slide keeps growing for about 2 s after the release.
// Below 1.2 g the held wheel stays within 3 deg. Fix (Main Dev 2026-10-06): GT3 brakes 0.67 front / 0.33 rear, near the
// front weight share under hard braking (about 0.65 at 1.4 g), so the rear keeps its cornering grip.
describe('S005-AC-07: GT3 0.5 s hard brake while cornering, then released', () => {
  const G = 9.81, DEG = 180 / Math.PI;
  type St = ReturnType<typeof createState<ReturnType<typeof createCar>>>;
  const tick = (s: St, p: SimParams, k: Partial<InputFrame>): St => step(s, { ...idle, ...k }, p, carStep);
  const held = (s: St, p: SimParams, k: Partial<InputFrame>, st: number): St => tick({ ...s, car: { ...s.car, st } }, p, { ...k, left: 1, right: 1 });
  function steady(car: CarParams, kmh: number, st: number): { s: St; p: SimParams } {
    const p = open(car), v = kmh * KMH;
    const rpm = (g: number): number => ((v / car.wheelRadius) * car.gears[g]! * car.finalDrive * 60) / (2 * Math.PI);
    let g = 0;
    while (g < car.gears.length - 1 && rpm(g) > car.autoUpRpm) g++;
    const s0 = createState(1, createCar(p));
    let s: St = { ...s0, car: { ...s0.car, vx: v, v, gear: g, rpm: rpm(g), rateR: v / car.wheelRadius, rateF: v / car.wheelRadius, t: 0.5 } };
    for (let i = 0; i < 170; i++) s = held(s, p, { throttle: s.car.v < v ? 1 : 0 }, st);
    return { s: { ...s, car: { ...s.car, st } }, p };
  }
  /** Peak body slip (deg) over 5 s: steady corner at up to `g`, brake 0.5 s, then released; wheel held or let go. */
  function brakeInCorner(kmh: number, g: number, keep: boolean): { g: number; peak: number } {
    let lo = 0, hi = 1, best: { s: St; p: SimParams; g: number } | undefined;
    for (let it = 0; it < 16; it++) {
      const m = (lo + hi) / 2, r = steady(gt3(), kmh, -m), a = Math.abs(r.s.car.v * r.s.car.r) / G;
      if (a < g && Math.abs(r.s.car.beta) < 0.2) { lo = m; best = { ...r, g: a }; } else hi = m;
    }
    const { p, g: got } = best!, st = best!.s.car.st;
    let s = best!.s, peak = 0;
    for (let i = 0; i < 300; i++) {
      const k = i < 30 ? { brake: 1 } : {};
      s = keep ? held(s, p, k, st) : tick(s, p, k);
      peak = Math.max(peak, Math.abs(s.car.beta));
    }
    return { g: got, peak: peak * DEG };
  }

  it.each([100, 150, 200])('at %i km/h and 1.45 g, wheel let go after the brake: within 6 deg', (kmh) => {
    const r = brakeInCorner(kmh, 1.45, false);
    expect(r.g, 'corner reached').toBeGreaterThan(1.38); // S005-T8: 1.39 g at 150 km/h with GT3 rear grip 1.09
    expect(r.peak).toBeLessThan(6); // measured 1.2-1.8 deg
  });

  it.each([100, 150, 200])('at %i km/h and 1.2 g, wheel held: within 6 deg', (kmh) => {
    expect(brakeInCorner(kmh, 1.2, true).peak).toBeLessThan(6); // measured 2.5-3.0 deg
  });

  // Main Dev target (S005-AC-07): wheel held, under 10 deg at 1.45-1.55 g (1.70 g may still slide: the extreme, a skill test).
  // Met with GT3 brakeFront 0.67 / brakeRear 0.33 (was 0.6 / 0.4: 41-48 deg at 100 km/h, 27-48 deg at 150, 12 deg at 200).
  it.each([100, 150, 200])('at %i km/h and 1.45-1.55 g, wheel held: under 10 deg', (kmh) => {
    for (const g of [1.45, 1.55]) {
      const r = brakeInCorner(kmh, g, true);
      expect(r.g, `${g} g corner reached`).toBeGreaterThan(1.38);
      expect(r.peak, `${r.g.toFixed(2)} g`).toBeLessThan(10);
    }
  });
});

// S005-T8 (blind test M3, Main Dev option 3A): the tester's corner brake. Key into the corner until an axle uses 0.8 of
// its grip, hold the wheel 0.5 s, brake 0.5 s (pedal reaches 0.55, no front lock), then let go of everything or keep the
// wheel held. With rear grip 1.05 the GT3 then kept rotating with straight wheels (let go 29-47 deg, held 7-24 deg at
// 100-200 km/h): past their peak both axles lose force as they slide more and the car was almost neutral there.
// Rear grip 1.09 gives it a margin: let go 5.7/6.1/7.8/8.4/8.1 deg, held 5.7/6.1/7.5/8.0/7.7 deg at 100/120/150/180/200 km/h.
describe('S005-T8 M3: GT3 corner brake from the blind test', () => {
  type St = ReturnType<typeof createState<ReturnType<typeof createCar>>>;
  const both = { left: 1, right: 1 }, DEG = 180 / Math.PI;
  const tk = (s: St, p: SimParams, k: Partial<InputFrame>): St => step(s, { ...idle, ...k }, p, carStep);
  function cornerBrake(kmh: number, keep: boolean): number {
    const car = gt3(), p = open(car), v = kmh * KMH;
    const rpm = (g: number): number => ((v / car.wheelRadius) * car.gears[g]! * car.finalDrive * 60) / (2 * Math.PI);
    let g = 0;
    while (g < car.gears.length - 1 && rpm(g) > car.autoUpRpm) g++;
    const s0 = createState(1, createCar(p));
    let s: St = { ...s0, car: { ...s0.car, vx: v, v, gear: g, rpm: Math.max(car.idleRpm, rpm(g)), rateR: v / car.wheelRadius, rateF: v / car.wheelRadius } };
    const hold = (x: St): St => ({ ...x, car: { ...x.car, t: x.car.v < v ? Math.min(1, (v - x.car.v) * 2 + 0.2) : 0 } });
    for (let n = 0; Math.max(s.car.useF, s.car.useR) < 0.8 && n < 600; n++) s = tk(hold(s), p, { right: 1 });
    for (let i = 0; i < 30; i++) s = tk(hold(s), p, both);
    for (let i = 0; i < 30; i++) s = tk(s, p, { ...both, brake: 1 });
    let peak = 0;
    for (let i = 0; i < 6 * 60; i++) { s = tk(s, p, keep ? both : {}); peak = Math.max(peak, Math.abs(s.car.beta)); }
    return peak * DEG;
  }
  it.each([100, 120, 150, 180, 200])('at %i km/h: let go under 10 deg, wheel held under 15 deg', (kmh) => {
    expect(cornerBrake(kmh, false), 'let go').toBeLessThan(10);
    expect(cornerBrake(kmh, true), 'held').toBeLessThan(15);
  });
});
