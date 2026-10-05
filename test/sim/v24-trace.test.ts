// S001-AC-06: replaying each v24 reference trace's input log through src/core + the sim port
// reproduces every sampled v24 signal within the per-signal tolerance in test/fixtures/TOLERANCES.md.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createState, step } from '../../src/core/sim.ts';
import { parseReferenceTrace } from '../../src/data/trace.ts';
import { carStep, createCar, createSimParams, loadCarParams, predict, tractionState, MODES } from '../../src/sim/index.ts';
import type { CarState, SimParams } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';

const FIXTURES = new URL('../fixtures/v24/', import.meta.url);
const TOLERANCES = new URL('../fixtures/TOLERANCES.md', import.meta.url);

/** Rows "| signal | tolerance | reason |" of TOLERANCES.md; `*` is the default. */
function readTolerances(md: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of md.matchAll(/^\|\s*`?([\w*]+)`?\s*\|\s*([0-9.eE+-]+)\s*\|/gm)) map.set(m[1]!, Number(m[2]));
  if (!map.has('*')) throw new Error('TOLERANCES.md needs a default row "*"');
  return map;
}

const yes = (b: boolean): number => (b ? 1 : 0);

/** The port's values under v24's trace signal names (tools/v24-traces.mjs sample()). */
function signals(car: CarState, p: SimParams): Record<string, number> {
  const ts = tractionState(car);
  const pr = predict(car, p);
  const end = pr.pts[pr.pts.length - 1]!;
  const { x, y, h, vx, vy, r, v, beta, t, b, st, delta, wob, af, ar, axp, u, lim, spinR, useF, useR, uFs, uRs } = car;
  const { dFs, dRs, dB, riskF, riskR, rateF, rateR, gear, rpm, groundRpm, shiftT, shiftCd } = car;
  return {
    tt: car.tt, x, y, h, vx, vy, r, v, beta, t, b, st, delta, wob, af, ar, axp, u, lim,
    wspin: yes(car.wspin), spinR, lockF: yes(car.lockF), useF, useR, uFs, uRs, dFs, dRs, dB, riskF, riskR, rateF, rateR,
    gear, auto: yes(car.auto), rpm, groundRpm, cut: yes(car.cut), shiftT, shiftCd, off: yes(car.off),
    mode: MODES.indexOf(car.mode),
    haloRisk: ts.risk, haloRear: yes(ts.rear), haloP: ts.p, haloWarn: yes(ts.warn), haloRising: yes(ts.rising),
    predSlip: yes(pr.slip), predEndX: end[0] * p.lot.scale, predEndY: end[1] * p.lot.scale,
    drifting: yes(car.cur !== null), driftsDone: car.drifts.length,
  };
}

const tol = readTolerances(readFileSync(TOLERANCES, 'utf8'));
const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.trace.json')).sort();
const car = loadCarParams(s15, 's15-drift.json');

describe('port matches v24 reference traces (S001-AC-06)', () => {
  it('has the six recorded scenarios', () => {
    expect(files).toHaveLength(6);
  });

  it.each(files)('%s', (file) => {
    const trace = parseReferenceTrace(JSON.parse(readFileSync(new URL(file, FIXTURES), 'utf8')), file);
    const params = createSimParams(car, trace.inputLog.skill);
    let state = createState(trace.inputLog.seed, createCar(params));
    let next = 0;
    let worst = { signal: '', diff: 0 };
    trace.inputLog.frames.forEach((frame, i) => {
      state = step(state, frame, params, carStep);
      const ref = trace.samples[next];
      if (ref?.tick !== i + 1) return;
      next++;
      const port = signals(state.car, params);
      for (const [k, want] of Object.entries(ref)) {
        if (k === 'tick') continue;
        expect(port, `signal ${k} missing from the port`).toHaveProperty(k);
        const diff = Math.abs(port[k]! - want);
        if (diff > worst.diff) worst = { signal: k, diff };
        expect(diff, `${file} tick ${ref.tick} signal ${k}: port ${port[k]} vs v24 ${want}`).toBeLessThanOrEqual(tol.get(k) ?? tol.get('*')!);
      }
    });
    expect(next).toBe(trace.samples.length);
    console.info(`${file}: worst difference ${worst.diff}${worst.signal ? ` (${worst.signal})` : ''}`);
  });
});
