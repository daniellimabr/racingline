// S003-AC-10: lap and sector crossings go into the telemetry stream (ADR-002 summary stream, objects
// with `t`, keyed by the integer sim tick `k`).
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/core/hash.ts';
import { createCarRegistry } from '../../src/core/car-registry.ts';
import { createState, step, type SimState } from '../../src/core/sim.ts';
import { startRun } from '../../src/run.ts';
import { carStep, createCar, createLapState, createSimParams, lapStep, loadCarParams, type CarState } from '../../src/sim/index.ts';
import { lapEventLines, type LapLine } from '../../src/telemetry/lap-events.ts';
import s15 from '../../src/cars/s15-drift.json';
import { BOX, boxDrive } from '../sim/box-track.ts';

const car = loadCarParams(s15, 's15-drift.json');
const start: CarState = { ...createCar(createSimParams(car)), x: -20, y: 0, h: 0, tt: 0, lap: createLapState(BOX) };

/** Two laps of the box as sim states, one per tick, with the lap step applied; returns every line written. */
function linesOfTwoLaps(): { lines: LapLine[]; final: SimState<CarState> } {
  let state = createState(5, start);
  const lines: LapLine[] = [];
  for (const pose of boxDrive(start, -20, 1201, 30, (s) => (s > 900.2 && s <= 900.7 ? 12 : 0))) {
    const lap = lapStep(state.car.lap!, state.car, pose, BOX, car);
    state = { ...state, tick: state.tick + 1, car: { ...pose, lap } };
    lines.push(...lapEventLines(state));
  }
  return { lines, final: state };
}

describe('lap events in the telemetry stream (S003-AC-10)', () => {
  const { lines, final } = linesOfTwoLaps();

  it('writes one sector line per sector and one lap line per lap, in order', () => {
    expect(lines.map((l) => (l.t === 'sector' ? `${l.lap}.${l.sector}` : `lap${l.lap}`))).toEqual([
      '1.1', '1.2', '1.3', 'lap1', '2.1', '2.2', '2.3', 'lap2',
    ]);
  });

  it('lines carry the integer tick, the same times as the sim state, and valid JSON', () => {
    for (const l of lines) {
      expect(Number.isInteger(l.k)).toBe(true);
      expect(() => canonicalJson(l)).not.toThrow();
    }
    const lap2 = lines.at(-1)!;
    expect(lap2).toEqual({
      t: 'lap', k: lap2.k, lap: 2, time: final.car.lap!.last!.time, sectors: final.car.lap!.last!.sectors, valid: false, best: false,
    });
    const lap1 = lines[3]!;
    expect(lap1).toMatchObject({ t: 'lap', lap: 1, valid: true, best: true, time: final.car.lap!.best!.time });
    const s1 = lines.filter((l) => l.t === 'sector' && l.lap === 1);
    expect(s1.map((l) => l.time)).toEqual(final.car.lap!.best!.sectors);
    expect(lines.filter((l) => l.t === 'sector' && l.lap === 2).map((l) => l.valid)).toEqual([true, false, false]);
    // Ticks rise and the lap line shares the tick of its third sector.
    expect(lines.map((l) => l.k)).toEqual([...lines.map((l) => l.k)].sort((a, b) => a - b));
    expect(lap1.k).toBe(lines[2]!.k);
  });

  it('writes nothing on a tick without a crossing, nor on the test lot', () => {
    const cars = createCarRegistry([car]);
    const lot = startRun({ seed: 1, car: 's15-drift' }, cars);
    const idle = { throttle: 1, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false };
    expect(lapEventLines(step(lot.state, idle, lot.params, carStep))).toEqual([]);
    const ring = startRun({ seed: 1, car: 's15-drift', track: 'interlagos' }, cars);
    expect(lapEventLines(step(ring.state, idle, ring.params, carStep))).toEqual([]);
  });
});
