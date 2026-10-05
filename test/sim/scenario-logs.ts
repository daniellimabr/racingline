// The six scenario input logs, recorded from prototype v24 (test/fixtures/v24/, inputs only). The
// recordings embed a version 1 log with v24's skill setting; the game's run uses only their seed,
// car and frames, as a current-version input log (S002-T10).
import { readdirSync, readFileSync } from 'node:fs';
import { INPUT_LOG_VERSION, type InputLog } from '../../src/data/input-log.ts';
import { parseReferenceTrace } from '../../src/data/trace.ts';

const LOGS = new URL('../fixtures/v24/', import.meta.url);

/** Scenario fixture file names, sorted. */
export const scenarioFiles = (): string[] => readdirSync(LOGS).filter((f) => f.endsWith('.trace.json')).sort();

export function scenarioLog(file: string): InputLog {
  const { seed, car, tickSeconds, subSteps, frames } = parseReferenceTrace(
    JSON.parse(readFileSync(new URL(file, LOGS), 'utf8')), file).inputLog;
  return { version: INPUT_LOG_VERSION, seed, car, tickSeconds, subSteps, frames };
}
