// Drift tracker end reasons (v24 finishDrift order: spin, off lot, slow, grip below / above the limit).
import { describe, expect, it } from 'vitest';
import { trackDrift } from '../../src/sim/drift.ts';
import { createCar, createSimParams, loadCarParams, type CarState } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';

const base = createCar(createSimParams(loadCarParams(s15, 's15-drift.json')));
const sliding: Partial<CarState> = { v: 12, beta: 0.5, st: 0.6, t: 0.8, lim: 0.6, rpm: 6000, gear: 1, mode: 'drift' };

/** Drifts for `ticks` ticks with `during`, then ends with `after`; returns the finished record list. */
function drift(ticks: number, during: Partial<CarState>, after: Partial<CarState>) {
  let s: CarState = { ...base, ...sliding, ...during };
  for (let i = 0; i < ticks; i++) {
    s = { ...s };
    trackDrift(s, 1 / 60);
  }
  s = { ...s, ...after };
  trackDrift(s, 1 / 60);
  expect(s.cur).toBeNull();
  return s.drifts;
}

describe('drift tracker', () => {
  it('records a drift that ends with the rear gripping under the limit', () => {
    const [d] = drift(30, { t: 0.5 }, { beta: 0 });
    expect(d).toMatchObject({ end: 'gripLow', gear: 2, cs: 1, above: 0, thr: 0.5, sd: 0 });
    expect(d!.dur).toBeCloseTo(0.5, 12);
    expect(d!.kmh).toBeCloseTo(12 * 3.6, 9);
  });

  it('names the other endings', () => {
    expect(drift(30, {}, { beta: 0 })[0]!.end).toBe('gripHigh');
    expect(drift(30, {}, { beta: 0, off: true })[0]!.end).toBe('off');
    expect(drift(30, { v: 4.5 }, { beta: 0 })[0]!.end).toBe('slow');
    expect(drift(2, { mode: 'spin', beta: 1.4 }, { v: 0, beta: 1.4 })[0]!.end).toBe('spin');
  });

  it('ignores slides shorter than 0.3 s and keeps the newest 10 drifts', () => {
    expect(drift(5, {}, { beta: 0 })).toEqual([]);
    let s: CarState = { ...base };
    for (let k = 0; k < 12; k++) {
      for (let i = 0; i < 30; i++) trackDrift((s = { ...s, ...sliding, rpm: k }), 1 / 60);
      trackDrift((s = { ...s, beta: 0 }), 1 / 60);
    }
    expect(s.drifts).toHaveLength(10);
    expect(s.drifts[0]!.rpm).toBe(11);
  });
});
