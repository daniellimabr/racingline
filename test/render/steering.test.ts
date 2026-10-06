// S005-AC-10 (steering half): the steering bar and the wheels in the axle diagram show the sim's steering state,
// so they follow the wheel back to centre after the key is let go (S005-T2 return to centre). Render gets no keys.
// S005-T13 (blind round 3, m3): the bar shows the angle the road wheels really have (the sim's delta, as a share of
// the speed's lock), so it is back at centre when the sim holds the wheels straight; the steering travel is a faint mark.
import { expect, it } from 'vitest';
import type { InputFrame } from '../../src/core/input-frame.ts';
import { createState, step, type SimState } from '../../src/core/sim.ts';
import { carStep, createCar, createSimParams, loadCarParams, type CarState } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import { dLim } from '../../src/sim/physics.ts';
import { buildLot } from '../../src/render/lot.ts';
import { drawScene, STEER_BAR } from '../../src/render/scene.ts';
import { createView } from '../../src/render/view.ts';
import { factoryFor, recordingContext } from './canvas-stub.ts';

const params = createSimParams(loadCarParams(s15, 's15-drift.json'));
const idle: InputFrame = { throttle: 0, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false };

function draw(car: CarState) {
  const rec = recordingContext();
  drawScene(rec.ctx, { car, params, view: createView(1), lot: buildLot(factoryFor(rec.ctx), params.lot), paused: false, dt: 1 / 60, track: null, lap: null });
  return rec;
}
/** Width of the yellow steering fill, screen px, as drawn for this car. */
function barWidth(car: CarState): number {
  const fill = draw(car).calls.find(([k, a]) => k === 'fillRect' && a[1] === STEER_BAR.y && a[3] === STEER_BAR.h && a[2] !== STEER_BAR.w);
  return fill ? Math.abs(fill[1][2] as number) : 0;
}
/** The bar width the road-wheel angle should give: delta as a share of the speed's lock, at most full. */
const wheelWidth = (car: CarState): number => Math.min(1, Math.abs(car.delta) / dLim(params.car, car.v)) * STEER_BAR.w / 2;
/** Centre x of the faint steering-travel mark, or null when none is drawn. */
function keyMark(car: CarState): number | null {
  const m = draw(car).calls.find(([k, a]) => k === 'fillRect' && a[1] === STEER_BAR.y - 2 && a[2] === 2 && a[3] === STEER_BAR.h + 4);
  return m ? (m[1][0] as number) + 1 : null;
}

it('the steering bar shows the road-wheel angle, whatever the keys do', () => {
  // Hold right while rolling, then let go: the bar reads the car's steering, not the key, on every frame.
  let state: SimState<CarState> = createState(1, createCar(params));
  for (let i = 0; i < 106; i++) { // S005-T8: 6 free ticks, so the wheel is still on its way back (the slide return is now 2x the key)
    state = step(state, i < 60 ? { ...idle, throttle: 1 } : i < 100 ? { ...idle, throttle: 1, right: 1 } : idle, params, carStep);
    if (i >= 60) expect(barWidth(state.car), `tick ${i}`).toBeCloseTo(wheelWidth(state.car), 6);
  }
  expect(state.car.st).not.toBe(0); // the run really steered
  // A steering state on its way back to centre draws a shorter bar, down to nothing at centre.
  const car = state.car;
  const lock = dLim(params.car, car.v);
  expect(barWidth({ ...car, delta: 0.6 * lock })).toBeGreaterThan(barWidth({ ...car, delta: 0.3 * lock }));
  expect(barWidth({ ...car, delta: 0.3 * lock })).toBeGreaterThan(barWidth({ ...car, delta: 0.05 * lock }));
  expect(barWidth({ ...car, delta: 0 })).toBe(0);
  expect(barWidth({ ...car, delta: 2 * lock })).toBeCloseTo(STEER_BAR.w / 2, 6); // countersteer past the lock: full, never more
});

it('the bar is at centre when the sim holds the wheels straight after a late countersteer release (blind round 3, m3)', () => {
  // The steering travel is still at 0.8 to the left while the catch hold keeps the road wheels at 0 degrees.
  const car: CarState = { ...createCar(params), v: 20, vx: 20, st: -0.8, delta: 0, hold: -2 };
  expect(barWidth(car)).toBe(0);
  // The steering travel shows as a faint mark at its position, so the key's effect is still readable.
  const mid = STEER_BAR.x + STEER_BAR.w / 2;
  expect(keyMark(car)).toBeCloseTo(mid - 0.8 * STEER_BAR.w / 2, 6);
  expect(keyMark({ ...car, st: 0 })).toBeNull();
});
