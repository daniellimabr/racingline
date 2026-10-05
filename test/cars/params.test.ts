// S001-AC-09: s15-drift.json loads; invalid or missing fields are rejected with a clear error.
import { describe, expect, it } from 'vitest';
import { DataError } from '../../src/data/check.ts';
import { CAR_SCHEMA, createSimParams, loadCarParams } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';

const file = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ ...s15, ...over });
const reasons = (v: unknown): string => {
  try {
    loadCarParams(v, 'test.json');
  } catch (e) {
    expect(e).toBeInstanceOf(DataError);
    return (e as Error).message;
  }
  throw new Error('expected the car params to be rejected');
};

describe('S15 car params (S001-AC-09)', () => {
  it('loads s15-drift.json with the v24 values', () => {
    const car = loadCarParams(s15, 's15-drift.json');
    expect(car.id).toBe('s15-drift');
    expect(car.mass).toBe(1335);
    expect(car.gears).toEqual([3.321, 1.902, 1.308, 1.0, 0.759, 0.646]);
    expect(car.maxSteer).toBe((60 * Math.PI) / 180);
    expect(car.la).toBe(0.45 * 2.525);
    expect(car.lb).toBe(0.55 * 2.525);
    expect(car.iz).toBe(0.45 * 2.525 * (0.55 * 2.525));
  });

  it('the schema plus the shared id and name list exactly the fields of the file', () => {
    expect([...Object.keys(CAR_SCHEMA), 'id', 'name'].sort()).toEqual(Object.keys(s15).sort());
  });

  it.each(['mass', 'gear3', 'tireB', 'finalDrive'])('rejects a missing field "%s" and names it', (k) => {
    const bad = file();
    delete bad[k];
    expect(reasons(bad)).toContain(`$.${k}: missing field`);
  });

  it('rejects out-of-range, wrong-type and unknown fields, naming the file', () => {
    const msg = reasons(file({ mass: -5, wheelbase: '2.5', turbo: 1 }));
    expect(msg).toContain('test.json');
    expect(msg).toContain('$.mass: expected a value in');
    expect(msg).toContain('$.wheelbase: expected a number');
    expect(msg).toContain('$.turbo: unknown field');
  });

  it('rejects axle fractions that do not add up to one', () => {
    expect(reasons(file({ rearAxleFraction: 0.6 }))).toContain('frontAxleFraction + rearAxleFraction');
  });

  it('rejects rpm limits out of order', () => {
    expect(reasons(file({ cutResumeRpm: 7700 }))).toContain('cutResumeRpm');
    expect(reasons(file({ idleRpm: 7400 }))).toContain('idleRpm');
  });

  it('rejects a skill outside 0..1', () => {
    const car = loadCarParams(s15, 's15-drift.json');
    expect(() => createSimParams(car, 1.5)).toThrow(/skill/);
    expect(() => createSimParams(car, Number.NaN)).toThrow(/skill/);
    expect(createSimParams(car, 1).skill).toBe(1);
  });
});
