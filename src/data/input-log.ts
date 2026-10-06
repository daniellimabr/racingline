// InputLog v2: a recorded run = run settings + one InputFrame per tick (frame i drives tick i).
// Shape fixed in docs/sprints/SPRINT-001/mailbox/main-dev-to-back-end-input-frame.md (S001-AC-10);
// v2 drops the skill setting (S002-T10, docs/sprints/SPRINT-002/mailbox/physics-dev-to-database-input-log-v-bump.md).
// A v1 log is rejected, not migrated: it was recorded with a skill-dependent grip and wobble, so it
// would not replay to the same run. Only the v24 reference traces still embed v1 logs (V24InputLog).
// Frame order is the array index, so "non-monotonic frames" cannot exist; anything that is not
// a dense, plain array of frames is rejected instead.
import type { InputFrame } from '../core/input-frame.ts';
import { Checker, orThrow, type Result } from './check.ts';

export const INPUT_LOG_VERSION = 2;
export const V24_INPUT_LOG_VERSION = 1;
export const TICK_SECONDS = 1 / 60;
export const SUB_STEPS = 10;
export const UINT32_MAX = 0xffff_ffff;

export interface InputLog {
  version: typeof INPUT_LOG_VERSION;
  seed: number; // uint32, seeds the sim PRNG (nothing draws from it since S002-T10)
  car: string; // car params id, e.g. "s15-drift"
  track?: string; // track id, e.g. "interlagos"; absent means the test lot (S003-T5, still version 2)
  tickSeconds: number; // always 1/60
  subSteps: number; // always 10
  frames: InputFrame[];
}

/** Version 1 input log as the v24 reference traces embed it: version 1 plus the removed skill setting. */
export interface V24InputLog extends Omit<InputLog, 'version' | 'track'> {
  version: typeof V24_INPUT_LOG_VERSION;
  skill: number; // 0..1 (v24 "Experiência" slider)
}

const LOG_KEYS = ['version', 'seed', 'car', 'tickSeconds', 'subSteps', 'frames'] as const;
const V24_LOG_KEYS = [...LOG_KEYS, 'skill'] as const;
const V1_GONE =
  'input log version 1 is no longer supported: it carries the removed skill setting and would not replay the same; record the run again';
/** Same rule as track file ids (src/data/track.ts); "lot" names the test lot. */
const TRACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AXES = ['throttle', 'brake', 'left', 'right'] as const;
const BUTTONS = ['shiftUp', 'shiftDown', 'toggleAuto'] as const;
const FRAME_KEYS = [...AXES, ...BUTTONS];

/** The R reset press (S004-T5) is optional in version 2 logs, so earlier logs stay valid; v24 logs never have it. */
const OPTIONAL_BUTTONS = ['reset'] as const;

function checkFrame(c: Checker, v: unknown, path: string, v24: boolean): void {
  if (!c.object(v, path)) return;
  c.keys(v, path, FRAME_KEYS, v24 ? [] : OPTIONAL_BUTTONS);
  if (!v24) for (const k of OPTIONAL_BUTTONS) if (Object.hasOwn(v, k)) c.boolean(v[k], `${path}.${k}`);
  for (const k of AXES) if (Object.hasOwn(v, k)) c.number(v[k], `${path}.${k}`, { min: 0, max: 1 });
  for (const k of BUTTONS) if (Object.hasOwn(v, k)) c.boolean(v[k], `${path}.${k}`);
}

/**
 * Walks an input log into `c`; returns the frame count, or -1 if unknown. `v24` accepts only the
 * version 1 shape the v24 reference traces embed (reused by the trace validator).
 */
export function checkInputLog(c: Checker, v: unknown, path: string, v24 = false): number {
  if (!c.object(v, path)) return -1;
  const has = (k: string): boolean => Object.hasOwn(v, k);
  if (!v24 && v['version'] === V24_INPUT_LOG_VERSION) {
    c.fail(`${path}.version`, V1_GONE); // one clear reason instead of a list of field errors
    return -1;
  }
  c.keys(v, path, v24 ? V24_LOG_KEYS : LOG_KEYS, v24 ? [] : ['track']);
  if (has('version')) c.equals(v['version'], v24 ? V24_INPUT_LOG_VERSION : INPUT_LOG_VERSION, `${path}.version`, 'version');
  if (has('seed')) c.number(v['seed'], `${path}.seed`, { min: 0, max: UINT32_MAX, integer: true });
  if (v24 && has('skill')) c.number(v['skill'], `${path}.skill`, { min: 0, max: 1 });
  if (has('car')) c.string(v['car'], `${path}.car`);
  if (!v24 && has('track') && c.string(v['track'], `${path}.track`) && !TRACK_ID.test(v['track'])) {
    c.fail(`${path}.track`, `expected a track id in lowercase letters, digits and single dashes (like "interlagos"), got ${JSON.stringify(v['track'])}`);
  }
  if (has('tickSeconds') && c.number(v['tickSeconds'], `${path}.tickSeconds`)) {
    c.equals(v['tickSeconds'], TICK_SECONDS, `${path}.tickSeconds`, 'tick length');
  }
  if (has('subSteps') && c.number(v['subSteps'], `${path}.subSteps`)) {
    c.equals(v['subSteps'], SUB_STEPS, `${path}.subSteps`, 'sub-step count');
  }
  if (!has('frames') || !c.array(v['frames'], `${path}.frames`)) return -1;
  const frames = v['frames'];
  // Index loop on purpose: forEach would skip holes in a sparse array.
  for (let i = 0; i < frames.length; i++) checkFrame(c, frames[i], `${path}.frames[${i}]`, v24);
  return frames.length;
}

export function validateInputLog(v: unknown): Result<InputLog> {
  const c = new Checker();
  checkInputLog(c, v, '$');
  return c.result<InputLog>(v);
}

/** Like validateInputLog, but throws a DataError listing every path and reason. */
export function parseInputLog(v: unknown, what = 'Input log'): InputLog {
  return orThrow(what, validateInputLog(v));
}
