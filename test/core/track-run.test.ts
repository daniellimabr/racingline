// S003-T5: the run starts on a chosen track, the test lot (today's behavior) or Interlagos (car at the
// track's spawn). The track id is part of the run header and the input log, so a replay uses the same track.
import { describe, expect, it } from 'vitest';
import { hashState } from '../../src/core/hash.ts';
import { createCarRegistry } from '../../src/core/car-registry.ts';
import { deserialize, serialize } from '../../src/core/serialize.ts';
import { replay } from '../../src/core/sim.ts';
import { INPUT_LOG_VERSION, validateInputLog, type InputLog } from '../../src/data/input-log.ts';
import { LOT_TRACK_ID, replayRun, startRun, TRACK_CHOICES } from '../../src/run.ts';
import { carStep, loadCarParams, type CarState } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import { scriptedLog } from './helpers.ts';

const cars = createCarRegistry([loadCarParams(s15, 's15-drift.json')]);
const frames = scriptedLog(240);
const log = (track?: string): InputLog => ({
  version: INPUT_LOG_VERSION, seed: 9, car: 's15-drift', tickSeconds: 1 / 60, subSteps: 10, frames, ...(track === undefined ? {} : { track }),
});

describe('track choice in the run setup', () => {
  it('lists the test lot first, then the shipped tracks', () => {
    expect(TRACK_CHOICES.map((t) => t.id)).toEqual([LOT_TRACK_ID, 'interlagos']);
    expect(TRACK_CHOICES[1]!.name).toBe('Interlagos');
  });

  it('no track and the lot id start the same lot run as before, with no track data', () => {
    const a = startRun({ seed: 3, car: 's15-drift' }, cars), b = startRun({ seed: 3, car: 's15-drift', track: 'lot' }, cars);
    expect(hashState(b.state)).toBe(hashState(a.state));
    expect(a.params.track).toBeUndefined();
    expect('lap' in a.state.car).toBe(false);
  });

  it('Interlagos spawns the car at the track spawn with an empty lap record', () => {
    const r = startRun({ seed: 3, car: 's15-drift', track: 'interlagos' }, cars);
    const { x, y, h } = r.params.track!.spawn;
    expect([r.state.car.x, r.state.car.y, r.state.car.h]).toEqual([x, y, h]);
    expect(r.state.car.lap).toMatchObject({ track: 'interlagos', lap: 0, next: 0, last: null, best: null, events: [] });
  });

  it('an unknown track id fails with the known ids', () => {
    expect(() => startRun({ seed: 3, car: 's15-drift', track: 'monza' }, cars)).toThrow(/unknown track id "monza".*lot, interlagos/);
  });

  it('the input log may name its track and a replay uses it', () => {
    expect(validateInputLog(log('interlagos')).ok).toBe(true);
    expect(validateInputLog({ ...log(), track: 7 }).ok).toBe(false);
    const lot = replayRun(log(), cars).state, onLot = replayRun(log('lot'), cars).state, ring = replayRun(log('interlagos'), cars).state;
    expect(hashState(onLot)).toBe(hashState(lot));
    expect(hashState(ring)).not.toBe(hashState(lot));
    expect(ring.car.lap!.track).toBe('interlagos');
  });

  it('an Interlagos state survives serialization and continues bit-identically', () => {
    const run = startRun({ seed: 4, car: 's15-drift', track: 'interlagos' }, cars);
    const mid = replay(frames.slice(0, 120), run.state, run.params, carStep).state;
    const back = deserialize<CarState>(serialize(mid));
    const a = replay(frames.slice(120), mid, run.params, carStep).state;
    const b = replay(frames.slice(120), back, run.params, carStep).state;
    expect(hashState(b)).toBe(hashState(a));
  });
});
