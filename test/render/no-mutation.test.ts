// S001-AC-12, extended by S002-AC-11 to both cars: rendering only reads sim state. The state hash is identical before and after every
// render call, and the state is deep-frozen while drawing, so any write would throw.
import { expect, it } from 'vitest';
import { hashState } from '../../src/core/hash.ts';
import type { InputFrame } from '../../src/core/input-frame.ts';
import { createState, step, type SimState } from '../../src/core/sim.ts';
import { carStep, createCar, createSimParams, loadCarParams, type CarState } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import gt3 from '../../src/cars/gt3.json';
import { buildLot, type CanvasFactory } from '../../src/render/lot.ts';
import { drawScene } from '../../src/render/scene.ts';
import { drawTelemetry } from '../../src/render/telemetry.ts';
import { createView, recordTick } from '../../src/render/view.ts';
import { carHud } from '../../src/ui/hud-car.ts';
import { deepFreeze } from '../core/helpers.ts';

/** Canvas 2D stand-in: every method is a counted no-op, properties store what is written. */
function stubContext(counter: { calls: number }): CanvasRenderingContext2D {
  const props: Record<string | symbol, unknown> = {};
  return new Proxy(props, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return () => ({ width: 40 });
      return () => void counter.calls++;
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const idle: InputFrame = { throttle: 0, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false };
// Accelerate, flick right, then hold left with throttle: grip, halo, slide and drift paths all show up.
const frameAt = (i: number): InputFrame =>
  i < 150 ? { ...idle, throttle: 1 }
  : i < 190 ? { ...idle, throttle: 1, right: 1 }
  : i < 420 ? { ...idle, throttle: 1, left: 1 }
  : { ...idle, brake: 1 };

it.each([
  ['s15-drift', s15],
  ['gt3', gt3],
])('drawing the scene, HUD and telemetry never changes the sim state (%s)', (id, json) => {
  const params = createSimParams(loadCarParams(json, `${id}.json`));
  const counter = { calls: 0 };
  const ctx = stubContext(counter);
  const factory: CanvasFactory = (width, height) => ({ width, height, getContext: () => ctx });
  const lot = buildLot(factory, params.lot);
  const view = createView(7);
  let state: SimState<CarState> = createState(3, createCar(params));
  let checked = 0;
  for (let i = 0; i < 430; i++) {
    state = deepFreeze(step(state, frameAt(i), params, carStep));
    const before = hashState(state);
    recordTick(view, state.car, params, 1 / 60);
    if (i % 20 === 0) {
      drawScene(ctx, { car: state.car, params, view, lot, paused: i % 40 === 0, dt: 1 / 60 });
      drawTelemetry(ctx, view, state.car.tt, i % 40 === 0, carHud(params.car).rpmScale);
      checked++;
    }
    expect(hashState(state), `tick ${i}`).toBe(before);
  }
  expect(checked).toBeGreaterThan(20);
  expect(counter.calls).toBeGreaterThan(1000); // the renderer really drew
  expect(state.car.v).toBeGreaterThan(1); // the run moved the car
  // The S15 script also ends drifts, so the drift, spin and halo paths are drawn; the grippier GT3 stays in grip.
  if (id === 's15-drift') expect(state.car.drifts.length).toBeGreaterThan(0);
});
