// S001-AC-03: same seed + same input log => identical state hash.
import { describe, expect, test } from 'vitest';
import { createState, replay, step, SUBSTEPS, TICK } from '../../src/core/sim.ts';
import { hashState } from '../../src/core/hash.ts';
import { deepFreeze, scriptedLog, testCar, testCarStep, testParams } from './helpers.ts';

const log = scriptedLog(600);

describe('S001-AC-03 replay determinism', () => {
  test('two runs with the same seed and log give the same final hash', () => {
    const a = replay(log, createState(42, testCar()), testParams, testCarStep);
    const b = replay(log, createState(42, testCar()), testParams, testCarStep);
    expect(a.state.tick).toBe(600);
    expect(hashState(a.state)).toBe(hashState(b.state));
    expect(a.state).toEqual(b.state);
  });

  test('per-tick hashes are identical across runs and only produced on request', () => {
    const a = replay(log, createState(7, testCar()), testParams, testCarStep, true);
    const b = replay(log, createState(7, testCar()), testParams, testCarStep, true);
    expect(a.hashes).toHaveLength(600);
    expect(a.hashes).toEqual(b.hashes);
    expect(replay(log, createState(7, testCar()), testParams, testCarStep).hashes).toBeUndefined();
  });

  test('the seed only sets the random-number state; with no draws the car is the same (S002-T10)', () => {
    const a = replay(log, createState(1, testCar()), testParams, testCarStep);
    const b = replay(log, createState(2, testCar()), testParams, testCarStep);
    expect(hashState(a.state)).not.toBe(hashState(b.state));
    expect(a.state.car).toEqual(b.state.car);
  });
});

describe('step', () => {
  test('passes dt and substeps to carStep and draws no random number (S002-T10: wobble removed)', () => {
    const seen: unknown[] = [];
    const s0 = createState(1, { n: 0 });
    const s1 = step(s0, log[0]!, null, (car, _i, _p, ctx) => {
      seen.push(ctx);
      return { n: car.n + 1 };
    });
    expect(seen).toEqual([{ dt: TICK, substeps: SUBSTEPS }]);
    expect(s1).toEqual({ v: 1, tick: 1, rng: s0.rng, car: { n: 1 } });
  });

  test('does not mutate its inputs (frozen state, input and params)', () => {
    const s0 = deepFreeze(createState(3, testCar()));
    const input = deepFreeze({ ...log[0]! });
    const params = deepFreeze({ ...testParams });
    expect(() => replay([input, input], s0, params, testCarStep)).not.toThrow();
    expect(s0.tick).toBe(0);
  });

  test('TICK is 1/60 s and SUBSTEPS is 10 (v24)', () => {
    expect(TICK).toBe(1 / 60);
    expect(SUBSTEPS).toBe(10);
  });
});
