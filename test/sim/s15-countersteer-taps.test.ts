// S005-T14 (blind test round 4, M1, M2, m8): the countersteer key against the catch hold. Tester's keys on the open lot:
// W + D held until the body slip reaches the release angle, then D let go and the A key (countersteer) held, tapped or
// pressed late; throttle held (W) or lifted. Before T14 the slide return snapped every released countersteer back to
// centre within about 0.05 s, so taps never added up and spun catches that holding saved (M1); A pressed on the same
// tick as D was let go moved the wheel from full right at only the key rate, slower than letting go (M2); and the catch
// hold pinned the wheels straight whatever the keys did, so three ways into a transition ended identical (m8, accepted
// by Main Dev as is: every way still reaches a slide the other way, test/sim/s15-catch.test.ts).
import { describe, expect, it } from 'vitest';
import { createState, step } from '../../src/core/sim.ts';
import { carStep, createCar, loadCarParams, type CarParams, type SimParams } from '../../src/sim/index.ts';
import { DataError } from '../../src/data/check.ts';
import s15Json from '../../src/cars/s15-drift.json';
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

type Keys = 'hold' | [on: number, off: number];
interface Run { peak: number; spun: boolean }

/** W + D until `rel` deg of slip, D let go; A held or tapped (on/off s) from `delay` s; throttle held or lifted; 4 s. */
function release(kmh: number, rel: number, w: boolean, keys: Keys, delay = 0): Run {
  let { s, p } = at(s15(), kmh);
  for (let n = 0; Math.abs(s.car.beta) < rel / DEG; n++) {
    if (n >= 900) throw new Error(`${kmh} km/h: W + D never reached ${rel} deg`);
    s = tick(s, p, { right: 1, throttle: 1 });
  }
  let peak = 0, spun = false;
  const d0 = Math.round(delay * HZ);
  for (let i = 0; i < 4 * HZ; i++) {
    const j = i - d0;
    let a = 0;
    if (j >= 0 && keys === 'hold') a = 1;
    else if (j >= 0 && keys !== 'hold') {
      const on = Math.round(keys[0] * HZ), per = on + Math.round(keys[1] * HZ);
      a = j % per < on ? 1 : 0;
    }
    s = tick(s, p, { left: a, throttle: w ? 1 : 0 });
    peak = Math.max(peak, -s.car.beta * DEG);
    spun ||= Math.abs(s.car.beta) > SPIN;
  }
  return { peak, spun };
}

const TAPS: [number, number][] = [[0.033, 0.1], [0.05, 0.1], [0.1, 0.15], [0.1, 0.25], [0.15, 0.15], [0.2, 0.2]];

describe('S005-T14 M1: tapping the countersteer catches as well as holding it', () => {
  // Measured before T14: hold 57-60 deg, every tap pattern spun at 64-78 km/h (30 deg, throttle lifted); with W held
  // taps spun from 10 deg where holding caught at about 30 deg. Judged over the tester's 4 s of keys.
  it.each([
    [64, 30, false], [74, 30, false], [78, 30, false], [64, 20, false], [64, 20, true], [78, 20, true], [64, 10, true], [90, 10, true],
  ] as const)('%i km/h, released at %i deg, throttle held %s: no tap pattern spins where holding does not, peak within 5 deg', (kmh, rel, w) => {
    const hold = release(kmh, rel, w, 'hold');
    for (const t of TAPS) {
      const r = release(kmh, rel, w, t);
      if (!hold.spun) expect(r.spun, `taps ${t.join('/')} s`).toBe(false);
      expect(r.peak, `taps ${t.join('/')} s, peak deg (hold ${hold.peak.toFixed(1)})`).toBeLessThan(hold.peak + 5);
    }
  });
});

describe('S005-T14 M2: pressing the countersteer on the tick D is let go is never worse than pressing it later', () => {
  // Tester repro: 64 km/h, W + D to 30 deg, D let go and A pressed the same tick, W held: spun at 1.12 s; A 0.1 s later
  // caught at 61.9 deg. Throttle lifted the same-tick press was 2-6 deg bigger (59.8 against 54.2 deg at 60 km/h).
  it('tester repro: 64 km/h, W held, A on the same tick does not spin', () => {
    expect(release(64, 30, true, 'hold', 0).spun).toBe(false);
  });

  it.each([60, 64, 70, 80, 90])('%i km/h, 30 deg: the same-tick press is no worse than 0.1 s later, throttle held or lifted', (kmh) => {
    for (const w of [true, false]) {
      const now = release(kmh, 30, w, 'hold', 0), late = release(kmh, 30, w, 'hold', 0.1);
      if (!late.spun) expect(now.spun, `throttle ${w ? 'held' : 'lifted'}`).toBe(false);
      expect(now.peak, `throttle ${w ? 'held' : 'lifted'}, peak deg`).toBeLessThanOrEqual(late.peak + 0.1);
    }
  });

  it('pressing the other key moves the wheel to centre at least as fast as letting go', () => {
    let { s, p } = at(s15(), 64);
    while (Math.abs(s.car.beta) < 30 / DEG) s = tick(s, p, { right: 1, throttle: 1 });
    let a = s, b = s, ta = -1, tb = -1;
    for (let i = 0; i < 60 && (ta < 0 || tb < 0); i++) {
      a = tick(a, p, { left: 1 });
      b = tick(b, p, {});
      if (ta < 0 && a.car.st <= 0) ta = i;
      if (tb < 0 && b.car.st <= 0) tb = i;
    }
    expect(ta, 'ticks to centre pressing A').toBeGreaterThanOrEqual(0);
    expect(ta, 'ticks to centre pressing A against letting go').toBeLessThanOrEqual(tb);
  });
});

describe('S005-T14: the catch follow rate is validated car data', () => {
  it('rejects negative, too large or missing values', () => {
    for (const bad of [{ steerCatchFollow: -1 }, { steerCatchFollow: 5 }, { steerCatchFollow: 'fast' }])
      expect(() => loadCarParams({ ...s15Json, ...bad }, 'test.json'), JSON.stringify(bad)).toThrow(DataError);
    const { steerCatchFollow: _f, ...noFollow } = s15Json;
    expect(() => loadCarParams(noFollow, 'test.json')).toThrow(/steerCatchFollow/);
  });

  it('with the follow off, a released countersteer under the hold returns at the normal rate and taps still add up', () => {
    const car = { ...s15(), steerCatchFollow: 0 };
    let { s, p } = at(car, 64);
    while (Math.abs(s.car.beta) < 30 / DEG) s = tick(s, p, { right: 1, throttle: 1 });
    for (let i = 0; i < 20; i++) s = tick(s, p, { left: 1 });
    const st0 = s.car.st;
    expect(st0, 'countersteer on').toBeLessThan(-0.3);
    for (let i = 0; i < 6; i++) s = tick(s, p, {});
    expect(s.car.st, 'still countersteered 0.1 s after the release (was back at 0 before T14)').toBeLessThan(st0 + 0.15);
  });
});
