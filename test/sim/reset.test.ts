// S004-AC-08: the R key puts the car back at rest. On a track it goes to the centreline at the leave
// point (the last place where at least one wheel was on the road) facing the driving direction; on the
// test lot it goes to the lot spawn. The press is a one-tick input, so a replay with an R press is
// identical every time.
import { describe, expect, it, vi } from 'vitest';
import { createCarRegistry } from '../../src/core/car-registry.ts';
import { hashState } from '../../src/core/hash.ts';
import type { InputFrame } from '../../src/core/input-frame.ts';
import { deserialize, serialize } from '../../src/core/serialize.ts';
import { replay, step, TICK, type SimState } from '../../src/core/sim.ts';
import { INPUT_LOG_VERSION, parseInputLog, validateInputLog, type InputLog } from '../../src/data/input-log.ts';
import { centerlineAt, nearestOnCenterline } from '../../src/data/track.ts';
import { combine, KeyboardDevice, type KeyTarget } from '../../src/input/index.ts';
import { replayRun, startRun, type Run } from '../../src/run.ts';
import { carStep, createCar, loadCarParams, type CarState } from '../../src/sim/index.ts';
import { TRACKS } from '../../src/tracks/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import { autopilot } from './autopilot.ts';

const cars = createCarRegistry([loadCarParams(s15, 's15-drift.json')]);
const track = TRACKS.find((t) => t.id === 'interlagos')!;
const IDLE: InputFrame = { throttle: 0, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false };
const R: InputFrame = { ...IDLE, reset: true };

const ring = (): Run => startRun({ seed: 5, car: 's15-drift', track: 'interlagos' }, cars);

/** Laps the car on the road for a while, then turns hard right off the track and stays off for 60 ticks. */
function leaveTrack(run: Run) {
  const frames = autopilot(run, track, 240);
  let state = replay(frames, run.state, run.params, carStep).state;
  expect(state.car.off).toBe(false);
  let lastOn = state.car, offTicks = 0;
  for (let i = 0; i < 1200 && offTicks < 60; i++) {
    const f = { ...IDLE, throttle: 1, right: 1 };
    state = step(state, f, run.params, carStep);
    frames.push(f);
    if (state.car.off) offTicks++;
    else lastOn = state.car;
  }
  expect(offTicks, 'the car never left the track').toBe(60);
  return { frames, state, lastOn };
}

function expectAtRest(c: CarState): void {
  for (const k of ['vx', 'vy', 'r', 'v', 'beta', 't', 'b', 'st', 'delta', 'af', 'ar', 'axp', 'rateF', 'rateR'] as const) {
    expect(c[k], k).toBe(0);
  }
  expect(c.gear, 'first gear for a standing start').toBe(0);
  expect(c.mode).toBe('');
  expect(c.off).toBe(false);
  expect(c.cur).toBeNull();
}

describe('R reset on a track (S004-AC-08)', () => {
  it('remembers where the car left the track and puts it back there at rest, facing the driving direction', () => {
    const run = ring();
    const { state, lastOn } = leaveTrack(run);
    const leave = nearestOnCenterline(track, lastOn.x, lastOn.y).s;
    expect(state.car.leave).toBe(leave);

    const after = step(state, R, run.params, carStep);
    const at = centerlineAt(track, leave);
    expect([after.car.x, after.car.y]).toEqual([at.x, at.y]);
    expect(after.car.h).toBe(Math.atan2(at.dy, at.dx));
    expectAtRest(after.car);
    expect(after.car.leave).toBe(leave);
    expect(after.car.tt).toBe(state.car.tt + TICK);
    expect(after.car.auto).toBe(state.car.auto);
    expect(after.car.drifts).toBe(state.car.drifts);
    expect(after.car.lap!.events).toEqual([]);

    // It stays put when nothing is pressed afterwards.
    const later = replay(Array(60).fill(IDLE), after, run.params, carStep).state;
    expect(Math.hypot(later.car.x - at.x, later.car.y - at.y)).toBeLessThan(0.05);
    expect(later.car.off).toBe(false);
  });

  it('a reset makes the current lap invalid but keeps its number, last and best laps', () => {
    const run = ring();
    const { state } = leaveTrack(run);
    const timed: SimState<CarState> = { ...state, car: { ...state.car, lap: { ...state.car.lap!, lap: 3, next: 1, marks: [1], valid: true } } };
    const lap = step(timed, R, run.params, carStep).car.lap!;
    expect(lap).toMatchObject({ lap: 3, next: 1, marks: [1], valid: false, last: state.car.lap!.last, best: state.car.lap!.best });
  });

  it('pressed while on the track, the car goes to the nearest centreline point', () => {
    const run = ring();
    const state = replay(autopilot(run, track, 150), run.state, run.params, carStep).state;
    expect(state.car.off).toBe(false);
    const near = nearestOnCenterline(track, state.car.x, state.car.y);
    expect(state.car.leave).toBe(near.s);
    const after = step(state, R, run.params, carStep).car;
    const at = centerlineAt(track, near.s);
    expect([after.x, after.y, after.h]).toEqual([at.x, at.y, Math.atan2(at.dy, at.dx)]);
    expectAtRest(after);
  });

  it('a new run on a track starts with the leave point at the spawn', () => {
    const r = ring();
    expect(r.state.car.leave).toBe(nearestOnCenterline(track, track.spawn.x, track.spawn.y).s);
  });
});

// S005-AC-09: on Interlagos the centreline at about 2770 m runs 39 m from the one at about 3765 m (26 m
// wide each), so a car can leave the road at the first and cut across the grass to the second.
describe('R reset after a cross-country shortcut (S005-AC-09)', () => {
  const FROM = 2650, LATER = 3765;

  /** Steers toward (x, y) at about `speed` m/s, the same keys the autopilot uses. */
  function toward(c: CarState, x: number, y: number, speed = 14): InputFrame {
    let e = Math.atan2(y - c.y, x - c.x) - c.h;
    e = Math.atan2(Math.sin(e), Math.cos(e));
    const want = Math.max(-1, Math.min(1, e * 2.5));
    return { ...IDLE, throttle: c.v < speed - 0.5 ? 1 : 0, brake: c.v > speed + 1.5 ? 1 : 0, right: c.st < want ? 1 : 0, left: c.st > want ? 1 : 0 };
  }

  /** Drives on the road from FROM to past 2770 m, then straight across the grass onto the section near LATER m. */
  function shortcut() {
    const run = ring();
    // An R press with the leave point moved to FROM puts the car there at rest, a quick way to reach the far side of the lap.
    const start = step({ ...run.state, car: { ...run.state.car, leave: FROM } }, R, run.params, carStep);
    const frames: InputFrame[] = [];
    let state = start;
    const drive = (f: InputFrame) => {
      frames.push(f);
      state = step(state, f, run.params, carStep);
    };
    // Follow the road to 2770 m.
    for (let i = 0; i < 2000 && nearestOnCenterline(track, state.car.x, state.car.y).s < 2770; i++) {
      const a = centerlineAt(track, nearestOnCenterline(track, state.car.x, state.car.y).s + 12);
      drive(toward(state.car, a.x, a.y));
    }
    expect(state.car.off).toBe(false);
    // Head straight for the later section's centreline across the grass; remember the last on-road tick before leaving.
    const goal = centerlineAt(track, LATER);
    let lastOn: CarState | null = state.car, wentOff = false;
    for (let i = 0; i < 1200 && Math.hypot(goal.x - state.car.x, goal.y - state.car.y) > 3; i++) {
      drive(toward(state.car, goal.x, goal.y, 10));
      if (state.car.off) wentOff = true;
      else if (!wentOff) lastOn = state.car;
    }
    expect(wentOff, 'the car never left the road').toBe(true);
    expect(state.car.off, 'the car is back on the road at the later section').toBe(false);
    expect(nearestOnCenterline(track, state.car.x, state.car.y).s).toBeGreaterThan(LATER - 30);
    return { run, start, frames, state, leave: nearestOnCenterline(track, lastOn!.x, lastOn!.y).s };
  }

  function expectBackAtLeave(after: CarState, leave: number) {
    const at = centerlineAt(track, leave);
    expect(leave).toBeLessThan(2900); // where it left, not the later section
    expect([after.x, after.y, after.h]).toEqual([at.x, at.y, Math.atan2(at.dy, at.dx)]);
    expect(after.leave).toBe(leave);
    expectAtRest(after);
  }

  it('pressed on the later section it rejoined, R puts the car back where it left the road', () => {
    const { run, state, leave } = shortcut();
    expectBackAtLeave(step(state, R, run.params, carStep).car, leave);
  });

  it('pressed after driving on along the later section, R still goes back where it left the road', () => {
    const { run, start, frames, leave } = shortcut();
    let state = replay(frames, start, run.params, carStep).state;
    for (let i = 0; i < 90; i++) {
      const a = centerlineAt(track, nearestOnCenterline(track, state.car.x, state.car.y).s + 12);
      state = step(state, toward(state.car, a.x, a.y), run.params, carStep);
    }
    expect(state.car.off).toBe(false);
    expectBackAtLeave(step(state, R, run.params, carStep).car, leave);
  });

  it('pressed out on the grass beyond the later section, R goes back where it left the road', () => {
    const { run, start, frames, leave } = shortcut();
    let state = replay(frames, start, run.params, carStep).state;
    const h = state.car.h, far = { x: state.car.x + Math.cos(h) * 200, y: state.car.y + Math.sin(h) * 200 };
    for (let i = 0; i < 600 && !state.car.off; i++) state = step(state, toward(state.car, far.x, far.y, 10), run.params, carStep);
    expect(state.car.off).toBe(true);
    expectBackAtLeave(step(state, R, run.params, carStep).car, leave);
  });

  it('the shortcut and the press replay identically every time, also from a saved state', () => {
    const { run, start, frames, leave } = shortcut();
    const a = replay([...frames, R], start, run.params, carStep).state;
    const b = replay(JSON.parse(JSON.stringify([...frames, R])) as InputFrame[], deserialize<CarState>(serialize(start)), run.params, carStep).state;
    expect(hashState(b)).toBe(hashState(a));
    expectBackAtLeave(a.car, leave);
  });
});

describe('R reset on the test lot (S004-AC-08)', () => {
  it('puts the car back at the lot spawn at rest, with no track data', () => {
    const run = startRun({ seed: 2, car: 's15-drift' }, cars);
    const frames = Array.from({ length: 150 }, (_, i) => ({ ...IDLE, throttle: 1, left: i < 10 ? 1 : 0 })); // one short tap: the steering now stays where it is put (S004-T2)
    const state = replay(frames, run.state, run.params, carStep).state;
    expect(Math.hypot(state.car.x - run.state.car.x, state.car.y - run.state.car.y)).toBeGreaterThan(5);
    const after = step(state, R, run.params, carStep).car;
    const spawn = createCar(run.params);
    expect([after.x, after.y, after.h]).toEqual([spawn.x, spawn.y, spawn.h]);
    expectAtRest(after);
    expect(after.rpm).toBe(spawn.rpm);
    expect(after.tt).toBe(state.car.tt + TICK);
    expect('leave' in after).toBe(false);
    expect('lap' in after).toBe(false);
  });

  it('frames without the reset field replay exactly as before (lot states gain no field)', () => {
    const run = startRun({ seed: 2, car: 's15-drift' }, cars);
    const frames = Array.from({ length: 60 }, () => ({ ...IDLE, throttle: 1 }));
    const a = replay(frames, run.state, run.params, carStep).state;
    const b = replay(frames.map((f) => ({ ...f, reset: false })), run.state, run.params, carStep).state;
    expect(hashState(b)).toBe(hashState(a));
  });
});

describe('a replay with an R press (S004-AC-08)', () => {
  const run = ring();
  const { frames } = leaveTrack(run);
  const pressAt = frames.length;
  frames.push(R, ...Array.from({ length: 120 }, () => ({ ...IDLE, throttle: 1 })), R, IDLE);
  const log: InputLog = { version: INPUT_LOG_VERSION, seed: 5, car: 's15-drift', track: 'interlagos', tickSeconds: 1 / 60, subSteps: 10, frames };

  it('is a valid input log and replays to the same state every time, also after a JSON round trip', () => {
    expect(validateInputLog(log).ok).toBe(true);
    const a = replayRun(log, cars).state;
    const b = replayRun(log, cars).state;
    const c = replayRun(parseInputLog(JSON.parse(JSON.stringify(log))), cars).state;
    expect(b).toEqual(a);
    expect(hashState(b)).toBe(hashState(a));
    expect(hashState(c)).toBe(hashState(a));
    expect(a.car.v).toBe(0); // the last press left it at rest
  });

  it('a state saved just before the press continues bit-identically', () => {
    const mid = replay(frames.slice(0, pressAt), run.state, run.params, carStep).state;
    const back = deserialize<CarState>(serialize(mid));
    const a = replay(frames.slice(pressAt), mid, run.params, carStep).state;
    const b = replay(frames.slice(pressAt), back, run.params, carStep).state;
    expect(hashState(b)).toBe(hashState(a));
  });

  it('the log checks the reset field', () => {
    const bad = { ...log, frames: [{ ...IDLE, reset: 1 }] };
    expect(validateInputLog(bad).ok).toBe(false);
  });
});

describe('R key on the keyboard (S004-AC-08)', () => {
  function fakeTarget() {
    const fns = new Map<string, (e: unknown) => void>();
    const target: KeyTarget = { addEventListener: (t, fn) => fns.set(t, fn as (e: unknown) => void), removeEventListener: (t) => fns.delete(t) };
    const fire = (type: string, code: string, repeat = false) => {
      const e = { code, repeat, preventDefault: vi.fn() };
      fns.get(type)?.(e);
      return e;
    };
    return { target, fire };
  }

  it('is a one-tick press; key repeat adds nothing', () => {
    const { target, fire } = fakeTarget();
    const kb = new KeyboardDevice(target);
    expect(fire('keydown', 'KeyR').preventDefault).toHaveBeenCalled();
    fire('keydown', 'KeyR', true);
    expect(kb.sample()).toEqual(R);
    expect(kb.sample()).toEqual(IDLE);
    fire('keyup', 'KeyR');
    expect(kb.sample()).toEqual(IDLE);
  });

  it('combining devices ORs the press', () => {
    const dev = (f: Partial<InputFrame>) => ({ sample: () => f, dispose: () => {} });
    expect(combine([dev({}), dev({ reset: true })]).reset).toBe(true);
    expect(combine([dev({})]).reset).toBeUndefined();
  });
});
