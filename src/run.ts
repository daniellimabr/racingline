// Run setup (S002-T6, S003-T5): a run starts from its recorded header (seed, car id, track id). The live
// game and a replay of a saved input log go through the same function, so a replay uses the recorded car
// and track. Track API agreed in docs/sprints/SPRINT-003/mailbox/back-end-to-front-end-track-api.md.
import type { CarRegistry } from './core/car-registry.ts';
import { createState, replay, type ReplayResult, type SimState } from './core/sim.ts';
import type { InputLog } from './data/input-log.ts';
import type { Track } from './data/track.ts';
import { carStep, createCar, createLapState, createSimParams, TEST_LOT, type CarParams, type CarState, type SimParams } from './sim/index.ts';
import { TRACKS } from './tracks/index.ts';
import { surfaceAt } from './tracks/surface-at.ts';

/** The input log header fields that decide the starting state; no track means the test lot. */
export type RunHeader = Pick<InputLog, 'seed' | 'car' | 'track'>;

export interface Run {
  params: SimParams;
  state: SimState<CarState>;
}

/** Track id of the test lot (no track file; today's behavior). */
export const LOT_TRACK_ID = 'lot';

export interface TrackChoice {
  readonly id: string;
  readonly name: string;
}

/** The track chooser's list, in order: the test lot first, then every shipped track. */
export const TRACK_CHOICES: readonly TrackChoice[] = Object.freeze([
  { id: LOT_TRACK_ID, name: 'Pátio de testes' },
  ...TRACKS.map((t) => ({ id: t.id, name: t.name })),
]);

/** Fresh run with the header's car on the header's track; throws on an unknown car or track id. */
export function startRun(header: RunHeader, cars: CarRegistry<CarParams>, tracks: readonly Track[] = TRACKS): Run {
  const car = cars.get(header.car);
  const id = header.track ?? LOT_TRACK_ID;
  if (id === LOT_TRACK_ID) {
    const params = createSimParams(car);
    return { params, state: createState(header.seed, createCar(params)) };
  }
  const track = tracks.find((t) => t.id === id);
  if (track === undefined) {
    throw new Error(`unknown track id "${id}" (known: ${[LOT_TRACK_ID, ...tracks.map((t) => t.id)].join(', ')})`);
  }
  // The lot settings stay for the drawing scale (px per m), so cars draw the same size on every track.
  // S003-T6: the physics reads the surface under each axle through Back End's lookup.
  const params: SimParams = { ...createSimParams(car, TEST_LOT, track), surfaceAt };
  const { x, y, h } = track.spawn;
  return { params, state: createState(header.seed, { ...createCar(params), x, y, h, lap: createLapState(track) }) };
}

/** Replays a validated input log with the car and track it names (S002-AC-10, S003-T5). */
export function replayRun(log: InputLog, cars: CarRegistry<CarParams>, perTickHashes = false): ReplayResult<CarState> {
  const run = startRun(log, cars);
  return replay(log.frames, run.state, run.params, carStep, perTickHashes);
}
