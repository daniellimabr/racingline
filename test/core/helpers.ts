// Trivial test car and input log for the core tests (no physics; exercises every core path).
import type { InputFrame } from '../../src/core/input-frame.ts';
import type { CarStep } from '../../src/core/sim.ts';

export interface TestCar {
  x: number;
  v: number;
  gear: number;
  hist: number[];
}
export interface TestParams {
  accel: number;
}

export const testCar = (): TestCar => ({ x: 0, v: 0, gear: 1, hist: [] });
export const testParams: TestParams = { accel: 3.7 };

// Pure: returns a new car and sub-steps like v24 sim().
export const testCarStep: CarStep<TestCar, TestParams> = (car, input, params, ctx) => {
  let { x, v } = car;
  const h = ctx.dt / ctx.substeps;
  for (let i = 0; i < ctx.substeps; i++) {
    v += (input.throttle - input.brake) * params.accel * h + (input.right - input.left) * 0.1 * h;
    x += v * h;
  }
  const gear = car.gear + (input.shiftUp ? 1 : 0) - (input.shiftDown ? 1 : 0);
  return { x, v, gear, hist: [...car.hist.slice(-3), x] };
};

const idle: InputFrame = { throttle: 0, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false };

// Deterministic scripted log: throttle, steer and presses vary over n ticks.
export function scriptedLog(n: number): InputFrame[] {
  return Array.from({ length: n }, (_, i) => ({
    ...idle,
    throttle: i % 90 < 60 ? 1 : 0,
    brake: i % 90 >= 75 ? 0.5 : 0,
    left: i % 40 < 10 ? 1 : 0,
    right: i % 40 >= 25 && i % 40 < 35 ? 0.7 : 0,
    shiftUp: i % 120 === 30,
    shiftDown: i % 120 === 100,
    toggleAuto: i === 200,
  }));
}

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}
