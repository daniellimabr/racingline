// Surface lookup on a track (S003-T5, read by T6 physics and the off-track rule; ADR-005): the road
// between the edges, then each verge band outward, then the outside surface. A point exactly on the
// edge is road; kerbs are verge, so they count as off the track. On an apex kerb stretch (S004-T4) the
// "kerb" band covers 0..width m past the edge on its side instead of the verge bands.
// Pure, no state but a per-track cache of lap distances. Cost: one pass over the centerline segments
// with squared distances (about 300 on Interlagos).
import type { ApexKerb, Track } from '../data/track.ts';

type Points = Track['points'];

/** Distance along the lap at the start of each segment, computed once per points list. */
const starts = new WeakMap<Points, Float64Array>();
function segmentStarts(pts: Points): Float64Array {
  let out = starts.get(pts);
  if (!out) {
    out = new Float64Array(pts.length);
    for (let i = 1; i < pts.length; i++) out[i] = out[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    starts.set(pts, out);
  }
  return out;
}

interface Nearest {
  /** Distance past the road edge, m: at most 0 on the road. */
  edge: number;
  /** Distance along the lap of the nearest centerline spot, m. */
  s: number;
  /** True when (x, y) is on the driver's left of the centerline. */
  left: boolean;
}

function nearest(pts: Points, x: number, y: number): Nearest {
  const n = pts.length;
  let best = Infinity, bestWidth = 0, bestI = 0, bestT = 0, bestCross = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!, q = pts[i + 1 === n ? 0 : i + 1]!;
    const ex = q[0] - p[0], ey = q[1] - p[1];
    let t = ((x - p[0]) * ex + (y - p[1]) * ey) / (ex * ex + ey * ey); // segments are never zero length (validator)
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - p[0] - ex * t, dy = y - p[1] - ey * t, d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
      bestWidth = p[2] + (q[2] - p[2]) * t;
      bestI = i;
      bestT = t;
      bestCross = dx * ey - dy * ex; // > 0 on the driver's left, which is (ey, -ex) with y pointing south
    }
  }
  const p = pts[bestI]!, q = pts[bestI + 1 === n ? 0 : bestI + 1]!;
  const s = segmentStarts(pts)[bestI]! + bestT * Math.hypot(q[0] - p[0], q[1] - p[1]);
  return { edge: Math.sqrt(best) - bestWidth / 2, s, left: bestCross > 0 };
}

/** Distance from (x, y) past the road edge, m: at most 0 on the road, positive outside it. */
export function edgeDistance(track: Pick<Track, 'points'>, x: number, y: number): number {
  return nearest(track.points, x, y).edge;
}

/** True when (x, y) is on the road surface (the track, for the off-track rule). */
export function onRoad(track: Pick<Track, 'points'>, x: number, y: number): boolean {
  return edgeDistance(track, x, y) <= 0;
}

function apexKerbAt(kerbs: readonly ApexKerb[], s: number, left: boolean): ApexKerb | undefined {
  for (const k of kerbs) if (s >= k.from && s <= k.to && (k.side === 'left') === left) return k;
  return undefined;
}

/** Name of the surface at (x, y), always a key of `track.surfaces`. */
export function surfaceAt(track: Pick<Track, 'points' | 'road' | 'verge' | 'outside'> & Partial<Pick<Track, 'apexKerbs'>>, x: number, y: number): string {
  const near = nearest(track.points, x, y);
  let d = near.edge;
  if (d <= 0) return track.road;
  const kerbs = track.apexKerbs;
  if (kerbs && kerbs.length > 0) {
    const k = apexKerbAt(kerbs, near.s, near.left);
    if (k && d <= k.width) return 'kerb'; // the validator makes sure the track has a "kerb" surface
  }
  for (const band of track.verge) {
    if (d <= band.width) return band.surface;
    d -= band.width;
  }
  return track.outside;
}
