// Which coaching line the HUD shows (S005-T5, S005-T9). The sim calls any body slip above 0.25 rad a drift,
// which at walking pace or with the throttle shut is not a drift to coach. Display thresholds only; the sim's
// state is read, never changed. The hold on the shown line lives in the render-side view (S005-T9).
import { HALO_THRESHOLD, tractionState, type CarState, type TractionState } from '../sim/index.ts';

type Mode = CarState['mode'];

/** "Drift!" needs at least this speed, km/h. */
export const DRIFT_MSG_KMH = 25;
/** ... this much throttle, 0..1. */
export const DRIFT_MSG_THROTTLE = 0.3;
/** ... and this much rear axle slip angle, rad (the sim's own rear-slide mark, about 7.4 degrees). */
export const DRIFT_MSG_REAR_SLIP = 0.13;
/**
 * A drift is held under control while the body slip angle grows no faster than this, rad/s (the sim's smoothed
 * rate `dB`); then "Drift!" outranks the traction warnings. Faster growth is a slide getting away (S005-T9).
 */
export const DRIFT_GROW_MAX = 0.6;
/** A shown coaching line stays at least this long, s, unless a more urgent one replaces it (S005-T9). */
export const MSG_HOLD = 0.4;

/** The mode to coach: a drift without speed, throttle or rear slip is coached as a rear slide at speed, else not at all. */
export function coachMode(s: Pick<CarState, 'mode' | 'v' | 't' | 'ar'>): Mode {
  if (s.mode !== 'drift') return s.mode;
  const fast = s.v * 3.6 >= DRIFT_MSG_KMH, slip = Math.abs(s.ar) >= DRIFT_MSG_REAR_SLIP;
  if (fast && slip) return s.t >= DRIFT_MSG_THROTTLE ? 'drift' : 'rear';
  return '';
}

/** A "Drift!" drift whose body slip is not growing fast. */
export const controlledDrift = (s: Pick<CarState, 'mode' | 'v' | 't' | 'ar' | 'dB'>): boolean =>
  coachMode(s) === 'drift' && s.dB <= DRIFT_GROW_MAX;

/** Halo shown, and past the point of control (the axle label's "passando do ponto"). */
export function haloLevel(s: CarState, ts: TractionState): { on: boolean; danger: boolean } {
  const on = ts.risk > HALO_THRESHOLD && s.v > 2;
  return { on, danger: on && ts.p > 0.75 && ts.rising };
}

/** How the line is coloured: halo colour, red, drift blue, yellow, or plain grey. */
export type Tone = 'halo' | 'red' | 'drift' | 'yellow' | 'plain';
export interface Coach {
  readonly text: string;
  readonly tone: Tone;
  /** Halo strength for the 'halo' tone, 0..1. */
  readonly p: number;
  /** Urgency: a higher rank replaces a shown line at once, an equal or lower one waits for MSG_HOLD. */
  readonly rank: number;
}

const MODE_MSG: Partial<Record<Mode, string>> = {
  spin: 'Rodou!', drift: 'Drift! Acelerador + contraesterço', rear: 'Saindo de traseira — contraesterce',
  front: 'Saindo de frente — menos direção',
};

/**
 * This frame's line, before the hold. Order: paused, "Rodou!", a controlled "Drift!", past the point of control,
 * near the limit, rev cut, the sim's slide modes, front lock, wheelspin, off the road, line above grip, help.
 */
export function coachLine(s: CarState, o: { paused: boolean; onTrack: boolean; lineSlip: boolean }): Coach {
  const ts = tractionState(s), { on, danger } = haloLevel(s, ts), mode = coachMode(s);
  const c = (text: string, tone: Tone, rank: number): Coach => ({ text, tone, p: Math.max(0.2, ts.p), rank });
  if (o.paused) return c('Pausado — analise a telemetria', 'plain', 5);
  if (mode === 'spin') return c(MODE_MSG.spin!, 'red', 4);
  if (controlledDrift(s)) return c(MODE_MSG.drift!, 'drift', 2);
  if (danger) return c(ts.rear ? 'Traseira passando do ponto — alivie já' : 'Dianteira saturando — menos direção', 'halo', 3);
  if (on && ts.warn) return c(ts.rear ? 'Traseira chegando ao limite — alivie' : 'Dianteira chegando ao limite — menos direção/freio', 'halo', 2);
  if (s.cut) return c('Corte de giro — suba marcha (.) ou alivie', 'red', 2);
  if (mode === 'rear') return c(MODE_MSG.rear!, 'red', 2);
  if (mode === 'drift') return c(MODE_MSG.drift!, 'drift', 2);
  if (mode === 'front') return c(MODE_MSG.front!, 'yellow', 2);
  if (s.lockF) return c('Dianteira travada — alivie o freio', 'yellow', 2);
  if (s.wspin) return c('Patinando — passou do limite de tração', 'yellow', 2);
  if (s.off) return c(o.onTrack ? 'Fora da pista' : 'Fora do pátio', 'plain', 1);
  if (o.lineSlip) return c('Linha acima da aderência — freie', 'plain', 1);
  return c('Vírgula reduz · Ponto sobe · M automático', 'plain', 0);
}

/** Render-side memory of the shown line (kept in the view, never in sim state). */
export interface CoachHold {
  shown: Coach | null;
  /** Seconds the shown line has been up. */
  age: number;
}

export const createCoachHold = (): CoachHold => ({ shown: null, age: 0 });

/**
 * The line to show after `dt` seconds of frame time: the new line replaces the shown one when it is more urgent
 * or the shown one has been up MSG_HOLD; the same text keeps its age, so it never restarts. Deterministic from
 * the sequence of lines and frame times.
 */
export function holdLine(h: CoachHold, next: Coach, dt: number): Coach {
  const cur = h.shown;
  if (cur === null || next.text !== cur.text && (next.rank > cur.rank || h.age >= MSG_HOLD - 1e-9)) {
    h.shown = next;
    h.age = 0;
  } else if (next.text === cur.text) h.shown = next; // same line, fresh colour
  h.age += Math.max(0, dt);
  return h.shown!;
}
