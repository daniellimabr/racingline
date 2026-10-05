// Generic deterministic core (ADR-001): fixed tick, seeded rng in state, pure step, replay.
// Physics-agnostic: the car simulation plugs in as a CarStep (Physics Dev, S001-T4).
import type { InputFrame } from './input-frame.ts';
import { hashState } from './hash.ts';
import { seedState } from './rng.ts';

export const TICK = 1 / 60; // seconds per sim tick
export const SUBSTEPS = 10; // physics sub-steps per tick (v24 sim(): n = 10)

/** Plain-JSON sim state envelope; `car` must be JSON data (no functions, NaN or Infinity). */
export interface SimState<C = unknown> {
  v: 1;
  tick: number;
  rng: number; // mulberry32 uint32 state; nothing draws from it since the wobble was removed (S002-T10)
  car: C;
}

export interface TickContext {
  dt: number; // TICK
  substeps: number; // SUBSTEPS; the car sim runs its own sub-step loop, as v24 sim() does
}

/** Must be pure: return a new car, never mutate `car`, `input` or `params`. */
export type CarStep<C, P> = (car: C, input: InputFrame, params: P, ctx: TickContext) => C;

export function createState<C>(seed: number, car: C): SimState<C> {
  return { v: 1, tick: 0, rng: seedState(seed), car };
}

/** Advances one tick: runs the car step. Returns a new state. */
export function step<C, P>(state: SimState<C>, input: InputFrame, params: P, carStep: CarStep<C, P>): SimState<C> {
  const car = carStep(state.car, input, params, { dt: TICK, substeps: SUBSTEPS });
  return { v: 1, tick: state.tick + 1, rng: state.rng, car };
}

export interface ReplayResult<C> {
  state: SimState<C>;
  hashes?: string[]; // hash after each tick, when requested
}

/** Runs one tick per input frame from `initial`. Same initial state + frames => identical result. */
export function replay<C, P>(
  frames: readonly InputFrame[],
  initial: SimState<C>,
  params: P,
  carStep: CarStep<C, P>,
  perTickHashes = false,
): ReplayResult<C> {
  let state = initial;
  const hashes: string[] = [];
  for (const input of frames) {
    state = step(state, input, params, carStep);
    if (perTickHashes) hashes.push(hashState(state));
  }
  return perTickHashes ? { state, hashes } : { state };
}
