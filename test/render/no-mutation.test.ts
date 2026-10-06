// S001-AC-12, extended by S002-AC-11 to both cars, by S003-AC-12 to Interlagos and by S004-AC-10 to boards and kerbs: rendering only reads sim state. The state hash
// is identical before and after every render call, and the state (and the track art) is deep-frozen while drawing, so any write would throw.
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
import { buildTrackArt } from '../../src/render/track.ts';
import { createCarRegistry } from '../../src/core/car-registry.ts';
import { startRun } from '../../src/run.ts';
import type { LapProgress } from '../../src/ui/hud-lap.ts';
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
      drawScene(ctx, { car: state.car, params, view, lot, paused: i % 40 === 0, dt: 1 / 60, track: null, lap: null });
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

// A lap HUD fixture in the agreed shape, so the lap panel is drawn too (the sim fills it from S003-T5).
const lapAt = (i: number): LapProgress => ({
  lap: 1 + Math.floor(i / 200), sector: (1 + (Math.floor(i / 60) % 3)) as 1 | 2 | 3, time: i / 60, splits: i % 180 > 60 ? [20.5] : [],
  valid: i % 100 < 50, last: i > 200 ? { time: 99, sectors: [33, 33, 33], valid: false } : null,
  best: { time: 98.5, sectors: [32, 33, 33.5], valid: true },
});

it.each([
  ['s15-drift', 'interlagos'],
  ['gt3', 'interlagos'],
  ['s15-drift', 'lot'],
  ['gt3', 'interlagos+boards'],
])('drawing the scene on a track never changes the sim state (%s on %s)', (car, choice) => {
  // 'interlagos+boards' adds braking points and apex kerbs in the shape agreed with Database (S004-AC-10).
  const trackId = choice.replace('+boards', '');
  const cars = createCarRegistry([loadCarParams(s15, 's15-drift.json'), loadCarParams(gt3, 'gt3.json')]);
  const run = startRun({ seed: 3, car, track: trackId }, cars);
  const params = deepFreeze(run.params);
  const marks = choice.endsWith('+boards')
    ? { brakePoints: [{ s: 120, name: 'S do Senna' }, { s: 2400, name: 'Pinheirinho' }], apexKerbs: [{ from: 60, to: 140, side: 'left' as const, width: 3 }] }
    : {};
  const art = params.track ? deepFreeze(buildTrackArt({ ...params.track, ...marks }, params.lot.scale)) : null;
  expect(art !== null).toBe(trackId !== 'lot');
  const counter = { calls: 0 };
  const ctx = stubContext(counter);
  const factory: CanvasFactory = (width, height) => ({ width, height, getContext: () => ctx });
  const lot = buildLot(factory, params.lot);
  const view = createView(7);
  let state = deepFreeze(run.state);
  if (art) expect([state.car.x, state.car.y, state.car.h]).toEqual([params.track!.spawn.x, params.track!.spawn.y, params.track!.spawn.h]);
  for (let i = 0; i < 430; i++) {
    state = deepFreeze(step(state, frameAt(i), params, carStep));
    const before = hashState(state);
    recordTick(view, state.car, params, 1 / 60);
    if (i % 20 === 0) {
      const lap = art ? deepFreeze(lapAt(i)) : null;
      drawScene(ctx, { car: state.car, params, view, lot, paused: i % 40 === 0, dt: 1 / 60, track: art, lap });
    }
    expect(hashState(state), `tick ${i}`).toBe(before);
  }
  expect(counter.calls).toBeGreaterThan(1000);
  expect(state.car.v).toBeGreaterThan(1);
});
