// S002-AC-10 (part 1): the car-switch key (C) resets the run with the other car; ignored while paused.
import { describe, expect, test, vi } from 'vitest';
import { KeyboardDevice, idleFrame, type KeyTarget } from '../../src/input/index.ts';
import { createCarRegistry, switchCar } from '../../src/core/car-registry.ts';
import { startRun } from '../../src/run.ts';
import { createState } from '../../src/core/sim.ts';
import { createCar, loadCarParams } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import { secondCar } from '../cars/second-car.ts';

type Listener = (e: unknown) => void;
function fakeTarget() {
  const listeners = new Map<string, Set<Listener>>();
  const target: KeyTarget = {
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn as Listener);
    },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn as Listener),
  };
  const fire = (type: string, code = '', repeat = false) => {
    const e = { code, repeat, preventDefault: vi.fn() };
    for (const fn of listeners.get(type) ?? []) fn(e);
    return e;
  };
  return { target, fire };
}

const S15 = loadCarParams(s15, 's15-drift.json');
const B = secondCar();
const cars = createCarRegistry([S15, B]);

describe('car-switch key (S002-AC-10)', () => {
  test('C calls onCarSwitch once per press, is not an input and ignores key repeat', () => {
    const { target, fire } = fakeTarget();
    const onCarSwitch = vi.fn();
    const kb = new KeyboardDevice(target, { onCarSwitch });
    const e = fire('keydown', 'KeyC');
    fire('keydown', 'KeyC', true);
    expect(onCarSwitch).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(kb.sample()).toEqual(idleFrame());
  });

  test('C without a handler does nothing', () => {
    const { target, fire } = fakeTarget();
    const kb = new KeyboardDevice(target);
    expect(() => fire('keydown', 'KeyC')).not.toThrow();
    expect(kb.sample()).toEqual(idleFrame());
  });
});

describe('car registry', () => {
  test('lists cars in order, finds them by id and shows them by name', () => {
    expect(cars.list.map((c) => c.id)).toEqual(['s15-drift', 'test-car-b']);
    expect(cars.get('test-car-b').name).toBe('Test car B');
    expect(cars.has('s15-drift')).toBe(true);
    expect(cars.has('nope')).toBe(false);
  });

  test('next cycles through the cars and wraps around', () => {
    expect(cars.next('s15-drift').id).toBe('test-car-b');
    expect(cars.next('test-car-b').id).toBe('s15-drift');
    expect(createCarRegistry([S15]).next('s15-drift').id).toBe('s15-drift');
  });

  test('rejects an empty list, duplicate ids, empty ids and unknown ids', () => {
    expect(() => createCarRegistry([])).toThrow(/at least one car/);
    expect(() => createCarRegistry([S15, S15])).toThrow(/duplicate car id "s15-drift"/);
    expect(() => createCarRegistry([{ id: '', name: 'x' }])).toThrow(/empty car id/);
    expect(() => cars.get('gt3-missing')).toThrow(/unknown car id "gt3-missing"/);
    expect(() => cars.next('gt3-missing')).toThrow(/unknown car id/);
  });
});

describe('switchCar', () => {
  test('returns the other car id when running', () => {
    expect(switchCar(cars, 's15-drift', false)).toBe('test-car-b');
    expect(switchCar(cars, 'test-car-b', false)).toBe('s15-drift');
  });

  test('is ignored while paused', () => {
    expect(switchCar(cars, 's15-drift', true)).toBeNull();
  });
});

describe('startRun', () => {
  test('starts a fresh run with the car named in the header', () => {
    const run = startRun({ seed: 99, car: 'test-car-b' }, cars);
    expect(run.params.car).toBe(B);
    expect(run.state).toEqual(createState(99, createCar(run.params)));
    expect(run.state.car.rpm).toBe(B.idleRpm);
  });

  test('throws on an unknown car id', () => {
    expect(() => startRun({ seed: 1, car: 'nope' }, cars)).toThrow(/unknown car id "nope"/);
  });
});
