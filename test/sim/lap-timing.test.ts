// S003-AC-08: a car driven across the start/finish line and the three sector lines gets a lap time,
// three sector times that add up to it, and a best lap, identical on every replay.
import { describe, expect, it } from 'vitest';
import { hashState } from '../../src/core/hash.ts';
import { createCarRegistry } from '../../src/core/car-registry.ts';
import { INPUT_LOG_VERSION, type InputLog } from '../../src/data/input-log.ts';
import { replayRun, startRun } from '../../src/run.ts';
import { createCar, createSimParams, createLapState, lapStep, lapProgress, loadCarParams, type CarState, type LapEvent, type LapState } from '../../src/sim/index.ts';
import { TRACKS } from '../../src/tracks/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import { BOX, boxDrive } from './box-track.ts';
import { autopilot } from './autopilot.ts';

const car = loadCarParams(s15, 's15-drift.json');
const start: CarState = { ...createCar(createSimParams(car)), x: -20, y: 0, h: 0, tt: 0 };

/** Folds lapStep over consecutive car poses; returns the final lap state and every event in order. */
function drive(poses: CarState[], lap: LapState = createLapState(BOX), prev: CarState = start) {
  const events: LapEvent[] = [];
  for (const pose of poses) {
    lap = lapStep(lap, prev, pose, BOX, car);
    events.push(...lap.events);
    prev = pose;
  }
  return { lap, events, last: prev };
}

describe('lap timing on a test box (S003-AC-08)', () => {
  it('does not time anything before the first start-line crossing', () => {
    const { lap, events } = drive(boxDrive(start, -20, -1, 30));
    expect(lap.lap).toBe(0);
    expect(events).toEqual([]);
  });

  it('starts lap 1 on the first crossing after spawn, without a lap time', () => {
    const { lap, events } = drive(boxDrive(start, -20, 10, 30));
    expect(lap.lap).toBe(1);
    expect(lap.next).toBe(1);
    expect(events).toEqual([]);
    // Moving 0.5 m per tick, the crossing at s = 0 is at 20 m from spawn: 0.666... s, interpolated inside the tick.
    expect(lap.marks[0]).toBeCloseTo(20 / 30, 9);
  });

  it('times the three sectors in driving order and the lap as their sum', () => {
    const { lap, events } = drive(boxDrive(start, -20, 610, 30));
    expect(events.map((e) => (e.type === 'sector' ? `s${e.sector}` : 'lap'))).toEqual(['s1', 's2', 's3', 'lap']);
    const last = lap.last!;
    expect(last.lap).toBe(1);
    expect(last.sectors[0]).toBeCloseTo(150 / 30, 9);
    expect(last.sectors[1]).toBeCloseTo(200 / 30, 9);
    expect(last.sectors[2]).toBeCloseTo(250 / 30, 9);
    expect(last.sectors[0] + last.sectors[1] + last.sectors[2]).toBe(last.time);
    expect(last.time).toBeCloseTo(20, 9);
    expect(last.valid).toBe(true);
    expect(lap.best).toEqual(last);
    expect(lap.lap).toBe(2);
    const lapEvent = events.at(-1)!;
    expect(lapEvent).toMatchObject({ type: 'lap', lap: 1, time: last.time, sectors: last.sectors, valid: true, best: true });
  });

  it('keeps the fastest valid lap as best', () => {
    // Steps of 0.5, 1 and 0.25 m per tick are exact in binary, so each run ends exactly on the line.
    const a = drive(boxDrive(start, -20, 600, 30)); // lap 1: 20 s
    const b = drive(boxDrive(a.last, 600, 1200, 60), a.lap, a.last); // lap 2: 10 s
    const c = drive(boxDrive(b.last, 1200, 1800.2, 15), b.lap, b.last); // lap 3: 40 s
    expect(c.lap.last!.lap).toBe(3);
    expect(c.lap.best!.lap).toBe(2);
    expect(c.lap.best!.time).toBeCloseTo(10, 9);
    expect(c.events.find((e) => e.type === 'lap')).toMatchObject({ lap: 3, best: false });
  });

  it('ignores a line crossed backwards and a line crossed out of order', () => {
    const fwd = drive(boxDrive(start, -20, 5, 30)); // lap 1 started
    const reversed = drive(boxDrive(fwd.last, 5, -5, 30), fwd.lap, fwd.last); // back over the start line
    expect(reversed.lap.lap).toBe(1);
    expect(reversed.events).toEqual([]);
    expect(reversed.lap.marks).toEqual(fwd.lap.marks);
    const again = drive(boxDrive(reversed.last, -5, 5, 30), reversed.lap, reversed.last);
    expect(again.lap.lap).toBe(1); // the start line is not the next line, so lap 1 keeps its start
    expect(again.lap.marks).toEqual(fwd.lap.marks);
    expect(again.events).toEqual([]);
  });

  it('counts a crossing a little beyond the line ends but not far away', () => {
    const wide = drive(boxDrive(start, -20, 5, 30, () => 12)); // 6 m past the road edge
    expect(wide.lap.lap).toBe(1);
    const far = drive(boxDrive(start, -20, 5, 30, () => 30)); // 24 m past the edge
    expect(far.lap.lap).toBe(0);
  });

  it('gives the screen the running lap, sector and splits', () => {
    expect(lapProgress(start)).toBeNull();
    const out = drive(boxDrive(start, -20, -5, 30));
    expect(lapProgress({ ...out.last, lap: out.lap })).toMatchObject({ lap: 0, sector: 1, time: 0, splits: [], valid: true });
    const mid = drive(boxDrive(start, -20, 200, 30));
    const p = lapProgress({ ...mid.last, lap: mid.lap })!;
    expect(p).toMatchObject({ lap: 1, sector: 2, valid: true, last: null, best: null });
    expect(p.time).toBeCloseTo(200 / 30, 6);
    expect(p.splits).toHaveLength(1);
    expect(p.splits[0]).toBeCloseTo(5, 9);
    const end = drive(boxDrive(start, -20, 590, 30));
    expect(lapProgress({ ...end.last, lap: end.lap })!.sector).toBe(3);
  });
});

describe('lap timing on Interlagos with the real car (S003-AC-08)', () => {
  const track = TRACKS.find((t) => t.id === 'interlagos')!;
  const cars = createCarRegistry([car]);
  const run = startRun({ seed: 11, car: 's15-drift', track: 'interlagos' }, cars);
  const frames = autopilot(run, track, 60 * 520, 20);
  const log: InputLog = { version: INPUT_LOG_VERSION, seed: 11, car: 's15-drift', track: 'interlagos', tickSeconds: 1 / 60, subSteps: 10, frames };

  it('times two full laps, sectors add up, and every replay is identical', () => {
    const a = replayRun(log, cars), b = replayRun(log, cars);
    expect(hashState(b.state)).toBe(hashState(a.state));
    const lap = a.state.car.lap!;
    expect(lap.track).toBe('interlagos');
    expect(lap.lap).toBeGreaterThanOrEqual(3);
    for (const t of [lap.last!, lap.best!]) {
      expect(t.sectors[0] + t.sectors[1] + t.sectors[2]).toBe(t.time);
      for (const s of t.sectors) expect(s).toBeGreaterThan(40);
    }
    // About 4.3 km at roughly 20 m/s, slower in the tight corners.
    expect(lap.best!.time).toBeGreaterThan(200);
    expect(lap.best!.time).toBeLessThan(300);
    expect(lap.best!.valid).toBe(true);
    expect(b.state.car.lap).toEqual(lap);
  }, 60_000);
});
