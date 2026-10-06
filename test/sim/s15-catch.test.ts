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
// Main Dev 2026-10-06 picked option 1B: while the car slides (body slip above steerSlideBeta or rear slip past the
// tyre peak) a released wheel returns to centre at steerSlideShare of the key speed, so the release now catches it.
import { describe, expect, it } from 'vitest';
import { createState, step } from '../../src/core/sim.ts';
import { carStep, createCar, type CarParams, type SimParams } from '../../src/sim/index.ts';
import type { InputFrame } from '../../src/core/input-frame.ts';
import { idle, KMH, open, s15 } from './gt3-helpers.ts';

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
  const OPP_YAW: Record<Entry, number> = { '60 throttle': 46, '90 set 30': 43, '120 set 20': 50, '150 set 20': 43 };
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

  it.each(entries)('%s: countersteer held 0.5 and 1 s too long spins even with an instant centring (driver timing)', (e) => {
    for (const late of [0.5, 1]) {
      expect(keyCatch(e, late).spun, `${late} s late`).toBe(true);
      expect(keyCatch(e, late, true).spun, `${late} s late, centred at once`).toBe(true);
    }
  });
});
