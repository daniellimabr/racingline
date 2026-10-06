// Distance boards and apex kerbs (S004-T6): placed from the track's `brakePoints` and `apexKerbs`, in the
// shape agreed with Database (docs/sprints/SPRINT-004/mailbox/database-to-front-end-track-fields.md; types
// in data/track.ts). A track without them (older files, the lot) gets no boards and no apex kerbs.
// Track geometry only (where the road bends), never physics. All results in metres.
import { centerlineAt, type ApexKerb, type Track, type Vec } from '../data/track.ts';

/** Side of the road in the driving direction. */
export type Side = ApexKerb['side'];
/** Both fields may be missing on a raw object (the checked track fills them with []); missing draws nothing. */
export type MarkedTrack = Pick<Track, 'points' | 'verge' | 'length'> & Partial<Pick<Track, 'apexKerbs' | 'brakePoints'>>;

/** Boards stand this far before each braking point, m, in driving order. */
export const BOARD_DISTANCES = [200, 150, 100, 50] as const;
/**
 * A board stands only on straight road (Main Dev, S004-T10, replacing the 300 m gap rule), and a braking point
 * shows all four boards or none (S005-T5): the road may turn
 * at most STRAIGHT_MAX_TURN degrees in total over STRAIGHT_LOOK metres either side of it. Tuned on Interlagos:
 * boards on straights turn at most 1.9 degrees there, boards inside Ferradura, Pinheirinho, Mergulho or at
 * Bico de Pato's turn-in at least 15.3; 50 m either side would also drop boards 25 m after a corner's exit.
 */
export const STRAIGHT_LOOK = 25;
export const STRAIGHT_MAX_TURN = 10;
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

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const headingAt = (track: Pick<Track, 'points'>, s: number): number => {
  const at = centerlineAt(track, s);
  return Math.atan2(at.dy, at.dx);
};

/** Total turning of the road (left and right both count) within STRAIGHT_LOOK m either side of `s`, degrees. */
export function turnAround(track: Pick<Track, 'points'>, s: number): number {
  let prev = headingAt(track, s - STRAIGHT_LOOK), sum = 0;
  for (let d = 1 - STRAIGHT_LOOK; d <= STRAIGHT_LOOK; d++) {
    const h = headingAt(track, s + d);
    sum += Math.abs(wrapAngle(h - prev));
    prev = h;
  }
  return (sum * 180) / Math.PI;
}

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
  const lap = track.length, verge = track.verge.reduce((sum, b) => sum + b.width, 0);
  const out: Board[] = [];
  for (const bp of points) {
    const side = outsideOf(track, bp.s);
    const at = BOARD_DISTANCES.map((d) => (((bp.s - d) % lap) + lap) % lap);
    // A broken set (say a lone 100) misreads as the next corner's count, so a braking point with any board off
    // straight road gets none at all (S005-T5).
    if (at.some((s) => turnAround(track, s) >= STRAIGHT_MAX_TURN)) continue;
    BOARD_DISTANCES.forEach((d, i) => {
      const s = at[i]!, [x, y] = besideAt(track, s, side, (w) => w / 2 + verge + BOARD_GAP);
      out.push({ s, label: String(d), corner: bp.name, side, x, y });
    });
  }
  return out;
}

export function kerbsFor(track: MarkedTrack): KerbPath[] {
  const kerbs = track.apexKerbs ?? [];
  if (kerbs.length === 0) return [];
  // The track checker keeps every stretch inside one lap, from below to.
  return kerbs.map((k) => {
    const pts: Vec[] = [], off = (w: number): number => w / 2 + k.width / 2;
    for (let s = k.from; s < k.to; s += KERB_STEP) pts.push(besideAt(track, s, k.side, off));
    pts.push(besideAt(track, k.to, k.side, off));
    return { side: k.side, width: k.width, s: k.from, pts };
  });
}
