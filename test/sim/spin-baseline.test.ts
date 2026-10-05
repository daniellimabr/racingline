// S003-AC-01: before/after record of the two spins on both cars. "Before" is the game at bcd14bf, measured
// in S003-T2 (docs/sprints/SPRINT-003/T2-spin-options.md, outside the repo); "after" is Daniel's pick of
// 2026-10-05, asserted here: option 1B (rear brake capped at 75% of rear grip, `rearBrakeMaxShare`) and
// option 2B (rear cornering grip +5%, `rearCornerGrip`). The pass/fail limits live in brake-turn.test.ts
// (S003-AC-02) and lift-off.test.ts (S003-AC-03); this file keeps the measured numbers.
//
// Causes found in T2: both cars are balanced exactly neutral, so any forward weight shift makes the rear the
// weaker end. Under braking the rear brake asked for more than the rear tyres had and took 98% of the rear
// grip, leaving 20% for cornering; after a lift, drag and engine braking moved 2-3% of the weight forward.
//
// Braking with steering for the first `tap` s (brake held / released once sliding):
//   case                      before: held                      before: released     after: held / released
//   S15 100 km/h, 0.2 s       spin, 921 deg, slide 7.6 s        spin, 2.2 s          no spin, 3 deg / same
//   S15 150 km/h, 0.2 s       spin, 3847 deg, slide 18.5 s,     spin, 4.4 s,         no spin, 7 deg / same
//                             sideways slowing 1.9 m/s2         7.5 m/s2
//   GT3 150 km/h, 0.2 s       spin, 606 deg, slide 5.5 s        spin, 1.7 s          no spin, 1 deg / same
//   GT3 100 km/h, 0.5 s       spin, 871 deg, slide 6.8 s        spin, 1.8 s          no spin, 11 deg / same
//   S15 150 km/h, 0.5 s       spin, 4792 deg, slide 20.4 s      spin, 4.9 s          one spin, 253 deg, 5.4 s / 4.8 s
// Lifting at full lock with the steering released (before -> after):
//   S15 120 km/h spin 236 deg -> no spin; S15 200 km/h spin 353 deg -> no spin;
//   GT3 120 km/h spin 217 deg -> no spin (slides to about 49 deg for 3.2 s and recovers); GT3 200 km/h no spin -> no spin.
import { describe, expect, it } from 'vitest';
import { gt3, s15 } from './gt3-helpers.ts';
import { brakeTurn, liftOff } from './spin-scenarios.ts';

/** `x` within `tol` (share) of `target`. */
function near(x: number, target: number, tol = 0.1): void {
  expect(x).toBeGreaterThan(target * (1 - tol));
  expect(x).toBeLessThan(target * (1 + tol));
}

describe('spin record before and after the S003 fix (S003-AC-01)', () => {
  describe('braking with steering', () => {
    it('straight braking does not spin either car (unchanged control)', () => {
      for (const car of [s15(), gt3()]) for (const kmh of [100, 150]) expect(brakeTurn(car, kmh, true, 0).spun).toBe(false);
    });

    it('0.2 s of steering: neither car slides any more, brake held or released (before: both spun)', () => {
      for (const [car, kmh] of [[s15, 100], [s15, 150], [gt3, 100], [gt3, 150]] as const) {
        for (const hold of [true, false]) {
          const o = brakeTurn(car(), kmh, hold);
          expect(o.spun).toBe(false);
          expect(o.slide).toBe(0);
          expect(o.yaw).toBeLessThan(10);
        }
      }
    });

    it('GT3 at 100 km/h with 0.5 s of steering no longer spins (before: 871 deg, 6.8 s)', () => {
      const o = brakeTurn(gt3(), 100, true, 0.5);
      expect(o.spun).toBe(false);
      near(o.yaw, 10.5);
    });

    it('0.5 s of steering at 150 km/h still spins once, but the held brake no longer stretches the slide', () => {
      const sh = brakeTurn(s15(), 150, true, 0.5), sr = brakeTurn(s15(), 150, false, 0.5);
      near(sh.yaw, 253); // before 4792 deg
      near(sh.slide, 5.4); // before 20.4 s
      near(sr.slide, 4.77);
      near(sh.sideDecel, 5.0, 0.15); // before 1.9 m/s2
      const gh = brakeTurn(gt3(), 150, true, 0.5), gr = brakeTurn(gt3(), 150, false, 0.5);
      near(gh.yaw, 172); // before 2856 deg
      near(gh.slide, 3.67); // before 13.3 s
      near(gr.slide, 2.7);
    });
  });

  describe('lifting off at full lock, steering released', () => {
    it.each([
      ['S15', 120, s15, 0.84], ['S15', 200, s15, 0.74], ['GT3', 200, gt3, 7.7],
    ] as const)('%s at %i km/h holds its line (rotation about %s deg)', (_n, kmh, car, yaw) => {
      const o = liftOff(car(), kmh, true, true);
      expect(o.spun).toBe(false);
      expect(o.slide).toBe(0);
      near(o.yaw, yaw, 0.2);
    });

    it('GT3 at 120 km/h slides and recovers instead of spinning (before: spin, 217 deg)', () => {
      const o = liftOff(gt3(), 120, true, true);
      expect(o.spun).toBe(false);
      near(o.yaw, 179);
      near(o.slide, 3.15);
    });

    it('releasing the steering without lifting spins neither car (unchanged control)', () => {
      for (const [car, kmh] of [[s15, 120], [s15, 200], [gt3, 120], [gt3, 200]] as const) expect(liftOff(car(), kmh, false, true).spun).toBe(false);
    });
  });
});
