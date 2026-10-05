// Test-only track: a 200 m x 100 m box, 12 m wide, driven clockwise on screen (y grows south).
// The start line is mid-way along the top (heading east); sector 2 begins on the right side (heading
// south) and sector 3 on the bottom (heading west). Checked by the real track validator.
import { OSM_CREDIT, parseTrack, type Track } from '../../src/data/track.ts';
import type { CarState } from '../../src/sim/index.ts';

export const BOX: Track = parseTrack(
  {
    schema: 'track',
    v: 1,
    id: 'box',
    name: 'Box',
    credit: OSM_CREDIT,
    source: { osm: 'relation/1', timestamp: '2026-10-05T00:00:00Z', license: 'ODbL-1.0' },
    estimates: {},
    length: 600,
    points: [[0, 0, 12], [100, 0, 12], [100, 100, 12], [-100, 100, 12], [-100, 0, 12]],
    startLine: { s: 0, a: [0, -6], b: [0, 6] },
    sectorLines: [
      { s: 0, a: [0, -6], b: [0, 6] },
      { s: 150, a: [106, 50], b: [94, 50] },
      { s: 350, a: [-50, 106], b: [-50, 94] },
    ],
    surfaces: { asphalt: { grip: 1, drag: 0 }, kerb: { grip: 0.9, drag: 0.2 }, grass: { grip: 0.55, drag: 0.8 } },
    road: 'asphalt',
    verge: [{ surface: 'kerb', width: 1 }],
    outside: 'grass',
    spawn: { x: -20, y: 0, h: 0 },
  },
  'box.json',
);

/** Position on the box centerline at distance s from the start line, its heading, and an offset to the driver's right. */
export function boxPose(s: number, right = 0): { x: number; y: number; h: number } {
  const d = ((s % 600) + 600) % 600;
  if (d < 100) return { x: d, y: right, h: 0 };
  if (d < 200) return { x: 100 - right, y: d - 100, h: Math.PI / 2 };
  if (d < 400) return { x: 100 - (d - 200), y: 100 - right, h: Math.PI };
  if (d < 500) return { x: -100 + right, y: 100 - (d - 400), h: -Math.PI / 2 };
  return { x: -100 + (d - 500), y: right, h: 0 };
}

/**
 * Car poses along the box, one per 1/60 s tick, from distance `from` to `to` at `speed` m/s
 * (backwards when `to` is below `from`, still facing forwards); `right(s)` gives the sideways offset
 * at each distance. Only x, y, h and the clock tt change.
 */
export function boxDrive(start: CarState, from: number, to: number, speed: number, right: (s: number) => number = () => 0): CarState[] {
  const out: CarState[] = [];
  const dir = to >= from ? 1 : -1, ds = (dir * speed) / 60;
  let tt = start.tt;
  for (let s = from + ds; dir * (to - s) >= -1e-9; s += ds) {
    tt += 1 / 60;
    out.push({ ...start, ...boxPose(s, right(s)), tt });
  }
  return out;
}
