// S003-AC-03: at the grip limit (full lock, speed held), lifting the throttle with the steering released
// does not spin the S15 at 120 and 200 km/h or the GT3 at 120 km/h (Daniel 2026-10-05, option 2B: the rear
// tyres get `rearCornerGrip` times their cornering grip, a small margin over the front).
// Known open case (T2-spin-options.md): lifting with the steering still held in a fast S15 curve can spin it.
// S004-T2: the corner is now the grip limit shown by the racing line, not full lock, and "release" means the
// opposite key brings the steering back to centre (see spin-scenarios.ts). Since steering now stays where it
// is put, letting go of every key at the limit is the open case above: the S15 spins at 120 and 200 km/h
// (handed to S004-T3).
// S004-T3: fixed by tyre load sensitivity on the S15 (loadSensitivity 0.5): the lift moved 1.4% of the weight
// forward and, with grip exactly proportional to load, that flipped the S15 from barely understeering to
// oversteering, so it diverged slowly at constant steering (before: 51 deg slide at 120 km/h, spin at 200).
import { describe, expect, it } from 'vitest';
import { gt3, s15 } from './gt3-helpers.ts';
import { liftOff } from './spin-scenarios.ts';

const DEG = 180 / Math.PI;

describe('lifting off at the limit (S003-AC-03)', () => {
  it.each([
    ['S15', 120, s15], ['S15', 200, s15], ['GT3', 120, gt3], ['GT3', 200, gt3],
  ] as const)('%s at %i km/h: lift and bring the steering back to centre, no spin', (_n, kmh, car) => {
    const o = liftOff(car(), kmh, true, 'centre');
    expect(o.spun).toBe(false);
    expect(o.yaw, 'rotation after the lift, deg').toBeLessThan(200);
  });
});

describe('lifting off at the limit with the steering left where it is (S004-T3, keys let go)', () => {
  it.each([
    ['S15', 120, s15], ['S15', 200, s15], ['GT3', 120, gt3], ['GT3', 200, gt3],
  ] as const)('%s at %i km/h: no spin and no slide', (_n, kmh, car) => {
    const o = liftOff(car(), kmh, true, 'leave');
    expect(o.spun).toBe(false);
    expect(o.slide, 's with slip above the drift angle').toBe(0);
    expect(o.peakBeta * DEG, 'largest body slip, deg').toBeLessThan(12);
  });
});
