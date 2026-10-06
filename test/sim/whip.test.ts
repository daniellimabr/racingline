// S004-AC-05: catching a rear slide by counter-steering and then bringing the steering back to centre. The
// yaw overshoot past straight (body slip the other way after the catch) stays under 15 deg and never becomes a
// second slide that needs a second catch. Both cars, 60-120 km/h, slides of 20 and 29 deg (0.35 and 0.5 rad)
// started as an initial state, then scripted keys (spin-scenarios.ts whip()).
// S004-T3 measured overshoots of 0-4 deg in every case below, before and after the S15 load sensitivity.
// The S004-T3 open case (S15 at 120 km/h, 29 deg slide caught by following the slip: 21 deg with a second slide)
// is closed by S004-T11 (S15 rear cornering margin 1.15): 7.6 deg, no second slide, so it is now a normal case.
import { describe, expect, it } from 'vitest';
import { gt3, s15 } from './gt3-helpers.ts';
import { whip, type CatchHand } from './spin-scenarios.ts';

const LIMIT = 15; // deg, agreed overshoot limit
const DEG = 180 / Math.PI;
const cars = [['S15', s15], ['GT3', gt3]] as const;

describe('counter-steer whip (S004-AC-05)', () => {
  const cases: [string, typeof s15, number, number, CatchHand][] = [];
  for (const [n, car] of cars) for (const kmh of [60, 90, 120]) {
    cases.push([n, car, kmh, 0.35, 'follow'], [n, car, kmh, 0.35, 'key'], [n, car, kmh, 0.5, 'key'], [n, car, kmh, 0.5, 'follow']);
  }
  it.each(cases)('%s at %i km/h, slip %s rad, %s hand: overshoot under 15 deg, no second slide', (_n, car, kmh, beta0, hand) => {
    const w = whip(car(), kmh, beta0, hand);
    expect(w.spun).toBe(false);
    expect(w.secondary).toBe(false);
    expect(w.overshoot * DEG).toBeLessThan(LIMIT);
  });
});
