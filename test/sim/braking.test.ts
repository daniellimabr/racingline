// S004-AC-04: straight braking from 200 km/h to a stop on Interlagos asphalt, full pedal, both cars.
// S004-T3 finding: braking on Interlagos asphalt is the same as on the test lot to the last digit (asphalt
// grip 1, no extra drag, the same as the lot pavement). Interlagos feels stronger because the car arrives
// faster: from 200 km/h the S15 averages 0.92 g against 0.85 g from 100 km/h (air drag), and the GT3 1.49 g
// against 1.29 g (downforce and drag). The rest is the view, not the physics.
// Recorded before / after S004-T3 (mean over the whole stop, including the 0.9 s brake pedal travel):
//   S15 200-0: 0.92 g, peak 1.01 g, 178.8 m  ->  0.86 g, peak 0.95 g, 188.9 m (tyre load sensitivity 0.5:
//              the front gains less grip from the forward weight shift). Grip 0.99 caps it near 0.95 g.
//   GT3 200-0: 1.49 g, peak 1.86 g, 109.4 m  ->  unchanged (target 1.4-1.7 g).
// S004-T11 (GT3 tyre load sensitivity 0.3, which keeps it straight when braking at speed): GT3 200-0 109.4 m -> 113.7 m
//   (lot script: 1.48 -> 1.40 g, peak 1.88 -> 1.83 g); the loaded front has a little less grip, so it locks sooner.
import { describe, expect, it } from 'vitest';
import { createCarRegistry } from '../../src/core/car-registry.ts';
import { createState } from '../../src/core/sim.ts';
import { carStep, createCar, trackSurface, type CarState, type SimParams } from '../../src/sim/index.ts';
import { startRun } from '../../src/run.ts';
import { gt3, idle, KMH, open, s15 } from './gt3-helpers.ts';

const G = 9.81, TICK = { dt: 1 / 60, substeps: 10 };

interface Stop { meanG: number; peakG: number; dist: number; gripSeen: Set<number>; lockS: number; time: number }

/** Full brake from `kmh` straight ahead until stopped. */
function stop(p: SimParams, s0: CarState, kmh: number): Stop {
  let s: CarState = { ...s0, vx: kmh * KMH, v: kmh * KMH, gear: 4, rpm: 6000 };
  let t = 0, peak = 0, dist = 0, lock = 0;
  const gripSeen = new Set<number>();
  while (s.v > 0.3) {
    if (t > 30 * 60) throw new Error(`${p.car.id} never stopped`);
    const n = carStep(s, { ...idle, brake: 1 }, p, TICK);
    peak = Math.max(peak, (s.v - n.v) * 60);
    dist += Math.hypot(n.x - s.x, n.y - s.y);
    if (p.track && p.surfaceAt) { const a = trackSurface(p.track, p.surfaceAt, p.car, n); gripSeen.add(a.gripF).add(a.gripR); }
    s = n;
    t++;
    if (s.lockF) lock++;
  }
  return { meanG: (kmh * KMH) / (t / 60) / G, peakG: peak / G, dist, gripSeen, lockS: lock / 60, time: t / 60 };
}

const onTrack = (car: typeof s15): Stop => {
  const c = car(), run = startRun({ seed: 1, car: c.id, track: 'interlagos' }, createCarRegistry([c]));
  return stop(run.params, run.state.car, 200);
};
const onLot = (car: typeof s15): Stop => { const p = open(car()); return stop(p, createState(1, createCar(p)).car, 200); };

describe('braking from 200 km/h on Interlagos asphalt (S004-AC-04)', () => {
  it.each([['S15', s15], ['GT3', gt3]] as const)('%s brakes exactly as on the test lot, all on asphalt', (_n, car) => {
    const t = onTrack(car), l = onLot(car);
    expect([...t.gripSeen]).toEqual([1]);
    expect(t.meanG).toBe(l.meanG);
    expect(t.dist).toBeCloseTo(l.dist, 9);
  });

  it('S15: about 0.86 g over the stop, peak about 0.95 g (grip 0.99)', () => {
    const t = onTrack(s15);
    expect(t.meanG).toBeCloseTo(0.86, 1);
    expect(t.peakG).toBeGreaterThan(0.9);
    expect(t.peakG).toBeLessThan(1.0);
  });

  it('GT3: 1.4-1.7 g over the stop, with downforce at speed', () => {
    const t = onTrack(gt3);
    expect(t.meanG).toBeGreaterThan(1.4);
    expect(t.meanG).toBeLessThan(1.7);
    expect(t.dist).toBeCloseTo(113.7, 0); // S004-T11: was 109.4 m before GT3 load sensitivity 0.3
  });
});

// S005-AC-08: share of a full stop from 200 km/h with the front wheels locked (test lot, full pedal, no ABS).
// S005-T3 measured (docs/sprints/SPRINT-005/mailbox/physics-dev-to-main-dev-slides.md): S15 5.8 s of 6.6 s (88%),
// GT3 3.2 s of 4.0 s (80%). Cause: at full pedal the front brakes ask for more than the front tyres can give at every
// speed (S15 7.0 against 5.8 m/s2; GT3 12.0 against 10.4 m/s2 at 160 km/h falling to 8.3 m/s2 near the stop as the
// downforce goes), and the pedal reaches full in 0.9 s; it is the same on any car without ABS, so it is not a
// physics fault. With a full-pedal force at or below the front grip the fronts never lock (S15 brakeDecel 8).
// What the model simplifies: a locked tyre keeps 98% of its peak grip (brakeLockMargin), so locking costs no
// stopping distance (S15 locked 189.7 m against 197.1 m unlocked with brakeDecel 8). The ABS aid stays postponed.
describe('front wheel lock in a full stop from 200 km/h (S005-AC-08)', () => {
  it.each([['S15', s15, 0.88], ['GT3', gt3, 0.8]] as const)('%s: front wheels locked for about %s of the stop', (_n, car, share) => {
    const l = onLot(car);
    expect(l.lockS / l.time).toBeCloseTo(share, 1);
  });

  it('the cause is the full-pedal brake force above the front grip: S15 with a full pedal of 8 m/s2 never locks', () => {
    const p = open({ ...s15(), brakeDecel: 8 }), l = stop(p, createState(1, createCar(p)).car, 200), base = onLot(s15);
    expect(l.lockS).toBe(0);
    expect(l.dist, 'locking costs no distance in this model').toBeGreaterThan(base.dist);
  });
});
