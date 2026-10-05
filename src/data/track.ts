// Track files are data (ADR-001, ADR-005): src/tracks/*.json is checked here before the game uses it,
// the same way car files are checked in car-params.ts. Shape agreed with Back End and Front End in
// docs/sprints/SPRINT-003/mailbox/database-to-{back-end,front-end}-track-format.md.
// Frame: local metres, x east, y south (screen down, same as the sim's world x, y and heading h).
import { Checker, orThrow, type Result } from './check.ts';

/** The credit the OpenStreetMap licence (ODbL) asks for wherever the track is shown (ADR-005). */
export const OSM_CREDIT = '© OpenStreetMap contributors';

export type Vec = readonly [x: number, y: number];
/** A centerline point and the full track width there, all in metres. */
export type TrackPoint = readonly [x: number, y: number, width: number];
/** A segment across the track at distance `s` along the centerline; `a` is on the driver's left, `b` on the right. */
export interface TrackLine {
  readonly s: number;
  readonly a: Vec;
  readonly b: Vec;
}
/** `grip` multiplies the car's friction; `drag` is extra drag per m/s of speed, 1/s (like the lot's offGrip/offDrag). */
export interface Surface {
  readonly grip: number;
  readonly drag: number;
}
export interface Track {
  readonly schema: 'track';
  readonly v: 1;
  readonly id: string;
  readonly name: string;
  readonly credit: string;
  readonly source: { readonly osm: string; readonly timestamp: string; readonly license: string };
  /** Which values are estimates and why (plain notes, shown to nobody, kept for reviewers). */
  readonly estimates: Readonly<Record<string, string>>;
  /** Centerline length of one lap, m. */
  readonly length: number;
  /** Closed loop in driving order; the last point joins the first (not repeated). */
  readonly points: readonly TrackPoint[];
  readonly startLine: TrackLine;
  /** Where sectors 1, 2 and 3 begin; the first sits on the start line. */
  readonly sectorLines: readonly [TrackLine, TrackLine, TrackLine];
  readonly surfaces: Readonly<Record<string, Surface>>;
  /** Surface between the edges (the track itself, for the off-track rule). */
  readonly road: string;
  /** Bands outward from each edge, same on both sides; `outside` covers everything beyond. */
  readonly verge: readonly { readonly surface: string; readonly width: number }[];
  readonly outside: string;
  /** Car start position, m, and heading, rad. */
  readonly spawn: { readonly x: number; readonly y: number; readonly h: number };
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COORD = { min: -1e5, max: 1e5 };
/** The stated length may differ from the points by rounding only. */
const LENGTH_TOLERANCE = 0.5;
const MAX_POINTS = 100_000;

export interface CenterlinePoint {
  readonly x: number;
  readonly y: number;
  /** Unit driving direction. */
  readonly dx: number;
  readonly dy: number;
  readonly width: number;
}

/** Cumulative distance at each point, plus the closed-loop length as the last entry. */
function distances(points: readonly TrackPoint[]): number[] {
  const out = [0];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!, q = points[(i + 1) % points.length]!;
    out.push(out[i]! + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  return out;
}

/** Position, direction and width on the centerline at distance `s` (wrapped to one lap). */
export function centerlineAt(track: Pick<Track, 'points'>, s: number): CenterlinePoint {
  const pts = track.points, cum = distances(pts), lap = cum[pts.length]!;
  const d = ((s % lap) + lap) % lap;
  let i = 0;
  while (i < pts.length - 1 && cum[i + 1]! <= d) i++;
  const p = pts[i]!, q = pts[(i + 1) % pts.length]!, seg = cum[i + 1]! - cum[i]!;
  const t = (d - cum[i]!) / seg;
  return { x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t, dx: (q[0] - p[0]) / seg, dy: (q[1] - p[1]) / seg, width: p[2] + (q[2] - p[2]) * t };
}

/** Distance from (x, y) to the centerline and the track width at the nearest spot, m. */
export function nearestOnCenterline(track: Pick<Track, 'points'>, x: number, y: number): { distance: number; width: number } {
  const pts = track.points;
  let best = { distance: Infinity, width: 0 };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    const ex = q[0] - p[0], ey = q[1] - p[1];
    const t = Math.min(1, Math.max(0, ((x - p[0]) * ex + (y - p[1]) * ey) / (ex * ex + ey * ey)));
    const distance = Math.hypot(x - (p[0] + ex * t), y - (p[1] + ey * t));
    if (distance < best.distance) best = { distance, width: p[2] + (q[2] - p[2]) * t };
  }
  return best;
}

function checkVec(c: Checker, v: unknown, path: string): v is Vec {
  if (!c.array(v, path)) return false;
  if (v.length !== 2) return c.fail(path, `expected [x, y], got ${v.length} numbers`);
  return [c.number(v[0], `${path}[0]`, COORD), c.number(v[1], `${path}[1]`, COORD)].every(Boolean);
}

function checkPoints(c: Checker, v: unknown): v is TrackPoint[] {
  if (!c.array(v, '$.points')) return false;
  if (v.length < 3 || v.length > MAX_POINTS) return c.fail('$.points', `expected 3..${MAX_POINTS} points, got ${v.length}`);
  const before = c.issues.length;
  v.forEach((p, i) => {
    const path = `$.points[${i}]`;
    if (!c.array(p, path)) return;
    if (p.length !== 3) {
      c.fail(path, `expected [x, y, width], got ${p.length} numbers`);
      return;
    }
    c.number(p[0], `${path}[0]`, COORD);
    c.number(p[1], `${path}[1]`, COORD);
    if (c.number(p[2], `${path}[2]`) && p[2] <= 0) c.fail(`${path}[2]`, `expected a width above 0 m, got ${p[2]}`);
  });
  if (c.issues.length !== before) return false;
  const pts = v as TrackPoint[];
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    if (p[0] === q[0] && p[1] === q[1]) c.fail(`$.points[${(i + 1) % pts.length}]`, `same position as point ${i} (a zero-length piece)`);
  });
  return c.issues.length === before;
}

/** Shape of a line; with valid points, also that it sits across the centerline at `s` and faces forwards. */
function checkLine(c: Checker, v: unknown, path: string, track: { points: TrackPoint[]; length: number } | null): v is TrackLine {
  if (!c.object(v, path) || !c.keys(v, path, ['s', 'a', 'b'])) return false;
  const ok = [c.number(v.s, `${path}.s`, { min: 0 }), checkVec(c, v.a, `${path}.a`), checkVec(c, v.b, `${path}.b`)].every(Boolean);
  if (!ok) return false;
  const { s, a, b } = v as unknown as TrackLine;
  if (a[0] === b[0] && a[1] === b[1]) return c.fail(path, 'the two end points must differ');
  if (track === null) return true;
  if (s >= track.length) return c.fail(`${path}.s`, `expected a distance below the lap length ${track.length} m, got ${s}`);
  const at = centerlineAt(track, s);
  const off = Math.hypot((a[0] + b[0]) / 2 - at.x, (a[1] + b[1]) / 2 - at.y);
  if (off > at.width / 2) return c.fail(path, `the line's middle is ${off.toFixed(1)} m from the centerline at s=${s}, more than half the width`);
  // Driver's left in a y-down frame is (dy, -dx); a must lie on that side of b.
  if ((a[0] - b[0]) * at.dy - (a[1] - b[1]) * at.dx <= 0) return c.fail(path, 'a must be on the driver\'s left and b on the right');
  return true;
}

function checkSurfaceName(c: Checker, v: unknown, path: string, known: readonly string[] | null): void {
  if (c.string(v, path) && known !== null && !known.includes(v)) {
    c.fail(path, `unknown surface ${JSON.stringify(v)} (known: ${known.join(', ')})`);
  }
}

const FIELDS = ['schema', 'v', 'id', 'name', 'credit', 'source', 'estimates', 'length', 'points', 'startLine', 'sectorLines', 'surfaces', 'road', 'verge', 'outside', 'spawn'];

export function validateTrack(v: unknown): Result<Track> {
  const c = new Checker();
  if (!c.object(v, '$')) return c.result(v);
  c.keys(v, '$', FIELDS);
  const has = (k: string): boolean => Object.hasOwn(v, k);

  if (has('schema')) c.equals(v.schema, 'track', '$.schema', 'schema');
  if (has('v')) c.equals(v.v, 1, '$.v', 'version');
  if (has('id') && c.string(v.id, '$.id') && !ID_PATTERN.test(v.id)) {
    c.fail('$.id', `expected lowercase letters, digits and single dashes (like "interlagos"), got ${JSON.stringify(v.id)}`);
  }
  if (has('name')) c.string(v.name, '$.name');
  if (has('credit') && c.string(v.credit, '$.credit') && !v.credit.includes(OSM_CREDIT)) {
    c.fail('$.credit', `must include ${JSON.stringify(OSM_CREDIT)} (ODbL, ADR-005)`);
  }
  if (has('source') && c.object(v.source, '$.source') && c.keys(v.source, '$.source', ['osm', 'timestamp', 'license'])) {
    for (const k of ['osm', 'timestamp', 'license']) c.string(v.source[k], `$.source.${k}`);
  }
  if (has('estimates') && c.object(v.estimates, '$.estimates')) {
    for (const [k, note] of Object.entries(v.estimates)) c.string(note, `$.estimates.${k}`);
  }

  // Geometry: lines and spawn are checked against the centerline only when the points and length are sound.
  const pointsOk = has('points') && checkPoints(c, v.points);
  let track: { points: TrackPoint[]; length: number } | null = null;
  if (has('length') && c.number(v.length, '$.length', { min: 0 }) && pointsOk) {
    const points = v.points as TrackPoint[];
    const measured = distances(points)[points.length]!;
    if (Math.abs(measured - v.length) > LENGTH_TOLERANCE) {
      c.fail('$.length', `expected the centerline length ${measured.toFixed(2)} m (within ${LENGTH_TOLERANCE} m), got ${v.length}`);
    } else track = { points, length: v.length };
  }
  if (has('startLine') && checkLine(c, v.startLine, '$.startLine', track) && (v.startLine as TrackLine).s !== 0) {
    c.fail('$.startLine.s', `expected 0 (distances are measured from the start line), got ${(v.startLine as TrackLine).s}`);
  }
  if (has('sectorLines') && c.array(v.sectorLines, '$.sectorLines')) {
    const lines = v.sectorLines;
    if (lines.length !== 3) c.fail('$.sectorLines', `expected exactly 3 sector lines, got ${lines.length}`);
    else {
      lines.forEach((line, i) => {
        const path = `$.sectorLines[${i}]`;
        if (!checkLine(c, line, path, track)) return;
        const s = (line as TrackLine).s, prev = lines[i - 1] as TrackLine | undefined;
        if (i === 0 && s !== 0) c.fail(`${path}.s`, `expected 0 (sector 1 begins on the start line), got ${s}`);
        else if (i > 0 && typeof prev?.s === 'number' && s <= prev.s) c.fail(`${path}.s`, `expected a distance above ${prev.s} (sector lines in driving order), got ${s}`);
      });
    }
  }

  let known: string[] | null = null;
  if (has('surfaces') && c.object(v.surfaces, '$.surfaces')) {
    const entries = Object.entries(v.surfaces);
    if (entries.length === 0) c.fail('$.surfaces', 'expected at least one surface');
    for (const [name, s] of entries) {
      const path = `$.surfaces.${name}`;
      if (!ID_PATTERN.test(name)) c.fail(path, 'surface names use lowercase letters, digits and single dashes');
      if (c.object(s, path) && c.keys(s, path, ['grip', 'drag'])) {
        c.number(s.grip, `${path}.grip`, { min: 0, max: 2 });
        c.number(s.drag, `${path}.drag`, { min: 0, max: 10 });
      }
    }
    known = entries.map(([k]) => k);
  }
  if (has('road')) checkSurfaceName(c, v.road, '$.road', known);
  if (has('verge') && c.array(v.verge, '$.verge')) {
    v.verge.forEach((band, i) => {
      const path = `$.verge[${i}]`;
      if (!c.object(band, path) || !c.keys(band, path, ['surface', 'width'])) return;
      checkSurfaceName(c, band.surface, `${path}.surface`, known);
      if (c.number(band.width, `${path}.width`, { max: 100 }) && band.width <= 0) c.fail(`${path}.width`, `expected a width above 0 m, got ${band.width}`);
    });
  }
  if (has('outside')) checkSurfaceName(c, v.outside, '$.outside', known);

  if (has('spawn') && c.object(v.spawn, '$.spawn') && c.keys(v.spawn, '$.spawn', ['x', 'y', 'h'])) {
    const sp = v.spawn;
    const ok = [c.number(sp.x, '$.spawn.x', COORD), c.number(sp.y, '$.spawn.y', COORD), c.number(sp.h, '$.spawn.h', { min: -Math.PI, max: Math.PI })].every(Boolean);
    if (ok && track !== null) {
      const near = nearestOnCenterline(track, sp.x as number, sp.y as number);
      if (near.distance > near.width / 2) c.fail('$.spawn', `the start position is ${near.distance.toFixed(1)} m from the centerline, outside the road`);
    }
  }
  return c.result<Track>(v);
}

/** Like validateTrack, but throws a DataError naming the file, each field and the reason. */
export function parseTrack(v: unknown, file: string): Track {
  return orThrow(`Track ${file}`, validateTrack(v));
}
