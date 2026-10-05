// S003-AC-11: on a track, each axle reads the grip and drag of the surface under it from the track file.
// On grass versus tarmac at the same speed and steering, grip is lower and drag higher by exactly the
// values in the file. Back End's surface lookup (T5) is not merged yet, so these tests use a stand-in with
// the agreed shape (docs/sprints/SPRINT-003/mailbox/physics-dev-to-back-end-surface-lookup.md).
import { describe, expect, it } from 'vitest';
import { createState, replay } from '../../src/core/sim.ts';
import { hashState } from '../../src/core/hash.ts';
import type { Track } from '../../src/data/track.ts';
import { carStep, createCar, createSimParams, phys, TEST_LOT, type CarState, type SimParams } from '../../src/sim/index.ts';
import { lotSurface, trackSurface, type AxleSurface, type SurfaceAt } from '../../src/sim/surface.ts';
import { TRACKS } from '../../src/tracks/index.ts';
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

describe('a car on a track', () => {
  const onTrack = (at?: SurfaceAt): SimParams => ({ ...createSimParams(gt3()), track, ...(at ? { surfaceAt: at } : {}) });
  const start = (p: SimParams) => createState(1, { ...createCar(p), x: track.spawn.x, y: track.spawn.y, h: track.spawn.h, vx: 200 * KMH, v: 200 * KMH, gear: 4, rpm: 7000 });
  const coast = Array.from({ length: 60 }, () => idle);

  it('slows faster on grass than on tarmac, and the grass marks the car off the track', () => {
    const g = replay(coast, start(onTrack(everywhere('grass'))), onTrack(everywhere('grass')), carStep).state.car;
    const t = replay(coast, start(onTrack(everywhere(track.road))), onTrack(everywhere(track.road)), carStep).state.car;
    expect(g.v).toBeLessThan(t.v);
    expect(g.off).toBe(true);
    expect(t.off).toBe(false);
  });

  it('the same input gives exactly the same replay', () => {
    const at: SurfaceAt = (_t, x) => (Math.floor(x / 5) % 2 === 0 ? 'grass' : 'kerb');
    const p = onTrack(at), log = Array.from({ length: 240 }, (_, i) => ({ ...idle, throttle: i < 120 ? 1 : 0, left: i % 50 < 20 ? 1 : 0 }));
    const a = replay(log, start(p), p, carStep, true), b = replay(log, start(p), p, carStep, true);
    expect(b.hashes).toEqual(a.hashes);
    expect(hashState(b.state)).toBe(hashState(a.state));
  });

  it('a track without a surface lookup stops with a clear error', () => {
    const p = onTrack();
    expect(() => carStep(start(p).car, idle, p, { dt: 1 / 60, substeps: 10 })).toThrow(/surface lookup/);
  });
});
