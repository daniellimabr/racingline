// S001-AC-05, revised in S002-T10: the steering wobble was the only use of the seeded random numbers
// and is removed, so the seed no longer reaches the car at all. Two seeds give the same car; only the
// unused random-number state in the sim envelope differs.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createState, replay } from '../../src/core/sim.ts';
import { parseReferenceTrace } from '../../src/data/trace.ts';
import { carStep, createCar, createSimParams, loadCarParams } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';

const trace = parseReferenceTrace(
  JSON.parse(readFileSync(new URL('../fixtures/v24/drift-countersteer.trace.json', import.meta.url), 'utf8')),
);
const frames = trace.inputLog.frames;
const p = createSimParams(loadCarParams(s15, 's15-drift.json'));
const run = (seed: number) => replay(frames, createState(seed, createCar(p)), p, carStep).state;

describe('the seed does not change the car (S001-AC-05, S002-T10)', () => {
  it('two seeds give the identical car after a drift scenario', () => {
    expect(run(2).car).toEqual(run(1).car);
  });

  it('the car state has no wobble value any more', () => {
    expect(Object.keys(run(1).car)).not.toContain('wob');
  });

  it('no random number is drawn per tick: the random-number state stays at its seeded value', () => {
    expect(run(1).rng).toBe(createState(1, null).rng);
  });
});
