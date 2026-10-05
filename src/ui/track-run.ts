// STAND-IN, remove when S003-T5 merges. Mirrors the run setup agreed with Back End in
// docs/sprints/SPRINT-003/mailbox/back-end-to-front-end-track-api.md, so the screen is built against that
// shape: startRun({seed, car, track}) with params.track, and lapProgress(car) for the lap HUD.
// Until then the car starts at the track's spawn on an all-tarmac area and no lap times are kept.
import type { CarRegistry } from '../core/car-registry.ts';
import { createState, type SimState } from '../core/sim.ts';
import type { Track } from '../data/track.ts';
import { createCar, createSimParams, TEST_LOT, type CarParams, type CarState, type SimParams } from '../sim/index.ts';
import { TRACKS } from '../tracks/index.ts';
import type { LapProgress } from './hud-lap.ts';
import { LOT_ID } from './track-chooser.ts';

export interface TrackRunHeader {
  seed: number;
  car: string;
  /** A shipped track id, or "lot" (the default) for the test lot. */
  track?: string;
}

export interface TrackRun {
  params: SimParams;
  state: SimState<CarState>;
  track: Track | null;
}

/** Throws on an unknown car or track id. */
export function startTrackRun(header: TrackRunHeader, cars: CarRegistry<CarParams>, tracks: readonly Track[] = TRACKS): TrackRun {
  const car = cars.get(header.car), id = header.track ?? LOT_ID;
  if (id === LOT_ID) {
    const params = createSimParams(car);
    return { params, state: createState(header.seed, createCar(params)), track: null };
  }
  const track = tracks.find((t) => t.id === id);
  if (!track) throw new Error(`unknown track id "${id}" (known: ${[LOT_ID, ...tracks.map((t) => t.id)].join(', ')})`);
  // The paved area covers the whole circuit, so the car is never "off" until surfaces arrive (S003-T6).
  const S = TEST_LOT.scale, xs = track.points.map((p) => p[0]), ys = track.points.map((p) => p[1]), pad = 500;
  const params = createSimParams(car, {
    ...TEST_LOT,
    x0: (Math.min(...xs) - pad) * S, y0: (Math.min(...ys) - pad) * S, x1: (Math.max(...xs) + pad) * S, y1: (Math.max(...ys) + pad) * S,
    startX: track.spawn.x * S, startY: track.spawn.y * S,
  });
  return { params, state: createState(header.seed, { ...createCar(params), x: track.spawn.x, y: track.spawn.y, h: track.spawn.h }), track };
}

/** No lap timing exists before S003-T5; the HUD then shows no lap panel. */
export function lapProgress(_car: CarState): LapProgress | null {
  return null;
}
