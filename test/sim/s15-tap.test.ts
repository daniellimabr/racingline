// S004-AC-06: S15 brake-and-steer taps of 0.3-0.5 s at 100-150 km/h with the S004 steering (it stays where it
// is put; after the tap the opposite key brings it back to centre). Brake held to the stop, or released once
// the car slides.
// Before S004-T3 every one of these spun (yaw 203-354 deg, slide 3.1-6.7 s): with grip exactly proportional to
// load, braking moved the S15 from neutral to strong oversteer. Tyre load sensitivity (loadSensitivity 0.5:
// grip per unit of load falls as an axle gains load) makes the shift swing the balance less.
import { describe, expect, it } from 'vitest';
import { s15 } from './gt3-helpers.ts';
import { brakeTurn } from './spin-scenarios.ts';

describe('S15 brake-and-steer taps (S004-AC-06)', () => {
  it.each([
    [100, 0.3], [100, 0.4], [100, 0.5], [150, 0.3], [150, 0.4], [150, 0.5],
  ] as const)('%i km/h, %s s of steering: no spin, brake held or released', (kmh, tap) => {
    for (const hold of [true, false]) {
      const o = brakeTurn(s15(), kmh, hold, tap);
      expect(o.spun, hold ? 'brake held' : 'brake released').toBe(false);
      expect(o.yaw, 'rotation, deg').toBeLessThan(45);
    }
  });
});
