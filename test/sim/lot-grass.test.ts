// S003-T12 (Daniel, 2026-10-05, option 2A): off the test lot's pavement the car meets the same grass as at
// Interlagos, so a car that leaves the lot slows like one on Interlagos grass instead of stopping dead.
import { describe, expect, it } from 'vitest';
import { createCarRegistry } from '../../src/core/car-registry.ts';
import { step } from '../../src/core/sim.ts';
import type { Track } from '../../src/data/track.ts';
import { carStep, createCar, createSimParams, TEST_LOT, type CarState, type SimParams } from '../../src/sim/index.ts';
import { startRun } from '../../src/run.ts';
import { TRACKS } from '../../src/tracks/index.ts';
import { gt3, idle, KMH, s15 } from './gt3-helpers.ts';

const track: Track = TRACKS[0]!;
const grass = track.surfaces[track.outside]!;
const TICK = { dt: 1 / 60, substeps: 10 };

/** Coasts in neutral-free idle until the car is below 1 km/h or `ticks` run out; returns distance and car. */
function coast(s0: CarState, p: SimParams, ticks: number): { dist: number; car: CarState } {
  let s = s0, dist = 0;
  for (let i = 0; i < ticks && s.v > KMH; i++) {
    const n = carStep(s, idle, p, TICK);
    dist += Math.hypot(n.x - s.x, n.y - s.y);
    s = n;
  }
  return { dist, car: s };
}

/** GT3 just past the lot's east edge, heading further out at `kmh`. */
function offLot(kmh: number): { s: CarState; p: SimParams } {
  const p = createSimParams(gt3());
  const s = { ...createCar(p), x: (TEST_LOT.x1 + 50) / TEST_LOT.scale, y: 900 / TEST_LOT.scale, h: 0, vx: kmh * KMH, v: kmh * KMH, gear: 3, rpm: 6000, off: true };
  return { s, p };
}

describe('the test lot outside is Interlagos grass (S003-T12)', () => {
  it('uses exactly the grip and drag of the track grass', () => {
    expect(track.outside).toBe('grass');
    expect(TEST_LOT.offGrip).toBe(grass.grip);
    expect(TEST_LOT.offDrag).toBe(grass.drag);
  });

  it('a car coasting off the lot from 150 km/h no longer stops within 50 m', () => {
    const { s, p } = offLot(150);
    const r = coast(s, p, 60 * 4);
    expect(r.car.off).toBe(true);
    expect(r.dist).toBeGreaterThan(100);
    expect(r.car.v).toBeGreaterThan(50 * KMH);
  });

  it('slows exactly like the same car coasting on Interlagos grass', () => {
    const cars = createCarRegistry([gt3(), s15()]);
    const run = startRun({ seed: 1, car: 'gt3', track: track.id }, cars);
    const onTrack: SimParams = { ...run.params, surfaceAt: () => 'grass' };
    const { s, p } = offLot(150);
    let lot = s, tr = { ...run.state, car: { ...run.state.car, h: 0, vx: s.vx, v: s.v, gear: 3, rpm: 6000 } };
    for (let i = 0; i < 120; i++) {
      lot = carStep(lot, idle, p, TICK);
      tr = step(tr, idle, onTrack, carStep);
    }
    expect(lot.v).toBeCloseTo(tr.car.v, 9);
  });
});
