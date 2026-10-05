// S002-AC-01 / S002-AC-02: car files carry an id, a display name and optional aero fields.
// The GT3 values below are a test fixture only; the real numbers come from ADR-004 in T4 (gt3.json).
import { describe, expect, it } from 'vitest';
import { DataError } from '../../src/data/check.ts';
import { loadCarParams } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';

const GT3_LIKE: Record<string, unknown> = {
  ...s15,
  id: 'gt3',
  name: 'GT3',
  downforceArea: 3.2,
  dragArea: 1.1,
  aeroBalanceFront: 0.42,
  airDensity: 1.2,
};
const gt3 = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ ...GT3_LIKE, ...over });
const without = (key: string, src: Record<string, unknown> = GT3_LIKE): Record<string, unknown> => {
  const copy = { ...src };
  delete copy[key];
  return copy;
};
const reasons = (v: unknown): string => {
  try {
    loadCarParams(v, 'car.json');
  } catch (e) {
    expect(e).toBeInstanceOf(DataError);
    return (e as Error).message;
  }
  throw new Error('expected the car params to be rejected');
};

describe('car identity', () => {
  it('s15-drift.json carries its id and HUD name', () => {
    const car = loadCarParams(s15, 's15-drift.json');
    expect(car.id).toBe('s15-drift');
    expect(car.name).toBe('S15 Drift');
  });

  it.each(['id', 'name'])('rejects a missing "%s"', (k) => {
    expect(reasons(without(k))).toContain(`$.${k}: missing field`);
  });

  it.each(['GT3', 'gt 3', 'gt_3', '-gt3', 'gt3-', 'gt--3', ''])('rejects the id %j', (id) => {
    expect(reasons(gt3({ id }))).toContain('$.id:');
  });

  it.each(['gt3', 's15-drift', 'a1-b2-c3'])('accepts the id %j', (id) => {
    expect(loadCarParams(gt3({ id }), 'car.json').id).toBe(id);
  });

  it('rejects an empty or non-string name', () => {
    expect(reasons(gt3({ name: '' }))).toContain('$.name: expected a non-empty string');
    expect(reasons(gt3({ name: 3 }))).toContain('$.name: expected a string');
  });
});

describe('aero fields (S002-AC-02)', () => {
  it('s15-drift.json has no aero fields and loads with zero aero', () => {
    for (const k of ['downforceArea', 'dragArea', 'aeroBalanceFront', 'airDensity']) expect(Object.hasOwn(s15, k)).toBe(false);
    const car = loadCarParams(s15, 's15-drift.json');
    expect(car.downforceArea).toBe(0);
    expect(car.dragArea).toBe(0);
    expect(car.aeroBalanceFront).toBe(0);
    expect(car.airDensity).toBe(1.225);
  });

  it('does not change the input object when it fills defaults', () => {
    const json = structuredClone(s15) as Record<string, unknown>;
    loadCarParams(json, 's15-drift.json');
    expect(json).toEqual(s15);
  });
});

describe('aero fields (S002-AC-01)', () => {
  it('a GT3-like file with aero loads with its values', () => {
    const car = loadCarParams(GT3_LIKE, 'gt3.json');
    expect(car).toMatchObject({ id: 'gt3', name: 'GT3', downforceArea: 3.2, dragArea: 1.1, aeroBalanceFront: 0.42, airDensity: 1.2 });
  });

  it('round-trips through JSON (write -> read -> equal)', () => {
    const car = loadCarParams(GT3_LIKE, 'gt3.json');
    expect(loadCarParams(JSON.parse(JSON.stringify(GT3_LIKE)), 'gt3.json')).toEqual(car);
  });

  it.each([
    ['downforceArea', -0.1],
    ['dragArea', -1],
    ['airDensity', -1.2],
    ['aeroBalanceFront', -0.01],
  ])('rejects negative %s = %s and names the field', (k, value) => {
    expect(reasons(gt3({ [k]: value }))).toMatch(new RegExp(`car\\.json[\\s\\S]*\\$\\.${k}: expected a value in`));
  });

  it.each(['downforceArea', 'dragArea', 'aeroBalanceFront', 'airDensity'])('rejects NaN and infinite %s', (k) => {
    // NaN and Infinity only reach the loader from code, since JSON cannot hold them.
    expect(reasons(gt3({ [k]: Number.NaN }))).toContain(`$.${k}: expected a finite number, got NaN`);
    expect(reasons(gt3({ [k]: Number.POSITIVE_INFINITY }))).toContain(`$.${k}: expected a finite number`);
    expect(reasons(gt3({ [k]: Number.NEGATIVE_INFINITY }))).toContain(`$.${k}: expected a finite number`);
  });

  it.each([1.01, 2, -0.5])('rejects aeroBalanceFront = %s (outside 0..1)', (v) => {
    expect(reasons(gt3({ aeroBalanceFront: v }))).toContain('$.aeroBalanceFront: expected a value in 0..1');
  });

  it('accepts aeroBalanceFront at 0 and 1', () => {
    expect(loadCarParams(gt3({ aeroBalanceFront: 0 }), 'car.json').aeroBalanceFront).toBe(0);
    expect(loadCarParams(gt3({ aeroBalanceFront: 1 }), 'car.json').aeroBalanceFront).toBe(1);
  });

  it('rejects a wrong-type aero value', () => {
    expect(reasons(gt3({ dragArea: '1.1' }))).toContain('$.dragArea: expected a number');
  });

  it('requires aeroBalanceFront when the car has downforce', () => {
    expect(reasons(without('aeroBalanceFront'))).toContain('$.aeroBalanceFront: required when downforceArea is above 0');
    const noDownforce = without('aeroBalanceFront', gt3({ downforceArea: 0 }));
    expect(loadCarParams(noDownforce, 'car.json').aeroBalanceFront).toBe(0);
  });

  it('lists every bad aero field in one error', () => {
    const msg = reasons(gt3({ downforceArea: -1, dragArea: Number.NaN, aeroBalanceFront: 1.5 }));
    expect(msg).toContain('3 problems');
  });
});
