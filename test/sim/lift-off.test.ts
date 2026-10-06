// S003-AC-03: at the grip limit (full lock, speed held), lifting the throttle with the steering released
// does not spin the S15 at 120 and 200 km/h or the GT3 at 120 km/h (Daniel 2026-10-05, option 2B: the rear
// tyres get `rearCornerGrip` times their cornering grip, a small margin over the front).
// Known open case (T2-spin-options.md): lifting with the steering still held in a fast S15 curve can spin it.
import { describe, expect, it } from 'vitest';
import { gt3, s15 } from './gt3-helpers.ts';
import { liftOff } from './spin-scenarios.ts';

describe('lifting off at the limit (S003-AC-03)', () => {
  it.each([
    ['S15', 120, s15], ['S15', 200, s15], ['GT3', 120, gt3], ['GT3', 200, gt3],
  ] as const)('%s at %i km/h: lift and release the steering, no spin', (_n, kmh, car) => {
    const o = liftOff(car(), kmh, true, true);
    expect(o.spun).toBe(false);
    expect(o.yaw, 'rotation after the lift, deg').toBeLessThan(200);
  });
});
