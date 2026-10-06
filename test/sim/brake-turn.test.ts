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
// Below 1.2 g the held wheel stays within 3 deg. The held case is characterized until Main Dev sets the target.
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
    expect(r.g, 'corner reached').toBeGreaterThan(1.4);
    expect(r.peak).toBeLessThan(6); // measured 1.2-1.8 deg
  });

  it.each([100, 150, 200])('at %i km/h and 1.2 g, wheel held: within 6 deg', (kmh) => {
    expect(brakeInCorner(kmh, 1.2, true).peak).toBeLessThan(6); // measured 2.5-3.0 deg
  });

  // Near the limit the held case is sensitive to the exact corner (measured 25-48 deg at 100-150 km/h, 12-19 deg at
  // 200 km/h for 1.41-1.55 g), so only the open state is locked: it slides past 10 deg without a full spin.
  it.each([100, 150, 200])('at %i km/h and 1.45 g, wheel held: slides past 10 deg (open, characterized)', (kmh) => {
    const r = brakeInCorner(kmh, 1.45, true);
    expect(r.peak).toBeGreaterThan(10); // flip to the target once Main Dev sets it
    expect(r.peak).toBeLessThan(75);
  });
});
