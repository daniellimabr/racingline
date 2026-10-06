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
import { DataError } from '../../src/data/check.ts';
import { loadCarParams } from '../../src/sim/index.ts';
import s15Json from '../../src/cars/s15-drift.json';

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
function testerCatch({ kmh, w }: Tester, late: number, under = 0): { closeS: number; opposite: number; spun: boolean } {
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
  let peak = 0;
  for (; s.car.beta * s0 > 0; n++) {
    if (n >= 600) throw new Error(`${kmh} km/h: the slide never closed`);
    peak = Math.max(peak, s.car.beta * s0 * DEG);
    if (under && peak > 12.5 && s.car.beta * s0 * DEG < under) break; // released on the way down, before the close
    s = tick(s, p, { right: 1, throttle: thr });
  }
  if (!under) for (let i = 0; i < Math.round(late * HZ); i++) s = tick(s, p, { right: 1, throttle: thr });
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

// S005-T12 (blind test round 3, Main Dev option 3A): the catch hold ends on the car's own motion, never on key presses.
// It keeps catching while the slide on the caught side is open or the car still rotates back towards it faster than
// steerCatchSettleYaw; then, while a key on that side is held, the lock comes back at the key rate (and closes again if
// it is let go). Round 3 found the T10 hold kept a held key straight for ever (M1) and let each new press clear it, so
// taps brought the full lock back and spun (M2).
describe('S005-T10/T12: the tester caught slide (catch matrix of rounds 2 and 3)', () => {
  it.each(testers.map((t) => [tname(t), t] as const))('%s: released under 10/8/5 deg or 0-0.3 s after the close: no spin, at most 6 deg the other way', (_n, t) => {
    for (const under of [10, 8, 5]) {
      const c = testerCatch(t, 0, under);
      expect(c.spun, `released under ${under} deg`).toBe(false);
      expect(c.opposite, `released under ${under} deg, deg the other way`).toBeLessThan(6);
    }
    for (const late of [0, 0.05, 0.1, 0.15, 0.2, 0.3]) {
      const c = testerCatch(t, late);
      expect(c.spun, `${late} s late`).toBe(false);
      expect(c.opposite, `${late} s late, deg the other way`).toBeLessThan(6); // measured 0-5.1 deg
    }
  });

  // S005-T12: rewritten (T10 kept the wheels straight for as long as the key was held, so 1 s late ended within 3 deg).
  // Now the lock comes back once the car settles, so 1 s late steers the car the other way; with full throttle at 60 km/h
  // that spins, which is the car's own behaviour (see the straight-line test below), accepted by Main Dev.
  const LATE_1S: Record<string, 'spin' | number> = {
    '60 km/h, throttle held': 'spin', '60 km/h, throttle off': 3, '90 km/h, throttle held': 8, '90 km/h, throttle off': 6,
    '120 km/h, throttle held': 8, '120 km/h, throttle off': 6,
  };
  it.each(testers.map((t) => [tname(t), t] as const))('%s: the countersteer held 1 s too long steers the car again (recorded)', (n, t) => {
    const c = testerCatch(t, 1), want = LATE_1S[n]!;
    if (want === 'spin') expect(c.spun).toBe(true);
    else {
      expect(c.spun).toBe(false);
      expect(c.opposite).toBeLessThan(want);
    }
  });

  // Main Dev 2026-10-06 (round 3): the S15 with full throttle spins when full lock is held for a moment at 60-70 km/h even
  // from a straight line, before and after this sprint, so a full-throttle spin with the lock held on is the car, not the hold.
  it.each([[60, 'right', 0.3], [70, 'left', 1]] as const)('the car itself: straight at %i km/h, full throttle, full %s lock for %s s, then let go: spins', (kmh, key, held) => {
    let { s, p } = at(s15(), kmh), spun = false;
    for (let i = 0; i < (held + 4) * HZ; i++) {
      s = tick(s, p, { [key]: i < held * HZ ? 1 : 0, throttle: 1 });
      spun ||= Math.abs(s.car.beta) > SPIN;
    }
    expect(spun).toBe(true);
  });
});

describe('S005-T12 M1: a key held after a settled catch steers again', () => {
  // Tester: 90 km/h, throttle + right until 12 deg of slip, then throttle + left held. With T10 the wheels stayed at
  // 0.00 deg and the car ran dead straight for 6 s; now the lock comes back once the car settles (measured 0.38 s).
  it('90 km/h: 90% of the normal lock within 0.5 s of settling, and the car turns left', () => {
    let { s, p } = at(s15(), 90);
    const c = p.car;
    while (Math.abs(s.car.beta) < 12 / DEG) s = tick(s, p, { right: 1, throttle: 1 });
    const h0 = s.car.h;
    let settled = -1, locked = -1;
    for (let i = 0; i < 6 * HZ; i++) {
      s = tick(s, p, { left: 1, throttle: 1 });
      if (settled < 0 && Math.abs(s.car.hold ?? 0) === 2) settled = i;
      const lock = Math.max(c.steerMin, c.maxSteer / (1 + s.car.v / c.steerSpeedRef));
      if (settled >= 0 && locked < 0 && -s.car.delta > 0.9 * lock) locked = i;
    }
    expect(settled, 'the car settles after the catch').toBeGreaterThan(0);
    expect(locked, 'the lock comes back').toBeGreaterThan(0);
    expect((locked - settled) / HZ, 's from settling to 90% of the lock').toBeLessThanOrEqual(0.5);
    expect('hold' in s.car, 'the hold has ended').toBe(false);
    expect((h0 - s.car.h) * DEG, 'deg turned left in 6 s').toBeGreaterThan(30); // measured 58 deg (T10: 5 deg)
  });
});

describe('S005-T12 M2: tapping the countersteer is treated like holding it', () => {
  /** Tester: a right slide set (b0 deg, 25 deg/s into it), throttle held, the left key held or tapped (0.2 s on, 0.1 s off) for 4 s. */
  function m2(kmh: number, b0: number, tap: boolean): { peak: number; other: number; spun: boolean } {
    let { s, p } = at(s15(), kmh);
    const v = s.car.v, b = -b0 / DEG;
    s = { ...s, car: { ...s.car, vx: v * Math.cos(b), vy: v * Math.sin(b), beta: b, r: 25 / DEG, t: 1 } };
    let peak = 0, other = 0, spun = false;
    for (let i = 0; i < 6 * HZ; i++) {
      const a = i < 4 * HZ && (!tap || i % 18 < 12) ? 1 : 0;
      s = tick(s, p, { left: a, throttle: 1 });
      peak = Math.max(peak, -s.car.beta * DEG);
      other = Math.max(other, s.car.beta * DEG);
      spun ||= Math.abs(s.car.beta) > SPIN;
    }
    return { peak, other, spun };
  }

  it.each([15, 25])('50 km/h, %i deg slide: taps and a held key both catch it with no spin', (b0) => {
    for (const tap of [true, false]) {
      const r = m2(50, b0, tap);
      expect(r.spun, tap ? 'taps' : 'held').toBe(false); // T10: taps spun at 15 deg
      expect(r.other, tap ? 'taps' : 'held').toBeLessThan(6); // measured 3.6 deg
    }
  });

  // At 70 km/h the catch is safe, but a key kept on for 4 s brings full left lock back with full throttle, which spins the
  // S15 even from a straight line (above); taps must never do worse than holding.
  it.each([15, 25])('70 km/h, %i deg slide: taps never do worse than a held key', (b0) => {
    const tap = m2(70, b0, true), held = m2(70, b0, false);
    if (!held.spun) {
      expect(tap.spun).toBe(false);
      expect(tap.other).toBeLessThanOrEqual(held.other + 1);
    }
  });
});

describe('S005-T12 M3: side-to-side drifts reach the other side', () => {
  // After a caught slide (60 km/h entry, right key held to the close), five ways into the other side, each coming off
  // full throttle: the throttle stays on except where the way takes it off (a 0.3 s lift, a 0.2 s brake tap). T10 let
  // only a release-and-press timed at zero slip through (round 3: the others reached at most 2 deg); before T10 every way
  // spun. Measured 50-71 deg, no spin. With the throttle fully off the S15 just grips (2.4 deg in every version).
  type Way = 'held' | 'lift' | 'feint' | 'release' | 'brake';
  function swing(way: Way): { other: number; spun: boolean } {
    let { s, p } = at(s15(), 60);
    while (Math.abs(s.car.beta) < 12 / DEG) s = tick(s, p, { left: 1, throttle: 1 });
    const s0 = Math.sign(s.car.beta);
    while (s.car.beta * s0 > 0) s = tick(s, p, { right: 1, throttle: 1 });
    let other = 0, spun = false;
    for (let i = 0; i < 3 * HZ; i++) {
      const k: Partial<InputFrame> =
        way === 'held' ? { right: 1, throttle: 1 }
        : way === 'lift' ? { right: 1, throttle: i < 18 ? 0 : 1 }
        : way === 'feint' ? (i < 12 ? { left: 1, throttle: 1 } : { right: 1, throttle: 1 })
        : way === 'release' ? (i < 6 ? { throttle: 1 } : { right: 1, throttle: 1 })
        : i < 12 ? { right: 1, brake: 1 } : { right: 1, throttle: 1 };
      s = tick(s, p, i < 1.5 * HZ ? k : {});
      other = Math.max(other, -s.car.beta * s0 * DEG);
      spun ||= Math.abs(s.car.beta) > SPIN;
    }
    return { other, spun };
  }
  it.each(['held', 'lift', 'feint', 'release', 'brake'] as const)('%s: a slide of more than 30 deg the other way, no spin', (way) => {
    const r = swing(way);
    expect(r.other).toBeGreaterThan(30);
    expect(r.spun).toBe(false);
  });
});

describe('S005-T12: the settle yaw is validated car data', () => {
  it('rejects a negative, too large or missing settle yaw', () => {
    for (const bad of [{ steerCatchSettleYaw: -0.1 }, { steerCatchSettleYaw: 6 }, { steerCatchSettleYaw: 'slow' }])
      expect(() => loadCarParams({ ...s15Json, ...bad }, 'test.json'), JSON.stringify(bad)).toThrow(DataError);
    const { steerCatchSettleYaw: _drop, ...missing } = s15Json;
    expect(() => loadCarParams(missing, 'test.json')).toThrow(/steerCatchSettleYaw/);
  });
});

describe('S005-T10/T12: the catch hold is saved state that serializes and replays exactly', () => {
  it('a state saved while catching, settling and opening continues bit-identically, and the hold ends', () => {
    let { s, p } = at(s15(), 60);
    while (Math.abs(s.car.beta) < 12 / DEG) s = tick(s, p, { left: 1, throttle: 1 });
    expect('hold' in s.car, 'no hold before the countersteer').toBe(false);
    for (let i = 0; i < 30; i++) s = tick(s, p, { right: 1 });
    expect(s.car.hold, 'the right key caught the slide').toBe(1);
    const keys = [...Array(90).fill({ right: 1 }), ...Array(120).fill({})] as Partial<InputFrame>[];
    let a = s, b: S = JSON.parse(JSON.stringify(s)) as S, released = false, opened = 0;
    for (const k of keys) {
      a = tick(a, p, k);
      b = tick(b, p, k);
      released ||= a.car.hold === 2;
      opened = Math.max(opened, a.car.holdOpen ?? 0);
      expect(hashState(b)).toBe(hashState(a));
    }
    expect(released, 'the car settled').toBe(true);
    expect(opened, 'the held key opened the cap').toBeGreaterThan(0);
    expect('hold' in a.car || 'holdOpen' in a.car, 'the hold has ended').toBe(false);
  });
});
