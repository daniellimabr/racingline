// Run setup (S002-T6): a run starts from its recorded header (seed, skill, car id). The live game
// and a replay of a saved input log go through the same function, so a replay uses the recorded car.
import type { CarRegistry } from './core/car-registry.ts';
import { createState, replay, type ReplayResult, type SimState } from './core/sim.ts';
import type { InputLog } from './data/input-log.ts';
import { carStep, createCar, createSimParams, type CarParams, type CarState, type SimParams } from './sim/index.ts';

/** The input log header fields that decide the starting state. */
export type RunHeader = Pick<InputLog, 'seed' | 'skill' | 'car'>;

export interface Run {
  params: SimParams;
  state: SimState<CarState>;
}

/** Fresh run with the header's car; throws on an unknown car id or an out-of-range skill. */
export function startRun(header: RunHeader, cars: CarRegistry<CarParams>): Run {
  const params = createSimParams(cars.get(header.car), header.skill);
  return { params, state: createState(header.seed, createCar(params)) };
}

/** Replays a validated input log with the car it names (S002-AC-10). */
export function replayRun(log: InputLog, cars: CarRegistry<CarParams>, perTickHashes = false): ReplayResult<CarState> {
  const run = startRun(log, cars);
  return replay(log.frames, run.state, run.params, carStep, perTickHashes);
}
