// S003-AC-02: braking with 0.2 s of steering at 100-150 km/h does not spin either car, and a held brake
// makes a slide last no more than 2x the slide with the brake released (Daniel 2026-10-05, option 1B:
// the rear brake never takes more than `rearBrakeMaxShare` of the rear grip).
// S004-T2: after the steering tap the opposite key brings the steering back to centre (it no longer centres
// itself). With the slower steering above about 105 km/h, 0.5 s of steering at 150 km/h asks the GT3 for
// less than before and it no longer slides at all.
// S004-T3: with tyre load sensitivity (loadSensitivity 0.5) the S15 no longer slides here either (it spun once).
import { describe, expect, it } from 'vitest';
import { gt3, s15 } from './gt3-helpers.ts';
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
