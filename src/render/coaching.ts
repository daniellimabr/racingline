// Which coaching line the HUD shows (S005-T5, S005-T9). The sim calls any body slip above 0.25 rad a drift,
// which at walking pace or with the throttle shut is not a drift to coach. Display thresholds only; the sim's
// state is read, never changed. The hold on the shown line lives in the render-side view (S005-T9, S005-T11).
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
/**
 * A shown coaching line stays at least this long, s, unless a red warning, "Rodou!" or the pause replaces it; a
 * calmer line takes over only once the shown one has been gone this long (S005-T9, S005-T11, S005-T13).
 */
export const MSG_HOLD = 0.4;
/**
 * A calmer line enters only once it has been chosen this long without a break, s, also over a still calmer line, so
 * a line that escalates to a red warning within this time is never shown (S005-T13, S005-T15 M3).
 */
export const CALM_ENTER = 0.2;
/** A different red warning replaces the shown one once it has been chosen this long without a break, s (S005-T15 m6). */
export const RED_SWAP = 0.1;
/**
 * Rank of the red warnings ("passando do ponto", "saturando", "Saindo de traseira"): they replace any calmer line at
 * once (S005-T13, S005-T15 m7).
 */
const RANK_RED = 3;
/** Rank of "Rodou!": it replaces any other line at once. */
const RANK_SPIN = 4;
/** Rank of the pause line: it also leaves at once. */
const RANK_PAUSE = 5;
const DRIFT_TEXT = 'Drift! Acelerador + contraesterço';

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
  /** Urgency: red (3) and above replace calmer lines at once; see holdLine for the rest. */
  readonly rank: number;
  /** The car is in a drift worth coaching this frame (speed, throttle, rear slip), held or not. */
  readonly drift?: boolean;
}

const MODE_MSG: Partial<Record<Mode, string>> = {
  spin: 'Rodou!', drift: DRIFT_TEXT, rear: 'Saindo de traseira — contraesterce',
  front: 'Saindo de frente — menos direção',
};

/**
 * This frame's line, before the hold. Order: paused, "Rodou!", a controlled "Drift!", past the point of control,
 * near the limit, rev cut, the sim's slide modes, front lock, wheelspin, off the road, line above grip, help.
 */
export function coachLine(s: CarState, o: { paused: boolean; onTrack: boolean; lineSlip: boolean }): Coach {
  const ts = tractionState(s), { on, danger } = haloLevel(s, ts), mode = coachMode(s);
  const drift = mode === 'drift';
  const c = (text: string, tone: Tone, rank: number): Coach => ({ text, tone, p: Math.max(0.2, ts.p), rank, drift });
  if (o.paused) return c('Pausado — analise a telemetria', 'plain', RANK_PAUSE);
  if (mode === 'spin') return c(MODE_MSG.spin!, 'red', RANK_SPIN);
  if (controlledDrift(s)) return c(MODE_MSG.drift!, 'drift', 2);
  if (danger) return c(ts.rear ? 'Traseira passando do ponto — alivie já' : 'Dianteira saturando — menos direção', 'halo', 3);
  if (on && ts.warn) return c(ts.rear ? 'Traseira chegando ao limite — alivie' : 'Dianteira chegando ao limite — menos direção/freio', 'halo', 2);
  if (s.cut) return c('Corte de giro — suba marcha (.) ou alivie', 'red', 2);
  if (mode === 'rear') return c(MODE_MSG.rear!, 'red', RANK_RED);
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
  /** Seconds since this frame's choice was last the shown line. */
  gone: number;
  /** This frame's choice before the hold, and how long it has been chosen without a break, s. */
  asked: string;
  askedFor: number;
  /** The same after the drift rule (a drift's calmer lines count as "Drift!"). */
  wanted: string;
  wantedFor: number;
}

export const createCoachHold = (): CoachHold => ({ shown: null, age: 0, gone: 0, asked: '', askedFor: 0, wanted: '', wantedFor: 0 });

const EPS = 1e-9;

/**
 * The line to show after `dt` seconds of frame time (S005-T9, S005-T11, S005-T13, S005-T15). A red warning, "Rodou!"
 * and the pause replace any calmer line at once, and the pause line also leaves at once; a different red warning
 * replaces a shown red one once chosen RED_SWAP without a break. Otherwise the shown line stays at least MSG_HOLD, and
 * then a line takes over only once it has been chosen CALM_ENTER without a break and is more urgent or the shown line
 * has not been chosen for MSG_HOLD, so a calmer line never shows for a moment between two urgent ones or just before a
 * red one. In a drift worth coaching, any line below the red warnings counts as "Drift!"
 * until it has been chosen without a break for MSG_HOLD. The same text keeps its age. Deterministic from the
 * sequence of lines and frame times.
 */
export function holdLine(h: CoachHold, next: Coach, dt: number): Coach {
  const d = Math.max(0, dt);
  if (next.text === h.asked) h.askedFor += d;
  else {
    h.asked = next.text;
    h.askedFor = d;
  }
  const want: Coach = next.drift && next.rank < RANK_RED && next.text !== DRIFT_TEXT && h.askedFor < MSG_HOLD - EPS
    ? { text: DRIFT_TEXT, tone: 'drift', p: next.p, rank: 2, drift: true } : next;
  if (want.text === h.wanted) h.wantedFor += d;
  else {
    h.wanted = want.text;
    h.wantedFor = d;
  }
  const cur = h.shown;
  if (cur !== null && want.text === cur.text) {
    h.shown = want; // same line, fresh colour
    h.gone = 0;
  } else {
    if (cur !== null) h.gone += d;
    const steady = h.wantedFor >= CALM_ENTER - EPS;
    const settled = cur !== null && h.age >= MSG_HOLD - EPS && steady && (want.rank > cur.rank || h.gone >= MSG_HOLD - EPS);
    const urgent = cur !== null && want.rank >= RANK_RED && want.rank > cur.rank;
    const redSwap = cur !== null && want.rank === RANK_RED && cur.rank === RANK_RED && h.wantedFor >= RED_SWAP - EPS;
    if (cur === null || urgent || redSwap || want.rank >= RANK_SPIN || cur.rank >= RANK_PAUSE || settled) {
      h.shown = want;
      h.age = 0;
      h.gone = 0;
    }
  }
  h.age += d;
  return h.shown!;
}
