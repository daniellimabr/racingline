// S001-AC-05: the same input log run with two seeds differs only in wobble-dependent values.
// The seed reaches the car only through the steering wobble (v24 line 199), so with the wobble's
// steering gain set to zero two seeds must agree on every value except the wobble itself.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createState, replay } from '../../src/core/sim.ts';
import type { InputFrame } from '../../src/core/input-frame.ts';
import { parseReferenceTrace } from '../../src/data/trace.ts';
import { carStep, createCar, createSimParams, loadCarParams, type CarState } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';

const trace = parseReferenceTrace(
  JSON.parse(readFileSync(new URL('../fixtures/v24/drift-countersteer.trace.json', import.meta.url), 'utf8')),
);
const frames = trace.inputLog.frames;
const car = loadCarParams(s15, 's15-drift.json');

const run = (seed: number, log: readonly InputFrame[], p = createSimParams(car, 0.4)) =>
  replay(log, createState(seed, createCar(p)), p, carStep).state.car;

/** Names of the car values that differ (=== on numbers, so 0 and -0 count as equal). */
function differing(a: CarState, b: CarState): string[] {
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  return Object.keys(ra).filter((k) =>
    typeof ra[k] === 'object' ? JSON.stringify(ra[k]) !== JSON.stringify(rb[k]) : ra[k] !== rb[k],
  );
}

describe('seeds only change wobble-dependent values (S001-AC-05)', () => {
  it('with no wobble steering gain, two seeds differ only in the wobble value', () => {
    const p = createSimParams({ ...car, wobbleGain: 0 }, 0.4);
    expect(differing(run(1, frames, p), run(2, frames, p))).toEqual(['wob']);
  });

  it('with the car standing still, two seeds differ only in the wobble value', () => {
    const idle = frames.map((f) => ({ ...f, throttle: 0, left: 0, right: 0 }));
    expect(differing(run(1, idle), run(2, idle))).toEqual(['wob']);
  });

  it('while driving, the wobble moves the car but pedal and gearbox values stay the same', () => {
    const d = differing(run(1, frames), run(2, frames));
    expect(d).toEqual(expect.arrayContaining(['wob', 'x', 'y', 'h', 'delta']));
    for (const k of ['t', 'b', 'tt', 'auto']) expect(d).not.toContain(k);
  });

  it('the same seed gives the same car', () => {
    expect(differing(run(7, frames), run(7, frames))).toEqual([]);
  });
});
