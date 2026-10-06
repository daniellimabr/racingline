// S005-AC-10 (coaching half): the "Drift!" coaching line shows only with real rear slip, meaningful speed and
// throttle (Sprint 004 blind test: it showed at walking pace with no throttle). The sim's mode is read, never changed.
import { describe, expect, it } from 'vitest';
import { createCar, createSimParams, loadCarParams, type CarState } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import { coachMode, DRIFT_MSG_KMH, DRIFT_MSG_REAR_SLIP, DRIFT_MSG_THROTTLE } from '../../src/render/coaching.ts';
import { buildLot } from '../../src/render/lot.ts';
import { drawScene } from '../../src/render/scene.ts';
import { createView } from '../../src/render/view.ts';
import { deepFreeze } from '../core/helpers.ts';
import { factoryFor, recordingContext } from './canvas-stub.ts';

const params = createSimParams(loadCarParams(s15, 's15-drift.json'));
const DRIFT_TEXT = 'Drift! Acelerador + contraesterço';
/** A car the sim has put in drift mode (body slip above 0.25 rad), with the given speed, throttle and rear slip. */
const drifting = (v: number, t: number, ar: number): CarState =>
  deepFreeze({ ...createCar(params), mode: 'drift', beta: 0.4, v, vx: v, t, ar });

function coachingLine(car: CarState): string {
  const rec = recordingContext();
  drawScene(rec.ctx, { car, params, view: createView(1), lot: buildLot(factoryFor(rec.ctx), params.lot), paused: false, dt: 1 / 60, track: null, lap: null });
  // The coaching line is the last text in the car panel, at y = 400.
  return rec.texts().filter(([, , y]) => y === 400).map(([s]) => s).join('|');
}

describe('the Drift! coaching message', () => {
  it('uses stated thresholds: 25 km/h, 30% throttle and 0.13 rad of rear slip', () => {
    expect([DRIFT_MSG_KMH, DRIFT_MSG_THROTTLE, DRIFT_MSG_REAR_SLIP]).toEqual([25, 0.3, 0.13]);
  });

  it('shows during a real power slide', () => {
    expect(coachMode(drifting(15, 0.8, 0.35))).toBe('drift');
    expect(coachingLine(drifting(15, 0.8, 0.35))).toBe(DRIFT_TEXT);
  });

  it('does not show at low speed with no throttle (the Sprint 004 report)', () => {
    const slow = drifting(2, 0, 0.6);
    expect(coachMode(slow)).toBe('');
    expect(coachingLine(slow)).not.toContain('Drift!');
  });

  it('does not show without throttle at speed; the rear-slide advice shows instead', () => {
    expect(coachMode(drifting(15, 0, 0.35))).toBe('rear');
    expect(coachingLine(drifting(15, 0, 0.35))).toBe('Saindo de traseira — contraesterce');
  });

  it('does not show below the speed or the rear slip limit', () => {
    expect(coachMode(drifting(25 / 3.6 - 0.1, 1, 0.35))).toBe('');
    expect(coachMode(drifting(15, 1, 0.1))).toBe('');
    expect(coachMode(drifting(15, 1, -0.35))).toBe('drift'); // either direction of slide counts
  });

  it('passes every other sim mode through unchanged', () => {
    for (const mode of ['', 'front', 'rear', 'spin'] as const) {
      expect(coachMode(deepFreeze({ ...createCar(params), mode, v: 1, t: 0, ar: 0 }))).toBe(mode);
    }
  });
});
