// Deterministic lap timing (S003-T5, S003-AC-08/09): start/finish and sector line crossings, lap and
// sector times, best lap, and the off-track rule (Daniel 2026-10-05: a lap is invalid if at any tick all
// four wheels are off the road; kerbs count as off). Plain JSON state, pure functions, no clock reads:
// crossing times are interpolated inside the tick on the car clock `tt`, so every replay gives the same numbers.
import type { Track, TrackLine } from '../data/track.ts';
import { onRoad } from '../tracks/surface-at.ts';
import type { CarParams } from './params.ts';
import type { CarState } from './state.ts';

/** A line also counts when the car crosses it this far beyond either end, m (lines sit 115 m or more from other parts of Interlagos). */
export const LINE_MARGIN = 10;

export interface LapTime {
  lap: number;
  time: number; // s, always sectors[0] + sectors[1] + sectors[2]
  sectors: [number, number, number]; // s
  valid: boolean;
}

/** What happened on the latest tick (also written to the telemetry stream). `at` is the crossing time on the car clock. */
export type LapEvent =
  | { type: 'sector'; lap: number; sector: 1 | 2 | 3; time: number; valid: boolean; at: number }
  | { type: 'lap'; lap: number; time: number; sectors: [number, number, number]; valid: boolean; best: boolean; at: number };

export interface LapState {
  track: string; // track id, so a saved state names its track
  lap: number; // current lap; 0 until the first start-line crossing after spawn
  next: number; // index in track.sectorLines of the next line that counts (0 = start/finish)
  marks: number[]; // car-clock times of this lap's start and of each sector start reached so far
  valid: boolean;
  last: LapTime | null;
  best: LapTime | null; // fastest valid lap
  events: LapEvent[]; // events of the latest tick only
}

type Pose = Pick<CarState, 'x' | 'y' | 'h'>;
type Vec = [number, number];

export function createLapState(track: Pick<Track, 'id'>): LapState {
  return { track: track.id, lap: 0, next: 0, marks: [], valid: true, last: null, best: null, events: [] };
}

/** Wheel centres [front left, front right, rear left, rear right]: axles la ahead and lb behind the CG, wheels trackWidth apart. */
export function wheelPositions(s: Pose, c: Pick<CarParams, 'la' | 'lb' | 'trackWidth'>): [Vec, Vec, Vec, Vec] {
  const fx = Math.cos(s.h), fy = Math.sin(s.h), w = c.trackWidth / 2;
  const rx = -fy * w, ry = fx * w; // to the driver's right (y grows south)
  const ax = (k: number): [number, number] => [s.x + fx * k, s.y + fy * k];
  const [fX, fY] = ax(c.la), [bX, bY] = ax(-c.lb);
  return [[fX - rx, fY - ry], [fX + rx, fY + ry], [bX - rx, bY - ry], [bX + rx, bY + ry]];
}

/** The off-track rule's test: no wheel on the road. */
export function allWheelsOff(track: Pick<Track, 'points'>, s: Pose, c: Pick<CarParams, 'la' | 'lb' | 'trackWidth'>): boolean {
  return !wheelPositions(s, c).some((w) => onRoad(track, w[0], w[1]));
}

/** Fraction 0..1 of the move from p0 to p1 where it crosses `line` forwards (behind to ahead), or null. */
export function crossing(line: TrackLine, p0: Pose, p1: Pose): number | null {
  const [ax, ay] = line.a, ex = line.b[0] - ax, ey = line.b[1] - ay;
  // Positive behind the line, negative ahead of it (a is on the driver's left, y grows south).
  const s0 = ex * (p0.y - ay) - ey * (p0.x - ax), s1 = ex * (p1.y - ay) - ey * (p1.x - ax);
  if (!(s0 > 0 && s1 <= 0)) return null;
  const f = s0 / (s0 - s1), ix = p0.x + (p1.x - p0.x) * f, iy = p0.y + (p1.y - p0.y) * f;
  const len2 = ex * ex + ey * ey, u = ((ix - ax) * ex + (iy - ay) * ey) / len2, m = LINE_MARGIN / Math.sqrt(len2);
  return u >= -m && u <= 1 + m ? f : null;
}

/** One tick of lap timing, from the car before (`prev`) to the car after (`car`) the tick. Returns a new state. */
export function lapStep(
  state: LapState,
  prev: Pose & Pick<CarState, 'tt'>,
  car: Pose & Pick<CarState, 'tt'>,
  track: Pick<Track, 'points' | 'sectorLines'>,
  c: Pick<CarParams, 'la' | 'lb' | 'trackWidth'>,
): LapState {
  let { lap, next, marks, valid, last, best } = state;
  const events: LapEvent[] = [];
  const f = crossing(track.sectorLines[next]!, prev, car);
  if (f !== null) {
    const at = prev.tt + (car.tt - prev.tt) * f;
    if (next === 0) {
      if (lap > 0) {
        const sectors: [number, number, number] = [marks[1]! - marks[0]!, marks[2]! - marks[1]!, at - marks[2]!];
        const time = sectors[0] + sectors[1] + sectors[2];
        const isBest = valid && (best === null || time < best.time);
        events.push({ type: 'sector', lap, sector: 3, time: sectors[2], valid, at });
        events.push({ type: 'lap', lap, time, sectors, valid, best: isBest, at });
        last = { lap, time, sectors, valid };
        if (isBest) best = last;
      }
      lap += 1;
      marks = [at];
      valid = true;
      next = 1;
    } else {
      events.push({ type: 'sector', lap, sector: next as 1 | 2, time: at - marks[next - 1]!, valid, at });
      marks = [...marks, at];
      next = next === 2 ? 0 : next + 1;
    }
  }
  if (lap > 0 && valid && allWheelsOff(track, car, c)) valid = false;
  return { track: state.track, lap, next, marks, valid, last, best, events };
}

/** What the lap display shows; null on the test lot. */
export interface LapProgress {
  lap: number; // 0 on the out lap
  sector: 1 | 2 | 3;
  time: number; // s into the current lap (0 on the out lap)
  splits: number[]; // finished sector times of this lap, 0 to 2 of them
  valid: boolean;
  last: LapTime | null;
  best: LapTime | null;
}

export function lapProgress(car: Pick<CarState, 'tt' | 'lap'>): LapProgress | null {
  const l = car.lap;
  if (l === undefined) return null;
  const splits = l.marks.slice(1).map((m, i) => m - l.marks[i]!);
  return {
    lap: l.lap,
    sector: l.lap === 0 || l.next === 1 ? 1 : l.next === 2 ? 2 : 3,
    time: l.lap === 0 ? 0 : car.tt - l.marks[0]!,
    splits,
    valid: l.valid,
    last: l.last,
    best: l.best,
  };
}
