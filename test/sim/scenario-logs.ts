// The six scenario input logs, recorded from prototype v24 (test/fixtures/v24/, inputs only). The
// recordings embed a version 1 log with v24's skill setting; the game's run uses only their seed,
// car and frames, as a current-version input log (S002-T10).
// S005-T2: a scenario re-recorded from the game itself (test/fixtures/scenarios/<name>.log.json, version 2,
// game-scenarios.ts) replaces the v24 frames of the same name; the v24 file stays as history for its own test.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { INPUT_LOG_VERSION, parseInputLog, type InputLog } from '../../src/data/input-log.ts';
import { parseReferenceTrace } from '../../src/data/trace.ts';

const LOGS = new URL('../fixtures/v24/', import.meta.url);
const GAME_LOGS = new URL('../fixtures/scenarios/', import.meta.url);

/** Scenario fixture file names, sorted. */
export const scenarioFiles = (): string[] => readdirSync(LOGS).filter((f) => f.endsWith('.trace.json')).sort();

export function scenarioLog(file: string): InputLog {
  const game = new URL(file.replace('.trace.json', '.log.json'), GAME_LOGS);
  if (existsSync(game)) return parseInputLog(JSON.parse(readFileSync(game, 'utf8')), file);
  const { seed, car, tickSeconds, subSteps, frames } = parseReferenceTrace(
    JSON.parse(readFileSync(new URL(file, LOGS), 'utf8')), file).inputLog;
  return { version: INPUT_LOG_VERSION, seed, car, tickSeconds, subSteps, frames };
}
