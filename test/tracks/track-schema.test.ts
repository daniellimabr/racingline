// S003-AC-05, S004-AC-07: the Interlagos track file is valid; broken track files are rejected with a clear error.
// Format agreed in docs/sprints/SPRINT-003/mailbox/database-to-{back-end,front-end}-track-format.md (ADR-005);
// apexKerbs and brakePoints in docs/sprints/SPRINT-004/mailbox/database-to-front-end-track-fields.md.
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
  });

  it('is 26 m wide everywhere and its start and sector lines span the full width (S004-AC-07)', () => {
    const t = parseTrack(raw(), 'interlagos.json');
    expect(t.points.every(([, , w]) => w === 26)).toBe(true);
    for (const l of [t.startLine, ...t.sectorLines]) expect(Math.hypot(l.a[0] - l.b[0], l.a[1] - l.b[1])).toBeCloseTo(26, 1);
  });

  it('has a straight Reta Oposta: every point between its ends is within 0.5 m of the line, with no kink at the joins (S004-AC-07)', () => {
    const pts = parseTrack(raw(), 'interlagos.json').points;
    // The ends of the map way named "Reta Oposta" (kept as they are by the converter).
    const i = pts.findIndex((p) => p[0] === 463.25 && p[1] === 218.13);
    const j = pts.findIndex((p) => p[0] === 614.91 && p[1] === -345.78);
    expect(i).toBeGreaterThan(0);
    expect(j - i).toBeGreaterThanOrEqual(10);
    const [ax, ay] = pts[i]!, [bx, by] = pts[j]!, len = Math.hypot(bx - ax, by - ay);
    for (const p of pts.slice(i + 1, j)) expect(Math.abs(((p[0] - ax) * (by - ay) - (p[1] - ay) * (bx - ax)) / len)).toBeLessThan(0.5);
    const heading = (k: number): number => Math.atan2(pts[k + 1]![1] - pts[k]![1], pts[k + 1]![0] - pts[k]![0]);
    const turn = (k: number): number => Math.abs(((heading(k) - heading(k - 1) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * (180 / Math.PI);
    expect(turn(i)).toBeLessThan(5); // where Curva do Sol hands over to the straight
    expect(turn(j)).toBeLessThan(5); // where the straight hands over to Descida do Lago
    for (let k = i + 1; k < j; k++) expect(turn(k)).toBeLessThan(0.1);
  });

  it('has apex kerbs on the inside of the corners and named braking points (S004-AC-07)', () => {
    const t = parseTrack(raw(), 'interlagos.json');
    expect(t.apexKerbs.length).toBeGreaterThanOrEqual(10);
    expect(t.apexKerbs.every((k) => k.width >= 2 && k.width <= 3 && k.to - k.from >= 20 && k.to - k.from <= 80)).toBe(true);
    // S do Senna turns left first, then right.
    const senna = t.apexKerbs.filter((k) => k.to > 300 && k.from < 520);
    expect(senna.map((k) => k.side)).toEqual(['left', 'right']);
    const names = t.brakePoints.map((b) => b.name);
    expect(names).toEqual(expect.arrayContaining(['S do Senna', 'Descida do Lago', 'Junção']));
    expect(new Set(names).size).toBe(names.length);
    expect(t.estimates.apexKerbs).toMatch(/curvature/);
    expect(t.estimates.brakePoints).toMatch(/brak/);
  });

  it('round-trips through JSON (write -> read -> equal)', () => {
    const t = parseTrack(raw(), 'interlagos.json');
    expect(parseTrack(JSON.parse(JSON.stringify(t)), 'copy.json')).toEqual(t);
  });
});

describe('apex kerbs and braking points (S004-AC-07)', () => {
  const kerbs = [
    { from: 20, to: 50, side: 'right', width: 2 },
    { from: 30, to: 60, side: 'left', width: 2.5 },
  ];
  const brakes = [{ s: 40, name: 'Box One' }, { s: 190, name: 'Box Two' }];

  it('accepts valid fields and keeps them as they are', () => {
    const t = parseTrack(square({ apexKerbs: kerbs, brakePoints: brakes }), 'box.json');
    expect(t.apexKerbs).toEqual(kerbs);
    expect(t.brakePoints).toEqual(brakes);
  });

  it('treats both fields as optional (an older file without them is still valid) and fills them with empty lists', () => {
    const input = square();
    const t = parseTrack(input, 'box.json');
    expect(t.apexKerbs).toEqual([]);
    expect(t.brakePoints).toEqual([]);
    expect(input).not.toHaveProperty('apexKerbs');
  });

  const kerb = (over: Record<string, unknown>): Record<string, unknown> => ({ apexKerbs: [{ ...kerbs[0], ...over }] });
  it.each([
    ['a kerb list that is not a list', { apexKerbs: {} }, '$.apexKerbs', 'expected an array, got a object'],
    ['a kerb that ends before it starts', kerb({ from: 50, to: 20 }), '$.apexKerbs[0].to', 'expected a distance above from (50), got 20'],
    ['a kerb of zero length', kerb({ to: 20 }), '$.apexKerbs[0].to', 'expected a distance above from (20), got 20'],
    ['a kerb beyond the lap length', kerb({ to: 300 }), '$.apexKerbs[0].to', 'expected a distance up to the lap length 280 m, got 300'],
    ['a negative kerb start', kerb({ from: -1 }), '$.apexKerbs[0].from', 'expected a value >= 0, got -1'],
    ['a kerb on an unknown side', kerb({ side: 'inside' }), '$.apexKerbs[0].side', 'expected "left" or "right" (in the driving direction), got "inside"'],
    ['a kerb width of 0', kerb({ width: 0 }), '$.apexKerbs[0].width', 'expected a width above 0 m, got 0'],
    ['a kerb width over 10 m', kerb({ width: 12 }), '$.apexKerbs[0].width', 'expected a value in 0..10, got 12'],
    ['a kerb with an unknown field', kerb({ colour: 'red' }), '$.apexKerbs[0].colour', 'unknown field'],
    ['a kerb without a side', { apexKerbs: [{ from: 1, to: 2, width: 2 }] }, '$.apexKerbs[0].side', 'missing field'],
    ['kerbs out of order', { apexKerbs: [kerbs[1], kerbs[0]] }, '$.apexKerbs[1].from', 'expected kerbs in driving order (from at least 30), got 20'],
    ['overlapping kerbs on the same side', { apexKerbs: [kerbs[0], { ...kerbs[0], from: 40, to: 70 }] }, '$.apexKerbs[1]', 'overlaps kerb 0 on the right side (20..50 m)'],
    ['kerbs on a track with no "kerb" surface', { apexKerbs: kerbs, surfaces: { asphalt: { grip: 1, drag: 0 }, grass: { grip: 0.5, drag: 1 } }, verge: [{ surface: 'grass', width: 1 }] }, '$.apexKerbs', 'apex kerbs need a surface named "kerb" (known: asphalt, grass)'],
    ['a braking point list that is not a list', { brakePoints: 'many' }, '$.brakePoints', 'expected an array, got "many"'],
    ['a braking point at the lap length', { brakePoints: [{ s: 280, name: 'X' }] }, '$.brakePoints[0].s', 'expected a distance below the lap length 280 m, got 280'],
    ['a negative braking point', { brakePoints: [{ s: -5, name: 'X' }] }, '$.brakePoints[0].s', 'expected a value >= 0, got -5'],
    ['a braking point with an empty name', { brakePoints: [{ s: 5, name: '' }] }, '$.brakePoints[0].name', 'expected a non-empty string'],
    ['a braking point without a name', { brakePoints: [{ s: 5 }] }, '$.brakePoints[0].name', 'missing field'],
    ['braking points out of order', { brakePoints: [brakes[1], brakes[0]] }, '$.brakePoints[1].s', 'expected a distance above 190 (braking points in driving order), got 40'],
    ['two braking points at the same place', { brakePoints: [brakes[0], { s: 40, name: 'Again' }] }, '$.brakePoints[1].s', 'expected a distance above 40 (braking points in driving order), got 40'],
  ])('rejects %s', (_, over, path, reason) => {
    expect(errorsOf(square(over))).toEqual([{ path, reason }]);
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
