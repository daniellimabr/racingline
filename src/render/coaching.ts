// Which coaching line the HUD shows for the sim's mode (S005-T5). The sim calls any body slip above 0.25 rad a
// drift, which at walking pace or with the throttle shut is not a drift to coach. Display thresholds only; the
// sim's mode is read, never changed.
import type { CarState } from '../sim/index.ts';

type Mode = CarState['mode'];

/** "Drift!" needs at least this speed, km/h. */
export const DRIFT_MSG_KMH = 25;
/** ... this much throttle, 0..1. */
export const DRIFT_MSG_THROTTLE = 0.3;
/** ... and this much rear axle slip angle, rad (the sim's own rear-slide mark, about 7.4 degrees). */
export const DRIFT_MSG_REAR_SLIP = 0.13;

/** The mode to coach: a drift without speed, throttle or rear slip is coached as a rear slide at speed, else not at all. */
export function coachMode(s: Pick<CarState, 'mode' | 'v' | 't' | 'ar'>): Mode {
  if (s.mode !== 'drift') return s.mode;
  const fast = s.v * 3.6 >= DRIFT_MSG_KMH, slip = Math.abs(s.ar) >= DRIFT_MSG_REAR_SLIP;
  if (fast && slip) return s.t >= DRIFT_MSG_THROTTLE ? 'drift' : 'rear';
  return '';
}
