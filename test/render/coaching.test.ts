// S005-AC-10 (coaching half): the "Drift!" coaching line shows only with real rear slip, meaningful speed and
// throttle (Sprint 004 blind test: it showed at walking pace with no throttle). The sim's mode is read, never changed.
import { describe, expect, it } from 'vitest';
import { createCarRegistry } from '../../src/core/car-registry.ts';
import { step } from '../../src/core/sim.ts';
import { startRun } from '../../src/run.ts';
import { carStep, createCar, createSimParams, loadCarParams, predict, type CarState } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import gt3 from '../../src/cars/gt3.json';
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

// S005-T11 (blind round 2, m2): lines still flashed 1-4 frames, mostly the help line between two warnings and
// "Drift!" between two rear warnings. Now no line is shown under MSG_HOLD unless "Rodou!" replaces it, a calmer
// line waits until the shown one has been gone MSG_HOLD, and a held drift keeps "Drift!" up.
const HELP = 'Vírgula reduz · Ponto sobe · M automático';
const SPIN = 'Rodou!';
const line = (text: string, rank: number, drift = false): Coach => ({ text, tone: 'plain', p: 0.2, rank, drift });
const help = line(HELP, 0), cut = line('Corte de giro — suba marcha (.) ou alivie', 2), wspin = line('Patinando — passou do limite de tração', 2);
const red = line(RED, 3), spin = line(SPIN, 4), paused = line('Pausado — analise a telemetria', 5);
/** Each `[line, seconds]` held for that long at `fps`; returns what the HUD showed as [text, seconds] runs. */
function shownRuns(seq: readonly (readonly [Coach, number])[], fps = 60): [string, number][] {
  const h = createCoachHold(), runs: [string, number][] = [];
  for (const [c, secs] of seq) {
    for (let i = 0; i < Math.round(secs * fps); i++) {
      const t = holdLine(h, c, 1 / fps).text, last = runs[runs.length - 1];
      if (last && last[0] === t) last[1] += 1 / fps;
      else runs.push([t, 1 / fps]);
    }
  }
  return runs;
}
/** Runs shown under MSG_HOLD before something other than "Rodou!" replaced them (the last run is still up). */
const flashes = (runs: [string, number][]) =>
  runs.filter(([, s], i) => i < runs.length - 1 && s < MSG_HOLD - 1e-6 && runs[i + 1]![0] !== SPIN);

describe('the coaching line hold (S005-T9, S005-T11)', () => {
  it(`keeps a shown line at least ${MSG_HOLD} s, even against a more urgent one`, () => {
    expect(MSG_HOLD).toBe(0.4);
    const runs = shownRuns([[help, 1 / 60], [red, 1]]);
    expect(runs.map(([t]) => t)).toEqual([HELP, RED]);
    expect(runs[0]![1]).toBeCloseTo(MSG_HOLD, 6);
  });

  it('lets "Rodou!" replace any line at once', () => {
    const runs = shownRuns([[help, 1 / 60], [spin, 1]]);
    expect(runs.map(([t, s]) => [t, Math.round(s * 60)])).toEqual([[HELP, 1], [SPIN, 60]]);
    expect(shownRuns([[red, 2 / 60], [spin, 1]])[1]![0]).toBe(SPIN);
  });

  it('shows and leaves the pause line at once', () => {
    expect(shownRuns([[help, 1 / 60], [paused, 2 / 60], [help, 1]]).map(([t, s]) => [t, Math.round(s * 60)]))
      .toEqual([[HELP, 1], [paused.text, 2], [HELP, 60]]);
  });

  it('never shows the help line for a moment between two warnings (grid launch: 17-67 ms)', () => {
    for (const gap of [1, 2, 3, 4]) {
      const runs = shownRuns([[cut, 0.42], [help, gap / 60], [cut, 0.42], [help, gap / 60], [wspin, 1]]);
      expect(runs.map(([t]) => t)).not.toContain(HELP);
    }
  });

  it('switches down to a calmer line only once the shown one has been gone the hold time', () => {
    const runs = shownRuns([[red, 0.5], [help, 1]]);
    expect(runs.map(([t]) => t)).toEqual([RED, HELP]);
    // The calmer line takes the frame on which the shown one has been gone MSG_HOLD.
    expect(Math.abs(runs[0]![1] - (0.5 + MSG_HOLD))).toBeLessThanOrEqual(1 / 60 + 1e-6);
  });

  it('has no line under the hold time in a busy sequence like the launch, at 60 and 144 frames a second', () => {
    // Grid launch S15: wheelspin, rev cut and rear warnings come and go every few frames, with help between.
    const pool = [help, cut, wspin, red, line('Traseira chegando ao limite — alivie', 2), help, help];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const seq = Array.from({ length: 300 }, () => [pool[Math.floor(rnd() * pool.length)]!, (1 + Math.floor(rnd() * 6)) / 60] as const);
    for (const fps of [60, 144]) {
      const runs = shownRuns(seq, fps);
      expect(runs.length).toBeGreaterThan(3);
      expect(flashes(runs)).toEqual([]);
    }
  });

  it('gives the same lines for the same frame sequence', () => {
    const seq = Array.from({ length: 200 }, (_, i) => [help, cut, red][(i * 7) % 3]!);
    const run = () => { const h = createCoachHold(); return seq.map((c) => holdLine(h, c, 1 / 60).text); };
    expect(run()).toEqual(run());
  });
});

describe('the coaching line in a held drift (S005-T11)', () => {
  it('keeps "Drift!" up while the rear warning comes and goes (key-held S15 drift)', () => {
    // Blind round 2: "Drift!" showed 0.05-0.07 s between two "Traseira passando do ponto" lines.
    const view = createView(1), shown: string[] = [];
    for (let k = 0; k < 6; k++) {
      for (let i = 0; i < 20; i++) shown.push(coachingLine(overLimit(1.0), view));
      for (let i = 0; i < 4; i++) shown.push(coachingLine(overLimit(0.2), view));
    }
    expect(new Set(shown)).toEqual(new Set([DRIFT_TEXT]));
  });

  it('still names a slide that keeps growing past control for the hold time', () => {
    const view = createView(1), shown: string[] = [];
    for (let i = 0; i < 30; i++) shown.push(coachingLine(overLimit(0.2), view));
    for (let i = 0; i < 60; i++) shown.push(coachingLine(overLimit(1.0), view));
    expect(shown.indexOf(RED)).toBeGreaterThan(30);
    expect(shown.at(-1)).toBe(RED);
  });

  it('lets "Rodou!" end a drift at once', () => {
    const view = createView(1);
    coachingLine(overLimit(0.2), view);
    expect(coachingLine(deepFreeze({ ...overLimit(1.0), mode: 'spin' }), view)).toBe(SPIN);
  });
});

describe('the coaching line on a real grid launch, throttle held 8 s (S005-T11)', () => {
  const cars = createCarRegistry([loadCarParams(s15, 's15-drift.json'), loadCarParams(gt3, 'gt3.json')]);
  for (const car of ['s15-drift', 'gt3']) {
    for (const fps of [60, 144]) {
      it(`${car} at ${fps} frames a second: no line flashes`, () => {
        const run = startRun({ seed: 1, car, track: 'interlagos' }, cars), h = createCoachHold(), runs: [string, number][] = [];
        const frame = { throttle: 1, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false };
        let state = run.state, acc = 0;
        for (let tick = 0; tick < 480;) {
          for (acc += 1 / fps; acc >= 1 / 60 - 1e-9 && tick < 480; acc -= 1 / 60, tick++) state = step(state, frame, run.params, carStep);
          const s = state.car, c = coachLine(s, { paused: false, onTrack: true, lineSlip: predict(s, run.params).slip });
          const t = holdLine(h, c, 1 / fps).text, last = runs[runs.length - 1];
          if (last && last[0] === t) last[1] += 1 / fps;
          else runs.push([t, 1 / fps]);
        }
        expect(runs.length).toBeGreaterThan(1);
        expect(flashes(runs)).toEqual([]);
      });
    }
  }
});
