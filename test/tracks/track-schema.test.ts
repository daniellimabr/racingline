// S003-AC-05: the Interlagos track file is valid; broken track files are rejected with a clear error.
// Format agreed in docs/sprints/SPRINT-003/mailbox/database-to-{back-end,front-end}-track-format.md (ADR-005).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DataError } from '../../src/data/check.ts';
import { OSM_CREDIT, parseTrack, validateTrack, type Track } from '../../src/data/track.ts';
import { TRACKS } from '../../src/tracks/index.ts';

const FILE = new URL('../../src/tracks/interlagos.json', import.meta.url);
const raw = (): Record<string, unknown> => JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, unknown>;

/** A 100 m x 40 m loop, 10 m wide, driven clockwise on screen (y grows south); it starts mid-way along the top. */
const L0 = { s: 0, a: [0, -5], b: [0, 5] }; // heading east, so the driver's left (a) is north
const L30 = { s: 30, a: [30, -5], b: [30, 5] };
const L150 = { s: 150, a: [10, 45], b: [10, 35] }; // heading west, so the driver's left is south
const square = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: 'track',
  v: 1,
  id: 'box',
  name: 'Box',
  credit: OSM_CREDIT,
  source: { osm: 'relation/1', timestamp: '2026-10-05T00:00:00Z', license: 'ODbL-1.0' },
  estimates: { width: 'constant estimate' },
  length: 280,
  points: [[0, 0, 10], [60, 0, 10], [60, 40, 10], [-40, 40, 10], [-40, 0, 10]],
  startLine: L0,
  sectorLines: [L0, L30, L150],
  surfaces: { asphalt: { grip: 1, drag: 0 }, kerb: { grip: 0.9, drag: 0.2 }, grass: { grip: 0.55, drag: 0.8 } },
  road: 'asphalt',
  verge: [{ surface: 'kerb', width: 1 }],
  outside: 'grass',
  spawn: { x: -20, y: 0, h: 0 },
  ...over,
});

const errorsOf = (v: unknown) => {
  const r = validateTrack(v);
  if (r.ok) throw new Error('expected the track to be rejected');
  return r.errors;
};

describe('interlagos.json (S003-AC-05)', () => {
  it('loads and is valid', () => {
    const r = validateTrack(raw());
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it('is the track the game registers, with the OpenStreetMap credit', () => {
    const t: Track | undefined = TRACKS.find((x) => x.id === 'interlagos');
    expect(t?.name).toBe('Interlagos');
    expect(t?.credit).toBe('© OpenStreetMap contributors');
  });

  it('matches the real lap length (4.309 km) within 10 m and has 3 sectors', () => {
    const t = parseTrack(raw(), 'interlagos.json');
    expect(Math.abs(t.length - 4309)).toBeLessThan(10);
    expect(t.sectorLines.map((l) => l.s)).toEqual([0, expect.any(Number), expect.any(Number)]);
    expect(t.points.every(([, , w]) => w >= 12 && w <= 15)).toBe(true);
  });

  it('round-trips through JSON (write -> read -> equal)', () => {
    const t = parseTrack(raw(), 'interlagos.json');
    expect(parseTrack(JSON.parse(JSON.stringify(t)), 'copy.json')).toEqual(t);
  });
});

describe('validateTrack rejects broken files with a clear error (S003-AC-05)', () => {
  it('accepts the small valid sample', () => {
    const r = validateTrack(square());
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it('rejects a missing start line', () => {
    const { startLine: _, ...rest } = square();
    expect(errorsOf(rest)).toEqual([{ path: '$.startLine', reason: 'missing field' }]);
  });

  it.each([0, 2])('rejects %i sector lines (3 are needed)', (n) => {
    const lines = (square().sectorLines as unknown[]).slice(0, n);
    expect(errorsOf(square({ sectorLines: lines }))).toEqual([
      { path: '$.sectorLines', reason: `expected exactly 3 sector lines, got ${n}` },
    ]);
  });

  it.each([0, -3])('rejects a non-positive width (%d)', (w) => {
    const points = [[0, 0, 10], [60, 0, w], [60, 40, 10], [-40, 40, 10], [-40, 0, 10]];
    expect(errorsOf(square({ points }))).toEqual([{ path: '$.points[1][2]', reason: `expected a width above 0 m, got ${w}` }]);
  });

  it.each([NaN, Infinity, '7', null])('rejects a non-finite point coordinate (%s)', (x) => {
    const points = [[0, 0, 10], [60, 0, 10], [x, 40, 10], [-40, 40, 10], [-40, 0, 10]];
    const errors = errorsOf(square({ points }));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe('$.points[2][0]');
    expect(errors[0]?.reason).toMatch(/expected a (finite )?number/);
  });

  it('rejects an unknown surface and lists the known ones', () => {
    expect(errorsOf(square({ outside: 'lava', verge: [{ surface: 'gravel', width: 2 }] }))).toEqual([
      { path: '$.verge[0].surface', reason: 'unknown surface "gravel" (known: asphalt, kerb, grass)' },
      { path: '$.outside', reason: 'unknown surface "lava" (known: asphalt, kerb, grass)' },
    ]);
  });

  it('throws a DataError naming the file, the field and the reason', () => {
    const { startLine: _, ...rest } = square();
    expect(() => parseTrack(rest, 'box.json')).toThrow(DataError);
    expect(() => parseTrack(rest, 'box.json')).toThrow(/Track box\.json is invalid[\s\S]*\$\.startLine: missing field/);
  });

  it.each([
    ['a wrong version', { v: 2 }, '$.v'],
    ['a stated length far from the points', { length: 250 }, '$.length'],
    ['fewer than 3 points', { points: [[0, 0, 10], [1, 0, 10]] }, '$.points'],
    ['a repeated point (zero-length piece)', { points: [[0, 0, 10], [60, 0, 10], [60, 0, 10], [-40, 40, 10], [-40, 0, 10]] }, '$.points[2]'],
    ['a point with 2 numbers', { points: [[0, 0, 10], [60, 0], [60, 40, 10], [-40, 40, 10], [-40, 0, 10]] }, '$.points[1]'],
    ['a start line not at distance 0', { startLine: { s: 5, a: [5, -5], b: [5, 5] } }, '$.startLine.s'],
    ['a line with equal ends', { startLine: { s: 0, a: [0, 5], b: [0, 5] } }, '$.startLine'],
    ['a line drawn right to left', { startLine: { s: 0, a: [0, 5], b: [0, -5] } }, '$.startLine'],
    ['a line away from its distance', { sectorLines: [L0, { s: 30, a: [50, -5], b: [50, 5] }, L150] }, '$.sectorLines[1]'],
    ['sector lines out of order', { sectorLines: [L0, L150, L30] }, '$.sectorLines[2].s'],
    ['a first sector line away from the start line', { sectorLines: [{ s: 10, a: [10, -5], b: [10, 5] }, L30, L150] }, '$.sectorLines[0].s'],
    ['a line beyond the lap length', { sectorLines: [L0, L30, { s: 280, a: [0, -5], b: [0, 5] }] }, '$.sectorLines[2].s'],
    ['a spawn off the road', { spawn: { x: -20, y: 20, h: 0 } }, '$.spawn'],
    ['a negative grip', { surfaces: { asphalt: { grip: -1, drag: 0 }, kerb: { grip: 0.9, drag: 0.2 }, grass: { grip: 0.5, drag: 1 } } }, '$.surfaces.asphalt.grip'],
    ['a credit without OpenStreetMap', { credit: 'map data' }, '$.credit'],
    ['an unknown field', { colour: 'red' }, '$.colour'],
  ])('rejects %s', (_, over, path) => {
    expect(errorsOf(square(over)).map((e) => e.path)).toEqual([path]);
  });

  it('does not change the input', () => {
    const input = square();
    const before = JSON.stringify(input);
    parseTrack(input, 'box.json');
    expect(JSON.stringify(input)).toBe(before);
  });
});
