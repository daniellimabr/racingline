// S005-AC-06: the S15 rear slide caught with the countersteer key, then the keys released (the wheel returns by
// itself, S005-T2), or the countersteer held 0.5 / 1 s too long. Open lot, scripted keys, no pedals after the entry.
// Entries: 60 km/h short steer + full throttle until 20 deg of slip (the tester's entry); 90 km/h 30 deg, 120 and
// 150 km/h 20 deg set directly (yaw 25 deg/s into the slide, wheels straight).
// S005-T3 measured (docs/sprints/SPRINT-005/mailbox/physics-dev-to-main-dev-slides.md): released at the catch (slip
// stops growing) the wheel is still countersteered (0.63-1.0 of full travel) and returns only 0.25-0.3 of it in 1 s,
// so the leftover lock steers the car into the opposite spin in every case. The same release with the wheel set
// straight at once ends with 0.1-0.9 deg the other way, so the car itself recovers; the slow return is the cause.
// Held 0.5 s or more past the catch the car is already sliding the other way and spins even with an instant centring
// (driver timing, not the steering).
// S005-T10 (Main Dev option 1B, catch hold): no longer; while the key that caught the slide stays held the wheels point at
// most along the direction of travel, straight once the slide has closed, so holding it on does not spin the car.
// Main Dev 2026-10-06 picked option 1B: while the car slides (body slip above steerSlideBeta or rear slip past the
// tyre peak) a released wheel returns to centre at steerSlideShare of the key speed, so the release now catches it.
import { describe, expect, it } from 'vitest';
import { createState, step } from '../../src/core/sim.ts';
import { carStep, createCar, type CarParams, type SimParams } from '../../src/sim/index.ts';
import type { InputFrame } from '../../src/core/input-frame.ts';
import { idle, KMH, open, s15 } from './gt3-helpers.ts';
import { hashState } from '../../src/core/hash.ts';

type S = ReturnType<typeof createState<ReturnType<typeof createCar>>>;
const DEG = 180 / Math.PI, SPIN = 1.3, HZ = 60;
const tick = (s: S, p: SimParams, k: Partial<InputFrame>): S => step(s, { ...idle, ...k }, p, carStep);

/** Straight ahead at `kmh` in the automatic-box gear, settled for 20 ticks holding speed. */
function at(car: CarParams, kmh: number): { s: S; p: SimParams } {
  const p = open(car), c = p.car, v = kmh * KMH;
  const rpm = (g: number): number => ((v / c.wheelRadius) * c.gears[g]! * c.finalDrive * 60) / (2 * Math.PI);
  let g = 0;
  while (g < c.gears.length - 1 && rpm(g) > c.autoUpRpm) g++;
  const s0 = createState(1, createCar(p));
  let s: S = { ...s0, car: { ...s0.car, vx: v, v, gear: g, rpm: rpm(g), rateR: v / c.wheelRadius, rateF: v / c.wheelRadius, t: 0.5 } };
  for (let i = 0; i < 20; i++) s = tick(s, p, { throttle: s.car.v < v ? 1 : 0 });
  return { s, p };
}

type Entry = '60 throttle' | '90 set 30' | '120 set 20' | '150 set 20';
function entry(e: Entry): { s: S; p: SimParams } {
  if (e === '60 throttle') {
    let { s, p } = at(s15(), 60);
    for (let i = 0; i < 20; i++) s = tick(s, p, { right: 1 });
    for (let n = 0; Math.abs(s.car.beta) < 20 / DEG && n < 600; n++) s = tick(s, p, { throttle: 1 });
    return { s, p };
  }
  const [kmh, b0] = e === '90 set 30' ? [90, 30] : e === '120 set 20' ? [120, 20] : [150, 20];
  const { s, p } = at(s15(), kmh), v = s.car.v, b = -b0 / DEG;
  return { s: { ...s, car: { ...s.car, vx: v * Math.cos(b), vy: v * Math.sin(b), beta: b, r: 25 / DEG, st: 0 } }, p };
}

interface Catch { peak: number; stAtRelease: number; stAfter1s: number; opposite: number; oppYaw: number; spun: boolean }

/** Countersteer key until the slip stops growing, `late` s more, then no keys for 6 s (`centre`: wheel set straight at the release). */
function keyCatch(e: Entry, late: number, centre = false): Catch {
  let { s, p } = entry(e);
  const rot0 = Math.sign(s.car.r), s0 = Math.sign(s.car.beta), counter = s0 > 0 ? { right: 1 } : { left: 1 };
  let prev = Math.abs(s.car.beta), peak = prev;
  for (let n = 0; n < 600; n++) {
    s = tick(s, p, counter);
    const b = Math.abs(s.car.beta);
    peak = Math.max(peak, b);
    if (b < prev) break;
    prev = b;
  }
  for (let i = 0; i < late * HZ; i++) s = tick(s, p, counter);
  if (centre) s = { ...s, car: { ...s.car, st: 0 } };
  const stAtRelease = Math.abs(s.car.st);
  let opposite = 0, spun = false, stAfter1s = 0, oppYaw = 0;
  for (let i = 0; i < 6 * HZ && s.car.v > 2; i++) {
    s = tick(s, p, {});
    opposite = Math.max(opposite, -s.car.beta * s0);
    oppYaw = Math.max(oppYaw, -s.car.r * rot0);
    spun ||= Math.abs(s.car.beta) > SPIN && s.car.beta * s0 < 0;
    if (i === HZ - 1) stAfter1s = Math.abs(s.car.st);
  }
  return { peak: peak * DEG, stAtRelease, stAfter1s, opposite: opposite * DEG, oppYaw: oppYaw * DEG, spun };
}

const entries: Entry[] = ['60 throttle', '90 set 30', '120 set 20', '150 set 20'];

describe('S005-AC-06: S15 keyboard slide catch with the self-returning wheel', () => {
  // Peak yaw the other way after the release (deg/s), recorded: before option 1B 106-140 deg/s and a spin in all four.
  // S005-T8 (option 2B: countersteer lock up to the body slip, slide return at 2x key): 46/43/50/43 -> 23/21/20/21 deg/s.
  const OPP_YAW: Record<Entry, number> = { '60 throttle': 23, '90 set 30': 21, '120 set 20': 20, '150 set 20': 21 };
  it.each(entries)('%s: released at the catch, the wheel unwinds at key speed and there is no opposite spin', (e) => {
    const c = keyCatch(e, 0);
    expect(c.peak, 'slide caught at 20-41 deg').toBeGreaterThan(19);
    expect(c.stAtRelease, 'still countersteered at the release').toBeGreaterThan(0.6);
    expect(c.stAfter1s, 'back at centre within 1 s').toBe(0);
    expect(c.spun).toBe(false);
    expect(c.opposite, 'deg the other way').toBeLessThan(15);
    expect(c.oppYaw).toBeCloseTo(OPP_YAW[e], -1);
  });

  it.each(entries)('%s: the same release with the wheel set straight at once recovers (the car is not the cause)', (e) => {
    const c = keyCatch(e, 0, true);
    expect(c.spun).toBe(false);
    expect(c.opposite, 'deg the other way').toBeLessThan(3); // measured 0.1-0.9 deg
  });

  // S005-T8 (blind test M2, Main Dev target): a human key reaction of 0.2 s too late must not spin. Measured with 2B:
  // 0.6/1.0/7.1/22.8 deg the other way, no spin (before 2B the S15 spun from 0.05 s late at 100-150 km/h).
  it.each(entries)('%s: countersteer held 0.2 s too long, then released, does not spin', (e) => {
    expect(keyCatch(e, 0.2).spun).toBe(false);
  });

  // S005-T10 (Main Dev option 1B, catch hold): these used to spin (driver timing); the held key now keeps the wheels
  // along the direction of travel, straight once the slide has closed, so holding it on no longer throws the car round.
  it.each(entries)('%s: countersteer held 0.5 and 1 s too long no longer spins (catch hold)', (e) => {
    for (const late of [0.5, 1]) {
      const c = keyCatch(e, late);
      expect(c.spun, `${late} s late`).toBe(false);
      expect(c.opposite, `${late} s late, deg the other way`).toBeLessThan(5);
    }
    expect(keyCatch(e, 1, true).spun, '1 s late, centred at once').toBe(false);
  });
});

// S005-T10 (blind test round 2, M1): the Game Tester's exact keys. Left + throttle until the slide reaches 12 deg (60 and
// 90 km/h; at 120 km/h no key entry reaches 12 deg, so that slide is set: 12 deg, 25 deg/s into it, left at full lock),
// then the right key held until the slide closes (body slip back through zero) and `late` s more, then no steering for
// 4 s, with the throttle held throughout or off from the countersteer on. Before option 1B every release from 7 deg
// before the close onwards spun about 90 deg the other way: the full lock came back as the slide closed and threw the
// nose round (yaw the other way 38 -> 90 deg/s at 60 km/h). With the catch hold (Main Dev option 1B) measured 0-2 deg.
type Tester = { kmh: number; w: boolean };
function testerCatch({ kmh, w }: Tester, late: number): { closeS: number; opposite: number; spun: boolean } {
  let { s, p } = at(s15(), kmh);
  if (kmh >= 120) {
    const v = s.car.v, b = 12 / DEG;
    s = { ...s, car: { ...s.car, vx: v * Math.cos(b), vy: v * Math.sin(b), beta: b, r: -25 / DEG, st: -1, t: w ? 1 : 0 } };
  }
  for (let n = 0; Math.abs(s.car.beta) < 12 / DEG; n++) {
    if (n >= 600) throw new Error(`${kmh} km/h: the key entry never reached 12 deg`);
    s = tick(s, p, { left: 1, throttle: 1 });
  }
  const s0 = Math.sign(s.car.beta), thr = w ? 1 : 0;
  let n = 0;
  for (; s.car.beta * s0 > 0; n++) {
    if (n >= 600) throw new Error(`${kmh} km/h: the slide never closed`);
    s = tick(s, p, { right: 1, throttle: thr });
  }
  for (let i = 0; i < Math.round(late * HZ); i++) s = tick(s, p, { right: 1, throttle: thr });
  let opposite = 0, spun = false;
  for (let i = 0; i < 4 * HZ; i++) {
    s = tick(s, p, { throttle: thr });
    opposite = Math.max(opposite, -s.car.beta * s0 * DEG);
    spun ||= Math.abs(s.car.beta) > SPIN;
  }
  return { closeS: n / HZ, opposite, spun };
}
const testers: Tester[] = [60, 90, 120].flatMap((kmh) => [{ kmh, w: true }, { kmh, w: false }]);
const tname = (t: Tester): string => `${t.kmh} km/h, throttle ${t.w ? 'held' : 'off'}`;

describe('S005-T10: the tester caught slide, released from the slide closing up to 0.2 s later (Main Dev option 1B)', () => {
  it.each(testers.map((t) => [tname(t), t] as const))('%s: no spin, at most 5 deg the other way', (_n, t) => {
    for (const late of [0, 0.05, 0.1, 0.15, 0.2]) {
      const c = testerCatch(t, late);
      expect(c.spun, `${late} s late`).toBe(false);
      expect(c.opposite, `${late} s late, deg the other way`).toBeLessThan(5); // measured 0-2 deg
    }
  });

  it.each(testers.map((t) => [tname(t), t] as const))('%s: the countersteer held 1 s too long ends within 3 deg', (_n, t) => {
    const c = testerCatch(t, 1);
    expect(c.spun).toBe(false);
    expect(c.opposite).toBeLessThan(3); // measured 0 deg: the held key keeps the wheels straight once the slide has closed
  });

  // 1B must not lock the driver out of a side-to-side drift: the same key released and pressed again steers freely.
  it('a side-to-side drift still works when the countersteer key is released and pressed again', () => {
    const run = (gap: number): number => {
      let { s, p } = at(s15(), 60);
      while (Math.abs(s.car.beta) < 12 / DEG) s = tick(s, p, { left: 1, throttle: 1 });
      const s0 = Math.sign(s.car.beta);
      while (s.car.beta * s0 > 0) s = tick(s, p, { right: 1, throttle: 1 });
      for (let i = 0; i < gap; i++) s = tick(s, p, { throttle: 1 });
      let other = 0;
      for (let i = 0; i < 1.5 * HZ; i++) { s = tick(s, p, { right: 1, throttle: 1 }); other = Math.max(other, -s.car.beta * s0 * DEG); }
      return other;
    };
    expect(run(0), 'key held through: the catch hold keeps it straight').toBeLessThan(5);
    expect(run(3), 'released for 0.05 s and pressed again: a slide the other way').toBeGreaterThan(15);
  });
});

describe('S005-T10: the catch hold is saved state that serializes and replays exactly', () => {
  it('a state saved during the hold and after the release continues bit-identically, and the hold clears at centre', () => {
    let { s, p } = at(s15(), 60);
    while (Math.abs(s.car.beta) < 12 / DEG) s = tick(s, p, { left: 1, throttle: 1 });
    expect('hold' in s.car, 'no hold before the countersteer').toBe(false);
    for (let i = 0; i < 30; i++) s = tick(s, p, { right: 1, throttle: 1 });
    expect(s.car.hold, 'the right key caught the slide').toBe(1);
    const keys = [...Array(20).fill({ right: 1, throttle: 1 }), ...Array(100).fill({ throttle: 1 })] as Partial<InputFrame>[];
    let a = s, b: S = JSON.parse(JSON.stringify(s)) as S, released = false;
    for (const k of keys) {
      a = tick(a, p, k);
      b = tick(b, p, k);
      released ||= a.car.hold === 2;
      expect(hashState(b)).toBe(hashState(a));
    }
    expect(released, 'kept (as 2) after the release while the wheel unwinds').toBe(true);
    expect('hold' in a.car, 'cleared once the wheel is back at centre').toBe(false);
  });
});
