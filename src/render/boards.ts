// Distance boards and apex kerbs (S004-T6): placed from the track's `brakePoints` and `apexKerbs`, in the
// shape agreed with Database (docs/sprints/SPRINT-004/mailbox/database-to-front-end-track-fields.md).
// Both fields are optional: a track without them (older files) gets no boards and no apex kerbs.
// Track geometry only (where the road bends), never physics. All results in metres.
import { centerlineAt, type Track, type Vec } from '../data/track.ts';

export interface BrakePoint {
  /** Distance along the lap, m. */
  readonly s: number;
  readonly name: string;
}
/** Side of the road in the driving direction. */
export type Side = 'left' | 'right';
export interface ApexKerb {
  /** Stretch along the lap, m; `to` below `from` means the stretch crosses the start line. */
  readonly from: number;
  readonly to: number;
  readonly side: Side;
  /** Kerb width outside the track edge, m. */
  readonly width: number;
}
export interface TrackMarks {
  readonly apexKerbs?: readonly ApexKerb[];
  readonly brakePoints?: readonly BrakePoint[];
}
export type MarkedTrack = Pick<Track, 'points' | 'verge'> & TrackMarks;

/** Boards stand this far before each braking point, m, in driving order. */
export const BOARD_DISTANCES = [200, 150, 100, 50] as const;
/** Board centre beyond the outer edge of the verge, m. */
const BOARD_GAP = 4;
/** How far after a braking point the corner is looked for, m, and the bend that counts as the corner, rad. */
const CORNER_LOOK = 400, CORNER_STEP = 5, CORNER_BEND = 0.3;
const KERB_STEP = 2; // m between kerb path points

export interface Board {
  /** Distance along the lap, m (wrapped to one lap). */
  readonly s: number;
  readonly label: string;
  readonly corner: string;
  /** Outside of the coming corner, where the board stands. */
  readonly side: Side;
  readonly x: number;
  readonly y: number;
}

export interface KerbPath {
  readonly side: Side;
  readonly width: number;
  /** Lap distance at the first point, m (keeps the stripes in step along the lap). */
  readonly s: number;
  /** Middle of the kerb band, m. */
  readonly pts: readonly Vec[];
}

function lapLength(track: Pick<Track, 'points'>): number {
  const pts = track.points;
  let lap = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    lap += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return lap;
}

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** The outside of the first corner after `s`: a right-hand bend (heading growing, y down) has its outside on the left. */
export function outsideOf(track: Pick<Track, 'points'>, s: number): Side {
  let prev = centerlineAt(track, s), bend = 0;
  for (let d = CORNER_STEP; d <= CORNER_LOOK; d += CORNER_STEP) {
    const at = centerlineAt(track, s + d);
    bend += wrapAngle(Math.atan2(at.dy, at.dx) - Math.atan2(prev.dy, prev.dx));
    prev = at;
    if (Math.abs(bend) >= CORNER_BEND) break;
  }
  return bend >= 0 ? 'left' : 'right';
}

/** Point `off` metres to the given side of the centreline at `s`. */
function besideAt(track: Pick<Track, 'points'>, s: number, side: Side, off: (width: number) => number): Vec {
  const at = centerlineAt(track, s), k = (side === 'left' ? 1 : -1) * off(at.width);
  // Driver's left in a y-down frame is (dy, -dx).
  return [at.x + at.dy * k, at.y - at.dx * k];
}

export function boardsFor(track: MarkedTrack): Board[] {
  const points = track.brakePoints ?? [];
  if (points.length === 0) return [];
  const lap = lapLength(track), verge = track.verge.reduce((sum, b) => sum + b.width, 0);
  const out: Board[] = [];
  for (const bp of points) {
    const side = outsideOf(track, bp.s);
    for (const d of BOARD_DISTANCES) {
      const s = (((bp.s - d) % lap) + lap) % lap;
      const [x, y] = besideAt(track, s, side, (w) => w / 2 + verge + BOARD_GAP);
      out.push({ s, label: String(d), corner: bp.name, side, x, y });
    }
  }
  return out;
}

export function kerbsFor(track: MarkedTrack): KerbPath[] {
  const kerbs = track.apexKerbs ?? [];
  if (kerbs.length === 0) return [];
  const lap = lapLength(track);
  return kerbs.map((k) => {
    const end = k.to >= k.from ? k.to : k.to + lap, pts: Vec[] = [];
    const off = (w: number): number => w / 2 + k.width / 2;
    for (let s = k.from; s < end; s += KERB_STEP) pts.push(besideAt(track, s, k.side, off));
    pts.push(besideAt(track, end, k.side, off));
    return { side: k.side, width: k.width, s: k.from, pts };
  });
}
