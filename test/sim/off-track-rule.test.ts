// S003-AC-09 (Daniel 2026-10-05): a lap is invalid if at any tick all four wheels are off the track
// surface; an invalid lap never sets the best lap; one wheel on the track keeps the lap valid.
// Kerbs count as off the track. Wheel positions come from the car's wheelbase, axle split and track width.
import { describe, expect, it } from 'vitest';
import { createCarRegistry } from '../../src/core/car-registry.ts';
import { step } from '../../src/core/sim.ts';
import { startRun } from '../../src/run.ts';
import {
  allWheelsOff, carStep, createCar, createLapState, createSimParams, lapStep, loadCarParams, wheelPositions,
  type CarState, type LapEvent, type LapState,
} from '../../src/sim/index.ts';
import { surfaceAt } from '../../src/tracks/surface-at.ts';
import s15 from '../../src/cars/s15-drift.json';
import gt3 from '../../src/cars/gt3.json';
import { BOX, boxDrive } from './box-track.ts';

const car = loadCarParams(s15, 's15-drift.json');
const start: CarState = { ...createCar(createSimParams(car)), x: -20, y: 0, h: 0, tt: 0 };

function drive(poses: CarState[], lap: LapState = createLapState(BOX), prev: CarState = start) {
  const events: LapEvent[] = [];
  for (const pose of poses) {
    lap = lapStep(lap, prev, pose, BOX, car);
    events.push(...lap.events);
    prev = pose;
  }
  return { lap, events, last: prev };
}

/** One lap of the box at 30 m/s, with the sideways offset `right(s)`. */
const oneLap = (right: (s: number) => number) => drive(boxDrive(start, -20, 601, 30, right));

describe('wheel positions from car data', () => {
  it('puts the axles at the CG split of the wheelbase and the wheels half the track width out', () => {
    const [fl, fr, rl, rr] = wheelPositions({ x: 10, y: 20, h: 0 }, car);
    expect(car.trackWidth).toBeGreaterThan(1);
    expect(fl[0]).toBeCloseTo(10 + car.la, 9);
    expect(rl[0]).toBeCloseTo(10 - car.lb, 9);
    expect(fl[1]).toBeCloseTo(20 - car.trackWidth / 2, 9); // the driver's left is north when heading east
    expect(fr[1]).toBeCloseTo(20 + car.trackWidth / 2, 9);
    expect(rr).toEqual([rl[0], fr[1]]);
  });

  it('rotates with the heading', () => {
    const [fl] = wheelPositions({ x: 0, y: 0, h: Math.PI / 2 }, car); // heading south: left is east
    expect(fl[0]).toBeCloseTo(car.trackWidth / 2, 9);
    expect(fl[1]).toBeCloseTo(car.la, 9);
  });

  it('every car file states its track width', () => {
    expect(loadCarParams(gt3, 'gt3.json').trackWidth).toBeGreaterThan(car.trackWidth);
  });
});

describe('off-track rule (S003-AC-09)', () => {
  const edge = 6; // half the box width

  it('a lap driven on the road is valid and sets the best lap', () => {
    const { lap } = oneLap(() => 0);
    expect(lap.last!.valid).toBe(true);
    expect(lap.best).toEqual(lap.last);
  });

  it('one tick with all four wheels off makes the lap invalid, and it never sets the best lap', () => {
    // At 0.5 m per tick, a window from 300.2 m to 300.7 m holds exactly one tick on the grass.
    const { lap, events } = oneLap((s) => (s > 300.2 && s <= 300.7 ? 12 : 0));
    expect(lap.last!.valid).toBe(false);
    expect(lap.best).toBeNull();
    expect(events.find((e) => e.type === 'lap')).toMatchObject({ valid: false, best: false });
    expect(events.filter((e) => e.type === 'sector').map((e) => e.valid)).toEqual([true, false, false]);
  });

  it('kerbs count as off the track: wheels on the kerb and the grass invalidate the lap', () => {
    const right = edge + car.trackWidth / 2 + 0.2; // inner wheels on the kerb, outer wheels on the grass
    const [, fr, rl] = wheelPositions({ x: 50, y: right, h: 0 }, car);
    expect(surfaceAt(BOX, rl[0], rl[1])).toBe('kerb');
    expect(surfaceAt(BOX, fr[0], fr[1])).toBe('grass');
    const { lap } = oneLap((s) => (s > 40 && s < 60 ? right : 0));
    expect(lap.last!.valid).toBe(false);
  });

  it('one wheel on the track keeps the lap valid', () => {
    // A tilted car near the edge: exactly one wheel is on the road.
    const h = 0.3, pose = (y: number) => wheelPositions({ x: 50, y, h }, car);
    const inner = Math.min(...pose(0).map((w) => w[1]));
    const y = edge - inner - 0.05;
    const onRoad = pose(y).filter((w) => surfaceAt(BOX, w[0], w[1]) === 'asphalt');
    expect(onRoad).toHaveLength(1);
    expect(allWheelsOff(BOX, { x: 50, y, h }, car)).toBe(false);
    expect(allWheelsOff(BOX, { x: 50, y: y + 0.1, h }, car)).toBe(true);
    const poses = boxDrive(start, -20, 601, 30).map((p) => (p.x > 40 && p.x < 60 && p.y === 0 ? { ...p, y, h } : p));
    const { lap } = drive(poses);
    expect(lap.last!.valid).toBe(true);
    expect(lap.best).toEqual(lap.last);
  });

  it('leaving the track before the first crossing does not touch lap 1', () => {
    const { lap } = drive(boxDrive(start, -20, 601, 30, (s) => (s < -10 ? 12 : 0)));
    expect(lap.last).toMatchObject({ lap: 1, valid: true });
  });

  it('the lap after an invalid lap starts valid and can set the best lap', () => {
    const a = oneLap((s) => (s > 300.2 && s <= 300.7 ? 12 : 0));
    const b = drive(boxDrive(a.last, 601, 1201, 30), a.lap, a.last);
    expect(b.lap.last).toMatchObject({ lap: 2, valid: true });
    expect(b.lap.best!.lap).toBe(2);
  });

  it('the car step on a track uses the same rule for its off flag', () => {
    const cars = createCarRegistry([car]);
    const run = startRun({ seed: 1, car: 's15-drift', track: 'interlagos' }, cars);
    const idle = { throttle: 0, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false };
    const s = step(run.state, idle, run.params, carStep);
    expect(s.car.off).toBe(false);
    const far = step({ ...run.state, car: { ...run.state.car, x: run.state.car.x + 50 } }, idle, run.params, carStep);
    expect(far.car.off).toBe(true);
    expect(far.car.lap).toMatchObject({ lap: 0, valid: true }); // still the out lap
  });
});
