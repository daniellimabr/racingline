// InputLog v1: a recorded run = run settings + one InputFrame per tick (frame i drives tick i).
// Shape fixed in docs/sprints/SPRINT-001/mailbox/main-dev-to-back-end-input-frame.md (S001-AC-10).
// Frame order is the array index, so "non-monotonic frames" cannot exist; anything that is not
// a dense, plain array of frames is rejected instead.
import type { InputFrame } from '../core/input-frame.ts';
import { Checker, orThrow, type Result } from './check.ts';

export const INPUT_LOG_VERSION = 1;
export const TICK_SECONDS = 1 / 60;
export const SUB_STEPS = 10;
export const UINT32_MAX = 0xffff_ffff;

export interface InputLog {
  version: typeof INPUT_LOG_VERSION;
  seed: number; // uint32, seeds the sim PRNG (steering wobble)
  skill: number; // 0..1 (v24 "Experiência" slider)
  car: string; // car params id, e.g. "s15-drift"
  tickSeconds: number; // always 1/60
  subSteps: number; // always 10
  frames: InputFrame[];
}

const LOG_KEYS = ['version', 'seed', 'skill', 'car', 'tickSeconds', 'subSteps', 'frames'] as const;
const AXES = ['throttle', 'brake', 'left', 'right'] as const;
const BUTTONS = ['shiftUp', 'shiftDown', 'toggleAuto'] as const;
const FRAME_KEYS = [...AXES, ...BUTTONS];

function checkFrame(c: Checker, v: unknown, path: string): void {
  if (!c.object(v, path)) return;
  c.keys(v, path, FRAME_KEYS);
  for (const k of AXES) if (Object.hasOwn(v, k)) c.number(v[k], `${path}.${k}`, { min: 0, max: 1 });
  for (const k of BUTTONS) if (Object.hasOwn(v, k)) c.boolean(v[k], `${path}.${k}`);
}

/** Walks an input log into `c`; reused by the reference trace validator. Returns the frame count, or -1 if unknown. */
export function checkInputLog(c: Checker, v: unknown, path: string): number {
  if (!c.object(v, path)) return -1;
  c.keys(v, path, LOG_KEYS);
  const has = (k: string): boolean => Object.hasOwn(v, k);
  if (has('version')) c.equals(v['version'], INPUT_LOG_VERSION, `${path}.version`, 'version');
  if (has('seed')) c.number(v['seed'], `${path}.seed`, { min: 0, max: UINT32_MAX, integer: true });
  if (has('skill')) c.number(v['skill'], `${path}.skill`, { min: 0, max: 1 });
  if (has('car')) c.string(v['car'], `${path}.car`);
  if (has('tickSeconds') && c.number(v['tickSeconds'], `${path}.tickSeconds`)) {
    c.equals(v['tickSeconds'], TICK_SECONDS, `${path}.tickSeconds`, 'tick length');
  }
  if (has('subSteps') && c.number(v['subSteps'], `${path}.subSteps`)) {
    c.equals(v['subSteps'], SUB_STEPS, `${path}.subSteps`, 'sub-step count');
  }
  if (!has('frames') || !c.array(v['frames'], `${path}.frames`)) return -1;
  const frames = v['frames'];
  // Index loop on purpose: forEach would skip holes in a sparse array.
  for (let i = 0; i < frames.length; i++) checkFrame(c, frames[i], `${path}.frames[${i}]`);
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
