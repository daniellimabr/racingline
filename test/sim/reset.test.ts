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
