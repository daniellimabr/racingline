// S005-AC-01..03 (Daniel 2026-10-06): with no steering key pressed the steering returns to centre slowly, like a
// real wheel pulled back by caster and the tyres' self-aligning torque: stronger with speed and front grip,
// weaker when the front tyres slide past their peak, nothing when parked. The return is driven by the front
// axle's side force and slip (car data steerCentreGain, steerCasterShare, steerTrailFade), never a fixed rate.
// Protocol: the car rolls straight at the speed (automatic-box gear), an ideal hand holds the steering at st0 for
// HOLD_S with the throttle holding speed, then lets go; the throttle keeps holding speed while the wheel returns.
import { describe, expect, it } from 'vitest';
import { createState, step, type SimState } from '../../src/core/sim.ts';
import type { InputFrame } from '../../src/core/input-frame.ts';
import { carStep, createCar, loadCarParams, steerLockTime, type CarParams, type CarState, type SimParams } from '../../src/sim/index.ts';
import { DataError } from '../../src/data/check.ts';
import { steer } from '../../src/sim/physics.ts';
import gt3Json from '../../src/cars/gt3.json';
import s15Json from '../../src/cars/s15-drift.json';
import { gt3, idle, KMH, open, s15 } from './gt3-helpers.ts';

type S = SimState<CarState>;
const HZ = 60, HOLD_S = 1, CENTRE = 0.02;
// Band Main Dev set from the measured times (docs/sprints/SPRINT-005/mailbox/physics-dev-to-main-dev-centring.md):
// from full lock at 100 km/h on asphalt the wheel is back within 0.02 of centre in this many seconds.
const BAND_100: Record<string, [number, number]> = { 's15-drift': [1.5, 3.5], gt3: [1.5, 3.5] };
const cars = [['S15', s15], ['GT3', gt3]] as const;
const tick = (s: S, p: SimParams, k: Partial<InputFrame>): S => step(s, { ...idle, ...k }, p, carStep);

/** Straight ahead at `kmh` in the gear the automatic box would hold (0 = parked). */
function at(c: CarParams, kmh: number): { s: S; p: SimParams } {
  const p = open(c), v = kmh * KMH;
  const rpm = (g: number): number => ((v / c.wheelRadius) * c.gears[g]! * c.finalDrive * 60) / (2 * Math.PI);
  let g = 0;
  while (g < c.gears.length - 1 && rpm(g) > c.autoUpRpm) g++;
  const s0 = createState(1, createCar(p));
  const car = { ...s0.car, vx: v, v, gear: g, rpm: Math.max(c.idleRpm, rpm(g)), rateR: v / c.wheelRadius, rateF: v / c.wheelRadius };
  return { s: { ...s0, car }, p };
}

/** Holds the wheel at st0, then lets go; returns the steering after each free tick (up to maxS seconds). */
function release(c: CarParams, kmh: number, st0: number, maxS = 20): { st: number[]; t: number; s: S } {
  let { s, p } = at(c, kmh);
  const v = kmh * KMH, thr = (x: S): number => (kmh > 0 && x.car.v < v ? 1 : 0);
  for (let i = 0; i < HOLD_S * HZ; i++) s = tick({ ...s, car: { ...s.car, st: st0 } }, p, { throttle: thr(s) });
  s = { ...s, car: { ...s.car, st: st0 } };
  const st: number[] = [];
  let t = Infinity;
  for (let i = 0; i < maxS * HZ; i++) {
    s = tick(s, p, { throttle: thr(s) });
    st.push(s.car.st);
    if (t === Infinity && Math.abs(s.car.st) <= CENTRE) t = (i + 1) / HZ;
  }
  return { st, t, s };
}

describe('the released wheel returns to centre slowly (S005-AC-01)', () => {
  it.each(cars)('%s: from full lock at 100 km/h, monotonic, in the set band, no overshoot', (_n, car) => {
    const c = car();
    for (const st0 of [1, -1]) {
      const { st, t } = release(c, 100, st0);
      const [lo, hi] = BAND_100[c.id]!;
      expect(t, `${st0} back within 0.02, s`).toBeGreaterThanOrEqual(lo);
      expect(t, `${st0} back within 0.02, s`).toBeLessThanOrEqual(hi);
      expect(t, 'far slower than the Sprint 003 7/s (0.15 s)').toBeGreaterThanOrEqual(1);
      let prev = Math.abs(st0);
      for (const x of st) {
        expect(Math.abs(x)).toBeLessThanOrEqual(prev); // never moves away from centre
        expect(x * st0, 'no overshoot past centre beyond 0.01').toBeGreaterThanOrEqual(-0.01);
        prev = Math.abs(x);
      }
    }
  });
});

describe('the return grows with speed and is nothing when parked (S005-AC-02)', () => {
  // S005-AC-02 as reworded by Main Dev (S005-T8, S005-T10): at 100 km/h within 0.5 s of 50 km/h; at 200 km/h no faster than the key (the
  // cap test below) and slower near centre, so key taps build up; below 3 km/h the angle moves less than 0.05 in 2 s.
  // S005-AC-02 as reworded by Main Dev (S005-T10): the full-lock return at 100 km/h is within 0.5 s of the time at 50 km/h.
  // Option 2A made 50 km/h quicker (S15 3.8 -> 2.0 s), so 100 km/h is now a little slower (full lock S15 2.17 vs 2.00 s,
  // GT3 2.08 vs 1.95 s); the same 0.5 s gap is also kept from half lock (GT3 1.77 vs 1.30 s).
  it.each(cars)('%s: the return at 100 km/h is within 0.5 s of 50 km/h, from full and half lock', (_n, car) => {
    const c = car();
    for (const st0 of [1, 0.5]) {
      const t = [50, 100].map((kmh) => release(c, kmh, st0).t);
      expect(Math.abs(t[1]! - t[0]!), `${st0}: 100 vs 50 km/h, s`).toBeLessThan(0.5);
    }
  });

  // Blind test M4: 100 ms taps every 250 ms, six times, at 200 km/h used to reach only 0.18 (S15) and 0.11 (GT3) and be
  // undone between taps. With the limit shrinking below 0.3 of steering (option 4B) they reach 0.20 and 0.16.
  it.each([['S15', s15, 0.19], ['GT3', gt3, 0.15]] as const)('%s: key taps at 200 km/h build up to at least %s, then return', (_n, car, min) => {
    const c = car();
    let { s, p } = at(c, 200);
    const v = 200 * KMH, thr = (x: S): Partial<InputFrame> => ({ throttle: x.car.v < v ? 1 : 0 });
    for (let k = 0; k < 6; k++) {
      for (let i = 0; i < 6; i++) s = tick(s, p, { ...thr(s), right: 1 });
      if (k < 5) for (let i = 0; i < 9; i++) s = tick(s, p, thr(s));
    }
    expect(s.car.st).toBeGreaterThanOrEqual(min);
    for (let i = 0; i < 3 * HZ; i++) s = tick(s, p, thr(s));
    expect(s.car.st, 'back at centre within 3 s').toBe(0);
  });

  // Blind test m1 (option m1A): above 20 km/h the released wheel always returns at least 0.1 of travel per second.
  it.each([['S15', s15, 3, 0], ['GT3', gt3, 12, 0.1]] as const)('%s: a light tap at 30 km/h does not leave a slow tail', (_n, car, ticks, left) => {
    const c = car();
    let { s, p } = at(c, 30);
    const v = 30 * KMH, thr = (x: S): Partial<InputFrame> => ({ throttle: x.car.v < v ? 1 : 0 });
    for (let i = 0; i < ticks; i++) s = tick(s, p, { ...thr(s), right: 1 });
    for (let i = 0; i < 5 * HZ; i++) s = tick(s, p, thr(s));
    expect(s.car.st, 'left after 5 s').toBeLessThanOrEqual(left); // measured S15 0 (was 0.028), GT3 0.077 (was 0.16)
  });

  it.each(cars)('%s: parked and below 3 km/h the wheel moves less than 0.05 in 2 s', (_n, car) => {
    for (const kmh of [0, 2.5]) for (const st0 of [1, -0.5]) { // S15 at exactly 3 km/h: 0.059
      const { st } = release(car(), kmh, st0, 2);
      expect(Math.abs(st[st.length - 1]! - st0), `${kmh} km/h from ${st0}`).toBeLessThan(0.05);
    }
  });
});

describe('the return is weaker while the front tyres slide (S005-AC-03)', () => {
  // S005-T8: the slide is read at the rear axle past min(steerSlideBeta, peak), so the S15 at 50 km/h full lock (rear 0.10-0.12 rad) now counts as sliding.
  const FRONT_ONLY: Record<string, string[]> = { 's15-drift': ['100/-1'], gt3: ['50/-1'] };
  /**
   * Same speed, same steering, released: the car is set with a yaw rate that puts the front slip at `k` times the
   * tyre peak (no body slip, so no countersteer lock). Returns the steering travel in the first tick, per second, and
   * whether the rear slip is past its peak (then the car counts as sliding and the slide return of S005-T3 acts).
   */
  function firstTick(c: CarParams, kmh: number, st0: number, k: number): { rate: number; rearSlides: boolean } {
    const { s, p } = at(c, kmh), V = kmh * KMH, delta = steer(c, { ...s.car, st: st0, beta: 0 }, V);
    const r = (V * Math.tan(delta - k * c.tirePeakSlip * Math.sign(st0))) / c.la;
    const after = tick({ ...s, car: { ...s.car, st: st0, r } }, p, {});
    return { rate: (Math.abs(st0) - Math.abs(after.car.st)) * HZ, rearSlides: Math.abs(Math.atan2(-c.lb * r, V)) > Math.min(c.steerSlideBeta, c.tirePeakSlip) };
  }
  /** The tyre-driven return alone (slide return off), as AC-03 compares it. */
  // S005-T10: the steering geometry return (steerGeometryGain) does not depend on the tyres, so it is off here too.
  const firstRate = (c: CarParams, kmh: number, st0: number, k: number): number => firstTick({ ...c, steerSlideShare: 0, steerGeometryGain: 0 }, kmh, st0, k).rate;

  // S005-AC-03 as amended by Main Dev (option B): sliding pulls less, except where the cap (never faster than the key)
  // holds both to the same rate. With today's data that happens only on the GT3 at 200 km/h. Amended again (S005-T3,
  // option 1B): except while the car slides, so this compares a front slide with the car itself not sliding.
  it.each(cars)('%s: a front slipping 2.5x past its peak pulls back far less than one gripping at 0.7x, unless both are capped', (_n, car) => {
    const c = car(), capped: string[] = [];
    for (const kmh of [50, 100, 200]) for (const st0 of [0.5, -1]) {
      const grip = firstRate(c, kmh, st0, 0.7), slide = firstRate(c, kmh, st0, 2.5);
      const cap = c.steerReturnMaxShare / steerLockTime(c, kmh * KMH);
      expect(grip, `${kmh} km/h ${st0} gripping returns`).toBeGreaterThan(0);
      expect(slide, `${kmh} km/h ${st0} the caster still pulls`).toBeGreaterThan(0);
      if (slide >= 0.98 * cap) { // the cap holds both: equal pull, never more when sliding
        capped.push(`${kmh}`);
        expect(slide, `${kmh} km/h ${st0} capped`).toBeLessThanOrEqual(grip * (1 + 1e-9));
        expect(grip).toBeLessThanOrEqual(cap * 1.02);
      } else {
        expect(slide, `${kmh} km/h ${st0} sliding vs gripping`).toBeLessThan(0.6 * grip);
      }
    }
    expect([...new Set(capped)], 'speeds where the cap holds both').toEqual(c.id === 'gt3' ? ['200'] : []);
  });

  // S005-T3 (option 1B): with the slide return on, the weaker sliding pull is only kept where the front slides and the
  // car does not (rear under its peak, no body slip); where the rear slides too the slide return pulls at the key speed.
  it.each(cars)('%s: a front-only slide keeps the weaker tyre pull with the slide return on', (_n, car) => {
    const c = car(), frontOnly: string[] = [];
    for (const kmh of [50, 100, 200]) for (const st0 of [0.5, -1]) {
      const on = firstTick({ ...c, steerGeometryGain: 0 }, kmh, st0, 2.5), off = firstRate(c, kmh, st0, 2.5); // tyre and slide returns only (S005-T10)
      if (on.rearSlides) expect(on.rate, `${kmh} km/h ${st0}: the rear slides too (equal where the key cap already holds)`).toBeGreaterThanOrEqual(off);
      else { frontOnly.push(`${kmh}/${st0}`); expect(on.rate, `${kmh} km/h ${st0}`).toBe(off); }
    }
    expect(frontOnly, 'speeds/steering with a front-only slide in this setup').toEqual(FRONT_ONLY[c.id]);
  });

  it('the S15 front slides at full lock from 50 km/h, and that full-lock release starts slower than half lock', () => {
    const c = s15();
    for (const kmh of [50, 100, 200]) {
      const full = release(c, kmh, 1, 0.1), half = release(c, kmh, 0.5, 0.1);
      expect(Math.abs(release(c, kmh, 1, 1 / HZ).s.car.af), `${kmh} km/h`).toBeGreaterThan(c.tirePeakSlip);
      expect(1 - full.st[5]!, `${kmh} km/h full vs half lock, first 0.1 s`).toBeLessThan(0.5 - half.st[5]!);
    }
  });

  it('less front grip pulls the wheel back more slowly (half the grip)', () => {
    // The tyre-driven return only: with half the grip the car slides at half lock, which would start the slide return (S005-T3).
    const slick = loadCarParams({ ...s15Json, grip: 0.5, steerSlideShare: 0 }, 'test.json'), base = loadCarParams({ ...s15Json, steerSlideShare: 0 }, 'test.json');
    expect(release(slick, 100, 0.5).t).toBeGreaterThan(release(base, 100, 0.5).t);
  });

  it('the return strength is read from the car file, and zero gain keeps the wheel where it is', () => {
    const off = loadCarParams({ ...s15Json, steerCentreGain: 0, steerReturnMin: 0, steerGeometryGain: 0 }, 'test.json');
    for (const x of release(off, 100, 0.5, 2).st) expect(x).toBe(0.5);
    for (const bad of [{ steerCentreGain: -1 }, { steerCasterShare: 1.5 }, { steerTrailFade: 0.5 }, { steerCentreGain: 'fast' }, { steerGeometryGain: -1 }, { steerCatchHold: 2 }, { steerReturnRampFrom: 6 }])
      expect(() => loadCarParams({ ...s15Json, ...bad }, 'test.json'), JSON.stringify(bad)).toThrow(DataError);
    const { steerCentreGain: _drop, ...missing } = s15Json;
    expect(() => loadCarParams(missing, 'test.json')).toThrow(/steerCentreGain/);
    const strong = loadCarParams({ ...s15Json, steerCentreGain: 2 * s15().steerCentreGain }, 'test.json');
    expect(release(strong, 100, 0.5).t).toBeLessThan(release(s15(), 100, 0.5).t);
  });
});

describe('the return is never quicker than the key (Main Dev option B, S005-T2)', () => {
  it.each(cars)('%s: every tick of the return moves at most steerReturnMaxShare of the key travel at that speed', (_n, car) => {
    const c = car();
    expect(c.steerReturnMaxShare).toBe(1);
    for (const kmh of [50, 100, 200]) for (const st0 of [1, 0.5, -0.5]) {
      let { s, p } = at(c, kmh);
      const v = kmh * KMH;
      for (let i = 0; i < HOLD_S * HZ; i++) s = tick({ ...s, car: { ...s.car, st: st0 } }, p, { throttle: s.car.v < v ? 1 : 0 });
      s = { ...s, car: { ...s.car, st: st0 } };
      for (let i = 0; i < 6 * HZ; i++) {
        const before = s.car;
        s = tick(s, p, { throttle: before.v < v ? 1 : 0 });
        // Tick travel against the key's travel for one tick (the speed moves a little within a tick, so a 1e-6 share of slack).
        const key = 1 / HZ / Math.min(steerLockTime(c, before.v), steerLockTime(c, s.car.v));
        expect(Math.abs(s.car.st - before.st), `${kmh} km/h from ${st0}, tick ${i}`).toBeLessThanOrEqual(key * (1 + 1e-6));
      }
    }
  });

  it('the cap does not bind at low speed, where the key is quick (even at half the key it changes nothing at 50 km/h)', () => {
    for (const [j, car] of [[s15Json, s15], [gt3Json, gt3]] as const) {
      const tight = loadCarParams({ ...j, steerReturnMaxShare: 0.5 }, 'test.json');
      for (const st0 of [1, 0.5]) expect(release(tight, 50, st0).t).toBe(release(car(), 50, st0).t);
    }
  });

  it('the cap is validated car data', () => {
    for (const bad of [{ steerReturnMaxShare: 0 }, { steerReturnMaxShare: 1.5 }, { steerReturnMaxShare: 'half' }])
      expect(() => loadCarParams({ ...s15Json, ...bad }, 'test.json'), JSON.stringify(bad)).toThrow(DataError);
  });
});

describe('while the car slides a released wheel returns at the key speed (S005-T3, Main Dev option 1B)', () => {
  /** Released at st0 with the car sliding (body slip `beta`, rad, opposite the steering is not needed): first-tick travel per second. */
  function slideRate(c: CarParams, kmh: number, st0: number, beta: number, rearSlip = 0): { rate: number; key: number } {
    const { s, p } = at(c, kmh), V = kmh * KMH, vy = V * Math.tan(beta), r = rearSlip ? (vy - V * Math.tan(rearSlip)) / c.lb : 0;
    const after = tick({ ...s, car: { ...s.car, st: st0, vx: V, vy, beta: Math.atan2(vy, V), r } }, p, {});
    // The key rate at the car's speed (forward and sideways), checked at the start and the end of the tick.
    const key = c.steerSlideShare / Math.min(steerLockTime(c, Math.hypot(V, vy)), steerLockTime(c, after.car.v));
    return { rate: (Math.abs(st0) - Math.abs(after.car.st)) * HZ, key };
  }

  it.each(cars)('%s: body slip past steerSlideBeta or rear slip past the peak: the key speed, towards centre', (_n, car) => {
    const c = car();
    for (const kmh of [60, 120, 180]) for (const st0 of [0.8, -0.6]) {
      const body = slideRate(c, kmh, st0, Math.sign(st0) * 0.3), rear = slideRate(c, kmh, st0, 0, -Math.sign(st0) * 2 * c.tirePeakSlip);
      for (const [n, x] of [['body slip', body], ['rear slip', rear]] as const) {
        expect(x.rate, `${kmh} km/h ${st0} ${n}`).toBeGreaterThan(0.9 * x.key);
        expect(x.rate, `${kmh} km/h ${st0} ${n}`).toBeLessThanOrEqual(x.key * (1 + 1e-6));
      }
    }
  });

  it('never moves the wheel past centre, and a held key still wins', () => {
    const c = s15(), { s, p } = at(c, 120), V = 120 * KMH, vy = V * Math.tan(0.3);
    let x: S = { ...s, car: { ...s.car, st: 0.05, vx: V, vy, beta: 0.3 } };
    for (let i = 0; i < 30; i++) { x = tick(x, p, {}); expect(x.car.st).toBeGreaterThanOrEqual(0); }
    const k = tick({ ...s, car: { ...s.car, st: 0.5, vx: V, vy, beta: 0.3 } }, p, { right: 1 });
    expect(k.car.st).toBeGreaterThan(0.5);
  });

  it('the slide threshold and the rate share are validated car data; share 0 turns the slide return off', () => {
    for (const bad of [{ steerSlideBeta: -0.1 }, { steerSlideBeta: 2 }, { steerSlideShare: 5 }, { steerSlideShare: 'fast' }, { steerReturnSoftSteer: 1.5 }, { steerReturnMin: -0.1 }, { steerReturnMinSpeed: 'fast' }])
      expect(() => loadCarParams({ ...s15Json, ...bad }, 'test.json'), JSON.stringify(bad)).toThrow(DataError);
    const { steerSlideBeta: _drop, ...missing } = s15Json;
    expect(() => loadCarParams(missing, 'test.json')).toThrow(/steerSlideBeta/);
    const off = loadCarParams({ ...s15Json, steerSlideShare: 0 }, 'test.json'), on = s15();
    const { s, p } = at(off, 120), V = 120 * KMH, vy = V * Math.tan(0.3), st = { ...s.car, st: 0.8, vx: V, vy, beta: 0.3 };
    const a = tick({ ...s, car: st }, p, {}), b = tick({ ...s, car: st }, open(on), {});
    expect(0.8 - a.car.st).toBeLessThan(0.8 - b.car.st);
    expect(0.8 - a.car.st, 'only the slow tyre return is left').toBeLessThan(0.2 / steerLockTime(on, V) / HZ);
  });
});

// S005-T8 (blind test M5): released from full lock in a slow tight turn the wheel used to jump (S15 1.0 to 0.42 and GT3
// 1.0 to 0.71-0.81 in 0.1 s at 12-25 km/h), because the 7-13 deg body slip of a tight turn is geometry but started the
// slide return. The slide is now read at the rear axle and needs drift speed, so the return is smooth there.
describe('no jump when a slow tight turn is released (S005-T8 M5)', () => {
  it.each(cars)('%s: from full lock at 12-40 km/h the wheel moves at most 0.12 in the first 0.1 s, towards centre', (_n, car) => {
    const c = car();
    for (const kmh of [12, 15, 20, 25, 30, 40]) {
      let { s, p } = at(c, kmh);
      const v = kmh * KMH;
      // Right key 1.5 s with a gentle ideal throttle that holds speed without wheelspin, then no keys and no pedals.
      for (let i = 0; i < 1.5 * HZ; i++) s = tick({ ...s, car: { ...s.car, t: s.car.v < v ? Math.min(1, (v - s.car.v) * 2 + 0.15) : 0 } }, p, { right: 1 });
      expect(s.car.st, `${kmh} km/h held at full lock`).toBe(1);
      let prev = 1;
      for (let i = 0; i < 6; i++) {
        s = tick(s, p, {});
        expect(s.car.st, `${kmh} km/h tick ${i}`).toBeLessThanOrEqual(prev);
        prev = s.car.st;
      }
      expect(1 - prev, `${kmh} km/h travel in the first 0.1 s`).toBeLessThanOrEqual(0.12);
    }
  });
});

// S005-T8 (blind test M5, Main Dev option 5B): below about 11 km/h the model has no slip angles, so the released wheel
// used to stay at full lock forever and the car circled. The slow branch now gives the front axle its share of the
// turn's side force, so the wheel eases back from 4 km/h up (S15 after 2 s from full lock at 4/6/8/10 km/h: 0.93/0.86/0.78/0.71).
describe('a released wheel eases back in a very slow turn (S005-T8 M5)', () => {
  it.each(cars)('%s: from full lock at 6 and 10 km/h the wheel moves towards centre, smoothly', (_n, car) => {
    const c = car();
    for (const kmh of [6, 10]) {
      let { s, p } = at(c, kmh);
      for (let i = 0; i < 1.5 * HZ; i++) s = tick({ ...s, car: { ...s.car, t: s.car.v < kmh * KMH ? 0.3 : 0 } }, p, { right: 1 });
      let prev = s.car.st;
      for (let i = 0; i < 2 * HZ; i++) {
        s = tick(s, p, {});
        expect(prev - s.car.st, `${kmh} km/h tick ${i}`).toBeGreaterThanOrEqual(0);
        expect(prev - s.car.st, `${kmh} km/h tick ${i}: no jump`).toBeLessThan(0.015); // S005-T10 (2A): 0.012 at 10 km/h, was under 0.01
        prev = s.car.st;
      }
      expect(1 - prev, `${kmh} km/h travel in 2 s`).toBeGreaterThan(0.04);
    }
  });
});

// S005-T10 (blind test round 2 M2, Main Dev option 2A): full lock released with the speed held came back only after
// S15/GT3 41 s/never at 10 km/h, 7.0/9.5 s at 20 km/h and 3.8/4.1 s at 50 km/h, with a step between 20 and 22 km/h (the
// minimum return switching on at once). The steering geometry return ramps in from 3 km/h and fades as the lock narrows.
describe('the released wheel comes back after slow corners (S005-T10, Main Dev option 2A)', () => {
  /** The tester's protocol: right key to full lock with the speed held, then no key; seconds until under 2% of lock. */
  function keyRelease(c: CarParams, kmh: number): number {
    let { s, p } = at(c, kmh);
    const v = kmh * KMH, thr = (x: S): number => (x.car.v < v ? 1 : 0);
    for (let i = 0; i < 600 && s.car.st < 1; i++) s = tick(s, p, { right: 1, throttle: thr(s) });
    for (let i = 0; i < 30 * HZ; i++) {
      s = tick(s, p, { throttle: thr(s) });
      if (Math.abs(s.car.st) < CENTRE) return (i + 1) / HZ;
    }
    return Infinity;
  }

  it.each(cars)('%s: from full lock back within about 2 s at 10-50 km/h', (_n, car) => {
    const c = car();
    for (const kmh of [10, 15, 20, 30, 40, 50]) expect(keyRelease(c, kmh), `${kmh} km/h, s`).toBeLessThanOrEqual(2.25); // measured 1.3-2.2 s
  });

  it.each(cars)('%s: no step between 15 and 25 km/h', (_n, car) => {
    const c = car();
    const t = Array.from({ length: 11 }, (_x, i) => keyRelease(c, 15 + i));
    for (let i = 1; i < t.length; i++) expect(Math.abs(t[i]! - t[i - 1]!), `${14 + i} -> ${15 + i} km/h`).toBeLessThan(0.15);
  });

  it.each([['S15', s15, 2.57], ['GT3', gt3, 3.17]] as const)('%s: 200 km/h unchanged (%s s)', (_n, car, before) => {
    expect(keyRelease(car(), 200)).toBeCloseTo(before, 1);
  });
});
