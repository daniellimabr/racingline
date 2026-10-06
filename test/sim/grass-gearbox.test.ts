// S003-T10 (Daniel option B): on Interlagos grass the rear wheels spin and the engine sat on the rev limiter in
// 1st, because the automatic gearbox only looks at road speed. While the rear axle is on a surface that adds
// drag (grass), the box now also upshifts when the limiter cuts and holds its gear while the rear wheels spin.
// Kerbs and tarmac add no drag, so there the box behaves exactly as before (locked by hashes taken before the change).
import { describe, expect, it } from 'vitest';
import { createCarRegistry } from '../../src/core/car-registry.ts';
import { hashState } from '../../src/core/hash.ts';
import { step } from '../../src/core/sim.ts';
import type { SurfaceAt } from '../../src/sim/surface.ts';
import { carStep } from '../../src/sim/index.ts';
import { startRun } from '../../src/run.ts';
import { TRACKS } from '../../src/tracks/index.ts';
import { gt3, idle, KMH, s15 } from './gt3-helpers.ts';

const track = TRACKS[0]!;
const cars = createCarRegistry([gt3(), s15()]);
const everywhere = (name: string): SurfaceAt => () => name;

/** Full throttle from the Interlagos spawn with the automatic box, every point of the world on one surface. */
function launch(car: string, surface: string, secs: number) {
  const run = startRun({ seed: 1, car, track: track.id }, cars);
  const params = { ...run.params, surfaceAt: everywhere(surface) };
  let s = run.state;
  const kmh: number[] = [], gears: number[] = [];
  for (let i = 1; i <= secs * 60; i++) {
    s = step(s, { ...idle, throttle: 1 }, params, carStep);
    kmh.push(s.car.v / KMH);
    gears.push(s.car.gear);
  }
  return { kmh, gears, hash: hashState(s) };
}
const at = (kmh: number[], secs: number) => kmh[secs * 60 - 1]!;

describe('automatic gearbox on grass (S003-T10, Daniel option B)', () => {
  it.each([['S15', 's15-drift', 70], ['GT3', 'gt3', 140]] as const)(
    '%s at full throttle from a stop on grass leaves 1st and keeps accelerating',
    (_n, car, minKmh) => {
      const r = launch(car, 'grass', 30);
      expect(Math.max(...r.gears)).toBeGreaterThan(0);
      expect(at(r.kmh, 30)).toBeGreaterThan(at(r.kmh, 20));
      expect(at(r.kmh, 30)).toBeGreaterThan(minKmh);
    },
  );

  // Hashes and gear changes recorded with the gearbox before S003-T10: kerb and tarmac must not change.
  it.each([
    ['s15-drift', 'kerb'],
    ['s15-drift', track.road],
    ['gt3', 'kerb'],
    ['gt3', track.road],
  ] as const)('%s on %s shifts exactly as before', (car, surface) => {
    const r = launch(car, surface, 30);
    const shifts = r.gears.flatMap((g, i) => (g !== (r.gears[i - 1] ?? 0) ? [`${i}:${g + 1}`] : []));
    expect({ hash: r.hash, shifts }).toEqual(BEFORE[`${car}/${surface}`]);
  });

  it('S15 on tarmac still reaches 100 km/h in 7.77 s', () => {
    const r = launch('s15-drift', track.road, 10);
    expect((r.kmh.findIndex((v) => v >= 100) + 1) / 60).toBeCloseTo(7.77, 2);
  });
});

// Tick:gear of every shift in 30 s, and the final state hash, from the gearbox at sprint head 3b3adf9.
const BEFORE: Record<string, { hash: string; shifts: string[] }> = {
  's15-drift/kerb': { hash: '4ecff205d962177b', shifts: ['388:2', '555:3', '939:4', '1514:5'] },
  's15-drift/asphalt': { hash: 'f09ed02b91a171e8', shifts: ['284:2', '436:3', '809:4', '1372:5'] },
  'gt3/kerb': { hash: '6df46b5ce94efc68', shifts: ['223:2', '325:3', '446:4', '636:5', '982:6'] },
  'gt3/asphalt': { hash: 'ff50e4f4e108e1d6', shifts: ['210:2', '309:3', '429:4', '619:5', '964:6'] },
};
