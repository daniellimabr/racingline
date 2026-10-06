// S005-AC-10 (steering half): the steering bar and the wheels in the axle diagram show the sim's steering state,
// so they follow the wheel back to centre after the key is let go (S005-T2 return to centre). Render gets no keys.
// S005-T13 (blind round 3, m3): the bar shows the angle the road wheels really have (the sim's delta, as a share of
// the speed's lock), so it is back at centre when the sim holds the wheels straight; the steering travel is a faint mark.
import { describe, expect, it } from 'vitest';
import type { InputFrame } from '../../src/core/input-frame.ts';
import { createState, step, type SimState } from '../../src/core/sim.ts';
import { carStep, createCar, createSimParams, loadCarParams, type CarState } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import { dLim } from '../../src/sim/physics.ts';
import { buildLot } from '../../src/render/lot.ts';
import { drawScene, STEER_BAR, STEER_LOCK_SHARE, steerBarGeo } from '../../src/render/scene.ts';
import { createView } from '../../src/render/view.ts';
import { factoryFor, recordingContext } from './canvas-stub.ts';

const params = createSimParams(loadCarParams(s15, 's15-drift.json'));
const idle: InputFrame = { throttle: 0, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false };

function draw(car: CarState) {
  const rec = recordingContext();
  drawScene(rec.ctx, { car, params, view: createView(1), lot: buildLot(factoryFor(rec.ctx), params.lot), paused: false, dt: 1 / 60, track: null, lap: null });
  return rec;
}
const MID = STEER_BAR.x + STEER_BAR.w / 2, INNER = STEER_LOCK_SHARE * STEER_BAR.w / 2, OUTER = STEER_BAR.w / 2 - INNER;
/** The rects drawn on the bar's own row, in order: the three background zones, the fill, then the overflow if any. */
const barRects = (car: CarState) => draw(car).calls
  .filter(([k, a]) => k === 'fillRect' && a[1] === STEER_BAR.y && a[3] === STEER_BAR.h).map(([, a]) => a as number[]);
/** Width of the yellow steering fill, screen px, as drawn for this car. */
const barWidth = (car: CarState): number => Math.abs(barRects(car)[3]![2]!);
/** The fill the road-wheel angle should give: delta as a share of the speed's lock, up to the 100% mark. */
const wheelWidth = (car: CarState): number => Math.min(1, Math.abs(car.delta) / dLim(params.car, car.v)) * INNER;
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
  expect(barWidth({ ...car, delta: 2 * lock })).toBeCloseTo(INNER, 6); // countersteer past the lock: the fill stops at the 100% mark
});

it('the bar is at centre when the sim holds the wheels straight after a late countersteer release (blind round 3, m3)', () => {
  // The steering travel is still at 0.8 to the left while the catch hold keeps the road wheels at 0 degrees.
  const car: CarState = { ...createCar(params), v: 20, vx: 20, st: -0.8, delta: 0, hold: -2 };
  expect(barWidth(car)).toBe(0);
  // The steering travel shows as a faint mark at its position, so the key's effect is still readable.
  const mid = STEER_BAR.x + STEER_BAR.w / 2;
  expect(keyMark(car)).toBeCloseTo(mid - 0.8 * INNER, 6); // full key travel is the 100% mark (S005-T15)
  expect(keyMark({ ...car, st: 0 })).toBeNull();
});

// S005-T15 (blind round 4, M4): countersteer goes past the speed's lock, so the bar keeps the speed's lock as its 100%
// mark and shows the angle beyond it, up to the car's full lock, as a separate overflow part outside that mark.
describe('the steering bar overflow (S005-T15)', () => {
  const s15p = params.car, lock = dLim(s15p, 75 / 3.6), max = s15p.maxSteer;

  it('keeps three quarters of each half for the speed lock and a quarter for the overflow, wide enough on a phone', () => {
    expect(STEER_LOCK_SHARE).toBe(0.75);
    // A phone shows the 640 px canvas about 330 px wide: the overflow part stays at least 12 px there.
    expect(OUTER * 330 / 640).toBeGreaterThanOrEqual(12);
  });

  it('fills up to the 100% mark by share of the speed lock, with no overflow inside it', () => {
    for (const k of [0, 0.34, 0.5, 1]) {
      const g = steerBarGeo(k * lock, lock, max, 0);
      expect(g.fill.w).toBeCloseTo(k * INNER, 9);
      expect(g.fill.x).toBeCloseTo(MID, 9);
      expect(g.over).toBeNull();
    }
  });

  it('shows angle past the speed lock as overflow outside the 100% mark, up to full lock, both ways', () => {
    for (const sign of [1, -1]) {
      for (const [deg, share] of [[30, ((30 * Math.PI) / 180 - lock) / (max - lock)], [60, 1], [90, 1]] as const) {
        const a = (deg * Math.PI) / 180, g = steerBarGeo(sign * a, lock, max, 0);
        expect(g.fill.w).toBeCloseTo(INNER, 9);
        expect(g.fill.x).toBeCloseTo(sign > 0 ? MID : MID - INNER, 9);
        expect(g.over!.w).toBeCloseTo(Math.min(1, share) * OUTER, 6);
        expect(g.over!.x).toBeCloseTo(sign > 0 ? MID + INNER : MID - INNER - g.over!.w, 6);
        expect(g.over!.x).toBeGreaterThanOrEqual(STEER_BAR.x - 1e-9);
        expect(g.over!.x + g.over!.w).toBeLessThanOrEqual(STEER_BAR.x + STEER_BAR.w + 1e-9);
      }
    }
    // Blind round 4: 60 degrees at 75 km/h, where the speed lock is 16.6 degrees, now reads as full overflow, not 100%.
    expect(lock * 57.3).toBeCloseTo(16.6, 0);
  });

  it('marks 100% on both sides and puts full key travel on that mark', () => {
    const g = steerBarGeo(0, lock, max, -1);
    expect(g.marks).toEqual([MID - INNER, MID + INNER]);
    expect(g.key).toBeCloseTo(MID - INNER, 9);
    expect(steerBarGeo(0, lock, max, 0).key).toBeNull();
  });

  it('shows full overflow for any angle past the lock when the speed lock is already the full lock', () => {
    expect(steerBarGeo(max * 1.01, max, max, 0).over!.w).toBeCloseTo(OUTER, 9);
    expect(steerBarGeo(max, max, max, 0).over).toBeNull();
  });

  it('draws the overflow on the bar from the real wheel angle, and the 100% marks above and below it', () => {
    const car: CarState = { ...createCar(params), v: 75 / 3.6, vx: 75 / 3.6, delta: -40 / 57.3 };
    const g = steerBarGeo(car.delta, dLim(s15p, car.v), max, car.st), r = barRects(car);
    expect(r).toHaveLength(5);
    expect(r[3]).toEqual([g.fill.x, STEER_BAR.y, g.fill.w, STEER_BAR.h]);
    expect(r[4]).toEqual([g.over!.x, STEER_BAR.y, g.over!.w, STEER_BAR.h]);
    const marks = draw(car).calls.filter(([k, a]) => k === 'fillRect' && a[1] === STEER_BAR.y - 3 && a[3] === STEER_BAR.h + 6);
    for (const x of g.marks) expect(marks.some(([, a]) => a[0] === x - 1 && a[2] === 2)).toBe(true);
    // The text still names the real angle.
    expect(draw(car).texts().some(([t]) => t === 'Direção −40°')).toBe(true);
  });
});
