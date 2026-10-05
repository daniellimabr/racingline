// S002-AC-03: a car with zero aero replays the six scenario logs to the same hashes as before aero
// existed (test/fixtures/golden.json), even when its zero aero fields are written out explicitly.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hashState } from '../../src/core/hash.ts';
import { createCarRegistry } from '../../src/core/car-registry.ts';
import { replayRun } from '../../src/run.ts';
import { loadCarParams } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import { scenarioFiles, scenarioLog } from './scenario-logs.ts';

const golden = JSON.parse(readFileSync(new URL('../fixtures/golden.json', import.meta.url), 'utf8'));
const explicitZero = { ...s15, downforceArea: 0, dragArea: 0, aeroBalanceFront: 0.5, airDensity: 1.1 };
const cars = createCarRegistry([loadCarParams(explicitZero, 's15-zero-aero.json')]);
const files = scenarioFiles();

describe('zero aero is bit-identical (S002-AC-03)', () => {
  it.each(files)('%s', (file) => {
    expect(hashState(replayRun(scenarioLog(file), cars).state)).toBe(golden.scenarios[file.replace('.trace.json', '')].state);
  });
});
