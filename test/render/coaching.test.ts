// S005-AC-10 (coaching half): the "Drift!" coaching line shows only with real rear slip, meaningful speed and
// throttle (Sprint 004 blind test: it showed at walking pace with no throttle). The sim's mode is read, never changed.
import { describe, expect, it } from 'vitest';
import { createCar, createSimParams, loadCarParams, type CarState } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import {
  coachLine, coachMode, createCoachHold, DRIFT_GROW_MAX, DRIFT_MSG_KMH, DRIFT_MSG_REAR_SLIP, DRIFT_MSG_THROTTLE, holdLine, MSG_HOLD, type Coach,
} from '../../src/render/coaching.ts';
import { buildLot } from '../../src/render/lot.ts';
import { drawScene } from '../../src/render/scene.ts';
import { createView, type View } from '../../src/render/view.ts';
import { deepFreeze } from '../core/helpers.ts';
import { factoryFor, recordingContext } from './canvas-stub.ts';

const params = createSimParams(loadCarParams(s15, 's15-drift.json'));
const DRIFT_TEXT = 'Drift! Acelerador + contraesterço';
/** A car the sim has put in drift mode (body slip above 0.25 rad), with the given speed, throttle and rear slip. */
const drifting = (v: number, t: number, ar: number): CarState =>
  deepFreeze({ ...createCar(params), mode: 'drift', beta: 0.4, v, vx: v, t, ar });

function coachingLine(car: CarState, view: View = createView(1)): string {
  const rec = recordingContext();
  drawScene(rec.ctx, { car, params, view, lot: buildLot(factoryFor(rec.ctx), params.lot), paused: false, dt: 1 / 60, track: null, lap: null });
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

// S005-T9 (blind test m4, m5): a held, controlled drift shows "Drift!" over the red warning, and a shown line
// stays up at least MSG_HOLD unless a more urgent one replaces it. The hold lives in the render-side view.
/** Rear past the point of control on the halo (p = 1, risk rising), with the body slip growing at `dB` rad/s. */
const overLimit = (dB: number): CarState =>
  deepFreeze({ ...drifting(15, 0.8, 0.35), riskR: 5, riskF: 0, uRs: 1.5, dRs: 1, dB });
const RED = 'Traseira passando do ponto — alivie já';
const opts = { paused: false, onTrack: false, lineSlip: false };

describe('the Drift! message in a held drift (S005-T9)', () => {
  it(`uses a stated limit: body slip growing at most ${DRIFT_GROW_MAX} rad/s is under control`, () => {
    expect(DRIFT_GROW_MAX).toBe(0.6);
  });

  it('shows "Drift!" over the red warning while the slide is held', () => {
    expect(coachLine(overLimit(0.2), opts).text).toBe(DRIFT_TEXT);
    expect(coachLine(overLimit(DRIFT_GROW_MAX), opts).text).toBe(DRIFT_TEXT);
  });

  it('shows the red warning when the slide grows past control', () => {
    expect(coachLine(overLimit(1.0), opts).text).toBe(RED);
  });

  it('shows "Rodou!" over every warning', () => {
    expect(coachLine(deepFreeze({ ...overLimit(1.0), mode: 'spin' }), opts).text).toBe('Rodou!');
  });
});

describe('the coaching line hold (S005-T9)', () => {
  const line = (text: string, rank: number): Coach => ({ text, tone: 'plain', p: 0.2, rank });
  const calm = line('calm', 1), other = line('other', 1), urgent = line('urgent', 3);

  it(`keeps a shown line at least ${MSG_HOLD} s against an equal or calmer one`, () => {
    expect(MSG_HOLD).toBe(0.4);
    const h = createCoachHold();
    expect(holdLine(h, calm, 0.1).text).toBe('calm');
    for (let i = 0; i < 3; i++) expect(holdLine(h, i % 2 ? calm : other, 0.1).text).toBe('calm');
    expect(holdLine(h, other, 0.1).text).toBe('other'); // up 0.4 s now
  });

  it('lets a more urgent line replace at once, then holds that one too', () => {
    const h = createCoachHold();
    holdLine(h, calm, 1 / 60);
    expect(holdLine(h, urgent, 1 / 60).text).toBe('urgent');
    for (let i = 0; i < 23; i++) expect(holdLine(h, calm, 1 / 60).text).toBe('urgent');
    expect(holdLine(h, calm, 1 / 60).text).toBe('calm');
  });

  it('gives the same lines for the same frame sequence', () => {
    const seq = Array.from({ length: 200 }, (_, i) => [calm, other, urgent][(i * 7) % 3]!);
    const run = () => { const h = createCoachHold(); return seq.map((c) => holdLine(h, c, 1 / 60).text); };
    expect(run()).toEqual(run());
  });

  it('stops the drawn line flickering between a drift and the red warning', () => {
    const view = createView(1), shown: string[] = [];
    // The slide flips between held and growing every frame for 0.3 s: the first line stays.
    for (let i = 0; i < 18; i++) shown.push(coachingLine(overLimit(i % 2 ? 1.0 : 0.2), view));
    expect(new Set(shown)).toEqual(new Set([DRIFT_TEXT, RED]));
    expect(shown.filter((t, i) => i > 0 && t !== shown[i - 1]).length).toBe(1); // red is more urgent: one switch
  });
});
