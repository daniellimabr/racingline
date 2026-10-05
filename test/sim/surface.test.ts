// S003-AC-11: on a track, each axle reads the grip and drag of the surface under it from the track file.
// On grass versus tarmac at the same speed and steering, grip is lower and drag higher by exactly the
// values in the file. Unit tests use stand-in lookups with the agreed shape; the Interlagos tests use
// Back End's real surfaceAt (docs/sprints/SPRINT-003/mailbox/physics-dev-to-back-end-surface-lookup.md).
import { describe, expect, it } from 'vitest';
import { createCarRegistry } from '../../src/core/car-registry.ts';
import { replay, step } from '../../src/core/sim.ts';
import type { Track } from '../../src/data/track.ts';
import { carStep, createCar, createSimParams, phys, TEST_LOT, type CarState, type SimParams } from '../../src/sim/index.ts';
import { lotSurface, trackSurface, type AxleSurface, type SurfaceAt } from '../../src/sim/surface.ts';
import { startRun } from '../../src/run.ts';
import { TRACKS } from '../../src/tracks/index.ts';
import { surfaceAt } from '../../src/tracks/surface-at.ts';
import { autopilot } from './autopilot.ts';
import { gt3, idle, KMH, s15 } from './gt3-helpers.ts';

const track: Track = TRACKS[0]!;
const grass = track.surfaces.grass!, kerb = track.surfaces.kerb!, asphalt = track.surfaces[track.road]!;
const everywhere = (name: string): SurfaceAt => () => name;
const same = (sf: { grip: number; drag: number }): AxleSurface => ({ gripF: sf.grip, gripR: sf.grip, dragF: sf.drag, dragR: sf.drag });

/** A car at speed on the straight, steering preset as by an ideal hand (no key ramp). */
function moving(p: SimParams, kmh: number, st: number): CarState {
  return { ...createCar(p), vx: kmh * KMH, v: kmh * KMH, st, gear: 3, rpm: 6000 };
}
/** One physics sub-step from `s0` on the given axle surfaces. */
function sub(s0: CarState, p: SimParams, surf: AxleSurface): CarState {
  const s = { ...s0 };
  phys(s, 1 / 600, p, surf);
  return s;
}

describe('surface grip and drag in the physics step (S003-AC-11)', () => {
  it.each([['GT3', gt3], ['S15', s15]] as const)('%s at 200 km/h straight: grass adds exactly its drag per m/s', (_n, car) => {
    const p = createSimParams(car());
    const s0 = moving(p, 200, 0), spd = Math.hypot(s0.vx, s0.vy);
    const onGrass = sub(s0, p, same(grass)), onTarmac = sub(s0, p, same(asphalt));
    expect(onGrass.axp - onTarmac.axp).toBeCloseTo(-(grass.drag - asphalt.drag) * spd, 9);
    expect(sub(s0, p, same(kerb)).axp - onTarmac.axp).toBeCloseTo(-(kerb.drag - asphalt.drag) * spd, 9);
  });

  it.each([['GT3', gt3], ['S15', s15]] as const)('%s at 200 km/h steering: grass leaves exactly its share of the grip', (_n, car) => {
    const p = createSimParams(car());
    const s0 = moving(p, 200, 0.6);
    // From straight running, the first sub-step's sideways push is the front tyre force, which scales with grip.
    const onTarmac = sub(s0, p, same(asphalt));
    expect(sub(s0, p, same(grass)).vy / onTarmac.vy).toBeCloseTo(grass.grip / asphalt.grip, 12);
    expect(sub(s0, p, same(kerb)).vy / onTarmac.vy).toBeCloseTo(kerb.grip / asphalt.grip, 12);
  });

  it('each axle uses its own surface: front on grass, rear on tarmac', () => {
    const p = createSimParams(gt3());
    const s0 = moving(p, 200, 0.6), spd = Math.hypot(s0.vx, s0.vy);
    const frontOnly: AxleSurface = { gripF: grass.grip, gripR: asphalt.grip, dragF: grass.drag, dragR: asphalt.drag };
    expect(sub(s0, p, frontOnly).vy / sub(s0, p, same(asphalt)).vy).toBeCloseTo(grass.grip, 12);
    const straight = moving(p, 200, 0);
    // Half the wheels on grass: half the grass drag.
    expect(sub(straight, p, frontOnly).axp - sub(straight, p, same(asphalt)).axp).toBeCloseTo((-grass.drag * spd) / 2, 9);
  });
});

describe('surface under each axle on a track', () => {
  it('reads the front and rear axle centres through the lookup', () => {
    const c = gt3(), seen: [number, number][] = [];
    const at: SurfaceAt = (_t, x, y) => {
      seen.push([x, y]);
      return x > 0 ? 'grass' : 'asphalt';
    };
    // Heading east from the origin: the front axle is ahead (x > 0), the rear behind.
    expect(trackSurface(track, at, c, { x: 0, y: 0, h: 0 })).toEqual({ gripF: grass.grip, gripR: 1, dragF: grass.drag, dragR: 0 });
    expect(seen[0]![0]).toBeCloseTo(c.la, 12);
    expect(seen[1]![0]).toBeCloseTo(-c.lb, 12);
    // Facing west, the rear axle is the one at x > 0.
    expect(trackSurface(track, at, c, { x: 0, y: 0, h: Math.PI })).toEqual({ gripF: 1, gripR: grass.grip, dragF: 0, dragR: grass.drag });
  });

  it('rejects a surface name the track does not define', () => {
    expect(() => trackSurface(track, everywhere('ice'), gt3(), { x: 0, y: 0, h: 0 })).toThrow(/ice/);
  });

  it('the test lot keeps its own off-lot grip and drag on both axles', () => {
    expect(lotSurface(TEST_LOT, true)).toEqual({ gripF: TEST_LOT.offGrip, gripR: TEST_LOT.offGrip, dragF: TEST_LOT.offDrag, dragR: TEST_LOT.offDrag });
    expect(lotSurface(TEST_LOT, false)).toEqual({ gripF: 1, gripR: 1, dragF: 0, dragR: 0 });
  });
});

describe('a car on Interlagos through the real run setup', () => {
  const cars = createCarRegistry([gt3(), s15()]);
  const coast = Array.from({ length: 30 }, () => idle);
  /** GT3 run from the spawn, moved `right` m to the driver's right, coasting at 200 km/h. */
  function coastFrom(right: number): { car: CarState; surfaces: string[] } {
    const run = startRun({ seed: 1, car: 'gt3', track: track.id }, cars);
    const c0 = run.state.car, x = c0.x - Math.sin(c0.h) * right, y = c0.y + Math.cos(c0.h) * right;
    let st = { ...run.state, car: { ...c0, x, y, vx: 200 * KMH, v: 200 * KMH, gear: 4, rpm: 7000 } };
    const surfaces: string[] = [];
    for (const f of coast) {
      st = step(st, f, run.params, carStep);
      surfaces.push(surfaceAt(track, st.car.x, st.car.y));
    }
    return { car: st.car, surfaces };
  }

  it('the run settings carry the real surface lookup', () => {
    expect(startRun({ seed: 1, car: 'gt3', track: track.id }, cars).params.surfaceAt).toBe(surfaceAt);
    expect(startRun({ seed: 1, car: 'gt3' }, cars).params.surfaceAt).toBeUndefined();
  });

  it('on the grass beside the start straight the car slows faster than on the road, and counts as off', () => {
    const road = coastFrom(0), grassRun = coastFrom(25);
    expect(new Set(road.surfaces)).toEqual(new Set([track.road]));
    expect(new Set(grassRun.surfaces)).toEqual(new Set(['grass']));
    expect(grassRun.car.v).toBeLessThan(road.car.v - 1);
    expect(grassRun.car.off).toBe(true);
    expect(road.car.off).toBe(false);
  });

  it('a full lap completes with surfaces on, and the same input gives exactly the same replay', () => {
    const run = startRun({ seed: 11, car: 's15-drift', track: track.id }, cars);
    const frames = autopilot(run, track, 60 * 520, 20);
    const a = replay(frames, run.state, run.params, carStep);
    expect(a.state.car.lap!.last).not.toBeNull();
    const part = frames.slice(0, 1800);
    expect(replay(part, run.state, run.params, carStep, true).hashes).toEqual(replay(part, run.state, run.params, carStep, true).hashes);
  }, 60_000);

  it('a track without a surface lookup stops with a clear error', () => {
    const p: SimParams = { ...createSimParams(gt3()), track };
    expect(() => carStep(createCar(p), idle, p, { dt: 1 / 60, substeps: 10 })).toThrow(/surface lookup/);
  });
});
