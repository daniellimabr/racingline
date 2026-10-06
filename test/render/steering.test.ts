// S005-AC-10 (steering half): the steering bar and the wheels in the axle diagram show the sim's steering state,
// so they follow the wheel back to centre after the key is let go (S005-T2 return to centre). Render gets no keys.
import { expect, it } from 'vitest';
import type { InputFrame } from '../../src/core/input-frame.ts';
import { createState, step, type SimState } from '../../src/core/sim.ts';
import { carStep, createCar, createSimParams, loadCarParams, type CarState } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import { buildLot } from '../../src/render/lot.ts';
import { drawScene, STEER_BAR } from '../../src/render/scene.ts';
import { createView } from '../../src/render/view.ts';
import { factoryFor, recordingContext } from './canvas-stub.ts';

const params = createSimParams(loadCarParams(s15, 's15-drift.json'));
const idle: InputFrame = { throttle: 0, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false };

/** Width of the yellow steering fill, screen px, as drawn for this car. */
function barWidth(car: CarState): number {
  const rec = recordingContext();
  drawScene(rec.ctx, { car, params, view: createView(1), lot: buildLot(factoryFor(rec.ctx), params.lot), paused: false, dt: 1 / 60, track: null, lap: null });
  const fill = rec.calls.find(([k, a]) => k === 'fillRect' && a[1] === STEER_BAR.y && a[3] === STEER_BAR.h && a[2] !== STEER_BAR.w);
  return fill ? Math.abs(fill[1][2] as number) : 0;
}

it('the steering bar shows the sim steering angle, whatever the keys do', () => {
  // Hold right while rolling, then let go: the bar reads the car's steering, not the key, on every frame.
  let state: SimState<CarState> = createState(1, createCar(params));
  for (let i = 0; i < 160; i++) {
    state = step(state, i < 60 ? { ...idle, throttle: 1 } : i < 100 ? { ...idle, throttle: 1, right: 1 } : idle, params, carStep);
    if (i >= 60) expect(barWidth(state.car), `tick ${i}`).toBeCloseTo(Math.abs(state.car.st) * STEER_BAR.w / 2, 6);
  }
  expect(state.car.st).not.toBe(0); // the run really steered
  // A steering state on its way back to centre draws a shorter bar, down to nothing at centre.
  const car = state.car;
  expect(barWidth({ ...car, st: 0.6 })).toBeGreaterThan(barWidth({ ...car, st: 0.3 }));
  expect(barWidth({ ...car, st: 0.3 })).toBeGreaterThan(barWidth({ ...car, st: 0.05 }));
  expect(barWidth({ ...car, st: 0 })).toBe(0);
});
