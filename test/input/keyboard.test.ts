// S001-AC-11: key down/up events -> expected InputFrame (mirrors prototype-v24.html lines 79-85).
import { describe, expect, expectTypeOf, test, vi } from 'vitest';
import { KeyboardDevice, combine, type KeyTarget } from '../../src/input/index.ts';
import type { InputFrame } from '../../src/core/input-frame.ts';

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
  const count = () => [...listeners.values()].reduce((n, s) => n + s.size, 0);
  return { target, fire, count };
}

const IDLE: InputFrame = {
  throttle: 0, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false,
};

describe('KeyboardDevice (S001-AC-11)', () => {
  test('no keys yields an idle frame', () => {
    const { target } = fakeTarget();
    expect(new KeyboardDevice(target).sample()).toEqual(IDLE);
  });

  test.each([
    ['KeyW', 'throttle'], ['ArrowUp', 'throttle'],
    ['KeyS', 'brake'], ['ArrowDown', 'brake'],
    ['KeyA', 'left'], ['ArrowLeft', 'left'],
    ['KeyD', 'right'], ['ArrowRight', 'right'],
  ] as const)('%s held -> %s = 1 until released', (code, field) => {
    const { target, fire } = fakeTarget();
    const kb = new KeyboardDevice(target);
    const down = fire('keydown', code);
    expect(down.preventDefault).toHaveBeenCalled();
    expect(kb.sample()).toEqual({ ...IDLE, [field]: 1 });
    expect(kb.sample()).toEqual({ ...IDLE, [field]: 1 });
    fire('keyup', code);
    expect(kb.sample()).toEqual(IDLE);
  });

  test('two keys for one action share state, as in v24 (release of either clears it)', () => {
    const { target, fire } = fakeTarget();
    const kb = new KeyboardDevice(target);
    fire('keydown', 'KeyW');
    fire('keydown', 'ArrowUp');
    fire('keyup', 'ArrowUp');
    expect(kb.sample().throttle).toBe(0);
  });

  test('combined keys yield combined frame', () => {
    const { target, fire } = fakeTarget();
    const kb = new KeyboardDevice(target);
    fire('keydown', 'KeyW');
    fire('keydown', 'KeyA');
    fire('keydown', 'KeyS');
    expect(kb.sample()).toEqual({ ...IDLE, throttle: 1, brake: 1, left: 1 });
  });

  test('unmapped keys are ignored and not prevented', () => {
    const { target, fire } = fakeTarget();
    const kb = new KeyboardDevice(target);
    const e = fire('keydown', 'KeyQ');
    fire('keyup', 'KeyQ');
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(kb.sample()).toEqual(IDLE);
  });

  test('focus loss releases all held keys', () => {
    const { target, fire } = fakeTarget();
    const kb = new KeyboardDevice(target);
    fire('keydown', 'KeyW');
    fire('keydown', 'KeyD');
    fire('blur');
    expect(kb.sample()).toEqual(IDLE);
  });
});

describe('one-tick presses', () => {
  test.each([
    ['Period', 'shiftUp'], ['NumpadDecimal', 'shiftUp'],
    ['Comma', 'shiftDown'], ['KeyM', 'toggleAuto'],
  ] as const)('%s -> %s for exactly one sample', (code, field) => {
    const { target, fire } = fakeTarget();
    const kb = new KeyboardDevice(target);
    const e = fire('keydown', code);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(kb.sample()).toEqual({ ...IDLE, [field]: true });
    expect(kb.sample()).toEqual(IDLE); // still held: not repeated
  });

  test('a press released before the next sample is still delivered once', () => {
    const { target, fire } = fakeTarget();
    const kb = new KeyboardDevice(target);
    fire('keydown', 'Period');
    fire('keyup', 'Period');
    expect(kb.sample().shiftUp).toBe(true);
    expect(kb.sample().shiftUp).toBe(false);
  });

  test('key repeat is ignored', () => {
    const { target, fire } = fakeTarget();
    const kb = new KeyboardDevice(target);
    fire('keydown', 'Comma');
    kb.sample();
    fire('keydown', 'Comma', true);
    fire('keydown', 'KeyM', true);
    expect(kb.sample()).toEqual(IDLE);
  });

  test('a pending press survives focus loss (v24 acts on keydown)', () => {
    const { target, fire } = fakeTarget();
    const kb = new KeyboardDevice(target);
    fire('keydown', 'KeyM');
    fire('blur');
    expect(kb.sample().toggleAuto).toBe(true);
  });
});

describe('pause and lifecycle', () => {
  test('P calls onPause once per press, prevents default, and is not in the frame', () => {
    const { target, fire } = fakeTarget();
    const onPause = vi.fn();
    const kb = new KeyboardDevice(target, { onPause });
    const e = fire('keydown', 'KeyP');
    fire('keydown', 'KeyP', true);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(kb.sample()).toEqual(IDLE);
  });

  test('P without onPause is a no-op', () => {
    const { target, fire } = fakeTarget();
    const kb = new KeyboardDevice(target);
    fire('keydown', 'KeyP');
    expect(kb.sample()).toEqual(IDLE);
  });

  test('a real canvas or window fits the event-source shape (type-level)', () => {
    type Fits = [HTMLCanvasElement, Window] extends [KeyTarget, KeyTarget] ? true : false;
    expectTypeOf<Fits>().toEqualTypeOf<true>();
  });

  test('dispose removes every listener and clears state', () => {
    const { target, fire, count } = fakeTarget();
    const kb = new KeyboardDevice(target);
    expect(count()).toBe(3);
    fire('keydown', 'KeyW');
    kb.dispose();
    expect(count()).toBe(0);
    fire('keydown', 'Period');
    expect(kb.sample()).toEqual(IDLE);
  });
});

describe('combine', () => {
  test('max of analog values and OR of presses; empty list is idle', () => {
    const a = { sample: () => ({ throttle: 0.4, left: 1, shiftUp: true }), dispose: () => {} };
    const b = { sample: () => ({ throttle: 0.7, brake: 0.2, toggleAuto: true }), dispose: () => {} };
    expect(combine([a, b])).toEqual({
      throttle: 0.7, brake: 0.2, left: 1, right: 0, shiftUp: true, shiftDown: false, toggleAuto: true,
    });
    expect(combine([])).toEqual(IDLE);
  });

  test('analog values are clamped to 0..1 and non-finite values are treated as 0', () => {
    const d = { sample: () => ({ throttle: 1.5, brake: -1, left: Number.NaN }), dispose: () => {} };
    expect(combine([d])).toEqual({ ...IDLE, throttle: 1 });
  });
});
