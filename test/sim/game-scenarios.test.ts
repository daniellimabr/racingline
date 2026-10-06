// S005-AC-11: the steady-corner replay is re-recorded with the game's own held steering that returns to centre
// when let go; the committed log must equal a fresh recording, and the corner must really be steady.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createCarRegistry } from '../../src/core/car-registry.ts';
import { parseInputLog } from '../../src/data/input-log.ts';
import { replayRun } from '../../src/run.ts';
import { loadCarParams } from '../../src/sim/index.ts';
import { step } from '../../src/core/sim.ts';
import { startRun } from '../../src/run.ts';
import { carStep } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import { GAME_SCENARIOS, logJson, recordScenario, SCENARIO_DIR } from './game-scenarios.ts';

const file = (name: string): URL => new URL(`${name}.log.json`, SCENARIO_DIR);
if (process.env.RECORD_SCENARIOS) {
  mkdirSync(SCENARIO_DIR, { recursive: true });
  for (const sc of GAME_SCENARIOS) writeFileSync(file(sc.name), logJson(recordScenario(sc)));
}
const cars = createCarRegistry([loadCarParams(s15, 's15-drift.json')]);

describe('game-recorded scenario logs (S005-AC-11)', () => {
  it.each(GAME_SCENARIOS.map((s) => [s.name, s] as const))('%s: the committed log equals a fresh recording and is a valid log', (_n, sc) => {
    const text = readFileSync(file(sc.name), 'utf8');
    expect(text).toBe(logJson(recordScenario(sc)));
    const log = parseInputLog(JSON.parse(text), sc.name);
    expect(replayRun(log, cars).state.tick).toBe(log.frames.length);
  });

  it('steady-corner holds a steady corner: speed and yaw rate settle, the wheel near a third of its travel', () => {
    const log = parseInputLog(JSON.parse(readFileSync(file('steady-corner'), 'utf8')), 'steady-corner');
    let { state, params } = startRun(log, cars);
    const late: { v: number; r: number; st: number }[] = [];
    log.frames.forEach((f, i) => {
      state = step(state, f, params, carStep);
      if (i >= 8.5 * 60) late.push({ v: state.car.v, r: state.car.r, st: state.car.st });
    });
    const span = (k: 'v' | 'r' | 'st'): number => Math.max(...late.map((x) => x[k])) - Math.min(...late.map((x) => x[k]));
    expect(span('v'), 'speed ripple, m/s').toBeLessThan(0.3);
    expect(span('r'), 'yaw-rate ripple, rad/s').toBeLessThan(0.08);
    for (const x of late) expect(Math.abs(x.st - 0.3)).toBeLessThan(0.06);
    expect(Math.abs(late[late.length - 1]!.v - 12)).toBeLessThan(0.5);
    // Taps, not one held key: the wheel eases back between them (it did not under S004's held steering).
    expect(log.frames.slice(3 * 60).filter((f) => f.right > 0).length).toBeLessThan(0.9 * 9 * 60);
    expect(late.some((x) => x.st < 0.3)).toBe(true);
  });
});
