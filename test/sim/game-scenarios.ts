// Scenario input logs recorded from the game itself (S005-T2), for scenarios whose v24 recording no longer means
// what its name says. A scripted on/off "driver" reads the game state each tick; only its frames are stored
// (test/fixtures/scenarios/<name>.log.json, input log version 2), so a replay never needs the driver.
// The golden replay prefers these over the v24 recording of the same name (scenario-logs.ts). Regenerate with
//   RECORD_SCENARIOS=1 npx vitest run test/sim/game-scenarios.test.ts
import type { InputFrame } from '../../src/core/input-frame.ts';
import { step } from '../../src/core/sim.ts';
import { createCarRegistry } from '../../src/core/car-registry.ts';
import { INPUT_LOG_VERSION, SUB_STEPS, TICK_SECONDS, type InputLog } from '../../src/data/input-log.ts';
import { startRun } from '../../src/run.ts';
import { carStep, loadCarParams, type CarState } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';

export const SCENARIO_DIR = new URL('../fixtures/scenarios/', import.meta.url);
const NEUTRAL: InputFrame = { throttle: 0, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false };
const tk = (s: number): number => Math.round(s * 60);
const on = (x: boolean): number => (x ? 1 : 0);
/** Steering towards a target with on/off keys (the v24 dead band avoids chatter); the wheel eases back between taps. */
const steerTo = (c: CarState, target: number) => ({ right: on(c.st < target - 0.04), left: on(c.st > target + 0.04) });

export interface GameScenario {
  name: string;
  seed: number;
  seconds: number;
  about: string;
  input: (tick: number, car: CarState) => Partial<InputFrame>;
}

export const GAME_SCENARIOS: readonly GameScenario[] = [
  { name: 'steady-corner', seed: 2403, seconds: 12,
    about: 'Throttle for 3 s, then hold about 12 m/s and a third of the steering travel to the right with key taps (held steering that returns to centre when let go, S005-T2).',
    input: (i, c) => (i < tk(3) ? { throttle: 1 } : { throttle: on(c.v < 12), ...steerTo(c, 0.3) }) },
];

/** Runs one scenario on the test lot with the S15 and returns its input log. */
export function recordScenario(sc: GameScenario): InputLog {
  const cars = createCarRegistry([loadCarParams(s15, 's15-drift.json')]);
  const header = { seed: sc.seed, car: 's15-drift' };
  let { state, params } = startRun(header, cars);
  const frames: InputFrame[] = [];
  for (let i = 0; i < tk(sc.seconds); i++) {
    const f = { ...NEUTRAL, ...sc.input(i, state.car) };
    frames.push(f);
    state = step(state, f, params, carStep);
  }
  return { version: INPUT_LOG_VERSION, ...header, tickSeconds: TICK_SECONDS, subSteps: SUB_STEPS, frames };
}

/** Diff-friendly JSON: header keys one per line, one frame per line. */
export function logJson(log: InputLog): string {
  const { frames, ...head } = log;
  const lines = Object.entries(head).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`);
  return `{\n${lines.join(',\n')},\n"frames":[\n${frames.map((f) => JSON.stringify(f)).join(',\n')}\n]\n}\n`;
}
