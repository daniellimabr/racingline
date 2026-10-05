// S002-AC-04: the six scenario input logs (kept in test/fixtures/v24/ as inputs only) replayed through the
// game's own run setup give the final state hash and racing-line hash locked in test/fixtures/golden.json.
// The game is the source of truth (Daniel 2026-10-05), not prototype v24. A deliberate behavior change
// regenerates the file in the same commit and adds a one-line reason:
//   UPDATE_GOLDEN="<one-line reason>" npx vitest run test/sim/golden-replay.test.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hashState } from '../../src/core/hash.ts';
import { createCarRegistry } from '../../src/core/car-registry.ts';
import { replayRun } from '../../src/run.ts';
import { createSimParams, loadCarParams, predict } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import { scenarioFiles, scenarioLog } from './scenario-logs.ts';

const GOLDEN = new URL('../fixtures/golden.json', import.meta.url);

interface Golden {
  reasons: string[]; // one line per regeneration, newest last
  scenarios: Record<string, { state: string; line: string }>;
}

const cars = createCarRegistry([loadCarParams(s15, 's15-drift.json')]);
const files = scenarioFiles();

function run(file: string): { state: string; line: string } {
  const log = scenarioLog(file);
  const r = replayRun(log, cars);
  const line = predict(r.state.car, createSimParams(cars.get(log.car)));
  return { state: hashState(r.state), line: hashState(line) };
}

const reason = process.env.UPDATE_GOLDEN;
if (reason) {
  const old: Golden = (() => {
    try { return JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden; } catch { return { reasons: [], scenarios: {} }; }
  })();
  const scenarios = Object.fromEntries(files.map((f) => [f.replace('.trace.json', ''), run(f)]));
  writeFileSync(GOLDEN, JSON.stringify({ reasons: [...old.reasons, reason], scenarios }, null, 2) + '\n');
}

const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden;

describe('golden replay hashes (S002-AC-04)', () => {
  it('locks all six scenarios and every regeneration has a reason', () => {
    expect(files).toHaveLength(6);
    expect(Object.keys(golden.scenarios).sort()).toEqual(files.map((f) => f.replace('.trace.json', '')));
    expect(golden.reasons.length).toBeGreaterThan(0);
    for (const r of golden.reasons) expect(r.trim().length, 'empty reason').toBeGreaterThan(0);
  });

  it.each(files)('%s replays to the golden hashes', (file) => {
    expect(run(file)).toEqual(golden.scenarios[file.replace('.trace.json', '')]);
  });
});
