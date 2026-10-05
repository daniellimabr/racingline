// S002-AC-10 (part 2): a run recorded with car X, saved as an input log and replayed, uses car X
// and reproduces the same state hash, with the real GT3 car file (S002-T4).
import { describe, expect, test } from 'vitest';
import { step } from '../../src/core/sim.ts';
import { hashState } from '../../src/core/hash.ts';
import { createCarRegistry } from '../../src/core/car-registry.ts';
import { INPUT_LOG_VERSION, parseInputLog, SUB_STEPS, TICK_SECONDS, type InputLog } from '../../src/data/input-log.ts';
import { replayRun, startRun } from '../../src/run.ts';
import { carStep, loadCarParams } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import gt3 from '../../src/cars/gt3.json';
import { scriptedLog } from './helpers.ts';

const cars = createCarRegistry([loadCarParams(s15, 's15-drift.json'), loadCarParams(gt3, 'gt3.json')]);
const frames = scriptedLog(600);

/** Plays a run live, tick by tick like the game loop, and records it as a saved input log. */
function record(car: string): { log: InputLog; hash: string } {
  const header = { seed: 4242, skill: 0.4, car };
  const run = startRun(header, cars);
  let state = run.state;
  for (const f of frames) state = step(state, f, run.params, carStep);
  const log: InputLog = {
    version: INPUT_LOG_VERSION, ...header, tickSeconds: TICK_SECONDS, subSteps: SUB_STEPS, frames,
  };
  return { log: parseInputLog(JSON.parse(JSON.stringify(log))), hash: hashState(state) };
}

describe('replay with the recorded car (S002-AC-10)', () => {
  test('replaying a GT3 run reproduces the live state hash', () => {
    const { log, hash } = record('gt3');
    expect(log.car).toBe('gt3');
    const r = replayRun(log, cars, true);
    expect(r.state.tick).toBe(600);
    expect(hashState(r.state)).toBe(hash);
    expect(r.hashes).toHaveLength(600);
  });

  test('replaying an S15 run reproduces its hash, and the car id changes the result', () => {
    const a = record('s15-drift');
    const b = record('gt3');
    expect(hashState(replayRun(a.log, cars).state)).toBe(a.hash);
    expect(a.hash).not.toBe(b.hash);
    expect(hashState(replayRun({ ...b.log, car: 's15-drift' }, cars).state)).toBe(a.hash);
  });

  test('a log naming a car that is not in the registry is rejected', () => {
    const { log } = record('s15-drift');
    expect(() => replayRun({ ...log, car: 'gt3-unknown' }, cars)).toThrow(/unknown car id "gt3-unknown"/);
  });
});
