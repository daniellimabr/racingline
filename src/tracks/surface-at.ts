// Surface lookup on a track (S003-T5, read by T6 physics and the off-track rule; ADR-005): the road
// between the edges, then each verge band outward, then the outside surface. A point exactly on the
// edge is road; kerbs are verge, so they count as off the track. Pure, no state, no allocation.
// Cost: one pass over the centerline segments with squared distances (about 300 on Interlagos).
import type { Track } from '../data/track.ts';

/** Distance from (x, y) past the road edge, m: at most 0 on the road, positive outside it. */
export function edgeDistance(track: Pick<Track, 'points'>, x: number, y: number): number {
  const pts = track.points, n = pts.length;
  let best = Infinity, bestWidth = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!, q = pts[i + 1 === n ? 0 : i + 1]!;
    const ex = q[0] - p[0], ey = q[1] - p[1];
    let t = ((x - p[0]) * ex + (y - p[1]) * ey) / (ex * ex + ey * ey); // segments are never zero length (validator)
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - p[0] - ex * t, dy = y - p[1] - ey * t, d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
      bestWidth = p[2] + (q[2] - p[2]) * t;
    }
  }
  return Math.sqrt(best) - bestWidth / 2;
}

/** True when (x, y) is on the road surface (the track, for the off-track rule). */
export function onRoad(track: Pick<Track, 'points'>, x: number, y: number): boolean {
  return edgeDistance(track, x, y) <= 0;
}

/** Name of the surface at (x, y), always a key of `track.surfaces`. */
export function surfaceAt(track: Pick<Track, 'points' | 'road' | 'verge' | 'outside'>, x: number, y: number): string {
  let d = edgeDistance(track, x, y);
  if (d <= 0) return track.road;
  for (const band of track.verge) {
    if (d <= band.width) return band.surface;
    d -= band.width;
  }
  return track.outside;
}
