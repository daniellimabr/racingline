// R reset (S004-T5, S004-AC-08): a one-tick press puts the car back at rest. On a track it goes to the
// centreline at the leave point, facing the driving direction; on the test lot it goes to the lot spawn.
// "On the track" is the off-track rule's test turned round: at least one wheel on the road (laps.ts).
// The leave point is the centreline distance nearest the car's centre, updated on every tick the car is
// on the track, so a press while on the track uses the nearest centreline point to where the car is.
import { centerlineAt, nearestOnCenterline, type Track } from '../data/track.ts';
import type { SimParams } from './params.ts';
import { createCar, type CarState } from './state.ts';

/** Where a run on `track` counts as having last been on the track before it has moved: the spawn. */
export function spawnLeave(track: Pick<Track, 'points' | 'spawn'>): number {
  return nearestOnCenterline(track, track.spawn.x, track.spawn.y).s;
}

/** The leave point after a tick: the car's nearest centreline distance while on the track, else the previous one. */
export function nextLeave(track: Pick<Track, 'points' | 'spawn'>, prev: number | undefined, car: Pick<CarState, 'x' | 'y' | 'off'>): number {
  if (!car.off) return nearestOnCenterline(track, car.x, car.y).s;
  return prev ?? spawnLeave(track);
}

/**
 * The car after an R press: a fresh standing car (first gear, idle rpm, pedals and steering released,
 * no speed, slip or yaw) at the leave point or the lot spawn. Kept: the car clock (one tick on, so lap
 * timing stays on one clock), the automatic/manual choice and the finished drifts; a drift in progress is
 * dropped. On a track the current lap becomes invalid, as when all four wheels leave the road, and its
 * number, sector progress, last and best laps are kept. Pure: returns a new car.
 */
export function resetCar(car: CarState, p: SimParams, dt: number): CarState {
  const fresh: CarState = { ...createCar(p), tt: car.tt + dt, auto: car.auto, drifts: car.drifts };
  const tr = p.track;
  if (!tr) return fresh;
  const leave = car.leave ?? spawnLeave(tr);
  const at = centerlineAt(tr, leave);
  const out: CarState = { ...fresh, x: at.x, y: at.y, h: Math.atan2(at.dy, at.dx), leave };
  if (car.lap) out.lap = { ...car.lap, valid: car.lap.lap > 0 ? false : car.lap.valid, events: [] };
  return out;
}
