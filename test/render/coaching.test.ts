// S005-AC-10 (coaching half): the "Drift!" coaching line shows only with real rear slip, meaningful speed and
// throttle (Sprint 004 blind test: it showed at walking pace with no throttle). The sim's mode is read, never changed.
import { describe, expect, it } from 'vitest';
import { createCarRegistry } from '../../src/core/car-registry.ts';
import { createState, step } from '../../src/core/sim.ts';
import type { InputFrame } from '../../src/core/input-frame.ts';
import { startRun } from '../../src/run.ts';
import { carStep, createCar, createSimParams, loadCarParams, predict, type CarState, type SimParams } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import gt3 from '../../src/cars/gt3.json';
import {
  CALM_ENTER, RED_SWAP, REAR_SHRINK_MAX, coachLine, coachMode, createCoachHold, DRIFT_GROW_MAX, DRIFT_MSG_KMH, DRIFT_MSG_REAR_SLIP, DRIFT_MSG_THROTTLE, holdLine, MSG_HOLD, type Coach,
} from '../../src/render/coaching.ts';
import { buildLot } from '../../src/render/lot.ts';
import { drawScene } from '../../src/render/scene.ts';
import { createView, type View } from '../../src/render/view.ts';
import { TRACKS } from '../../src/tracks/index.ts';
import { deepFreeze } from '../core/helpers.ts';
import { autopilot } from '../sim/autopilot.ts';
import { idle, KMH, open, s15 as s15Car } from '../sim/gt3-helpers.ts';
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

// S005-T11 (blind round 2, m2) and S005-T13 (blind round 3, m1): no line flashes, and a red warning is never late.
// A red warning (rank 3) or "Rodou!" replaces any calmer line at once. Any other line stays at least MSG_HOLD; a calmer
// line enters only once it has been chosen without a break for CALM_ENTER and the shown one has been gone MSG_HOLD.
// In a drift worth coaching, "Drift!" holds over the calmer lines.
const HELP = 'Vírgula reduz · Ponto sobe · M automático';
const SPIN = 'Rodou!';
const FRONT_RED = 'Dianteira saturando — menos direção';
const line = (text: string, rank: number, drift = false): Coach => ({ text, tone: 'plain', p: 0.2, rank, drift });
const help = line(HELP, 0), cut = line('Corte de giro — suba marcha (.) ou alivie', 2), wspin = line('Patinando — passou do limite de tração', 2);
const warn = line('Traseira chegando ao limite — alivie', 2), off = line('Fora da pista', 1);
const red = line(RED, 3), frontRed = line(FRONT_RED, 3), spin = line(SPIN, 4), paused = line('Pausado — analise a telemetria', 5);
const URGENT = new Set([RED, FRONT_RED, 'Saindo de traseira — contraesterce', SPIN, paused.text]);
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
/** Runs shown under MSG_HOLD before something other than a red warning or "Rodou!" replaced them (the last run is still up). */
const flashes = (runs: [string, number][]) =>
  runs.filter(([, s], i) => i < runs.length - 1 && s < MSG_HOLD - 1e-6 && !URGENT.has(runs[i + 1]![0]));
const frames = (runs: [string, number][], fps = 60) => runs.map(([t, s]) => [t, Math.round(s * fps)]);

describe('the coaching line hold (S005-T9, S005-T11, S005-T13)', () => {
  it(`uses stated times: ${MSG_HOLD} s hold, ${CALM_ENTER} s for a calmer line to enter`, () => {
    expect([MSG_HOLD, CALM_ENTER]).toEqual([0.4, 0.2]);
  });

  it(`keeps a shown line at least ${MSG_HOLD} s against a warning below red`, () => {
    const runs = shownRuns([[help, 1 / 60], [warn, 1]]);
    expect(runs.map(([t]) => t)).toEqual([HELP, warn.text]);
    expect(runs[0]![1]).toBeCloseTo(MSG_HOLD, 6);
  });

  it('lets a red warning replace any calmer line at once (blind round 3: 0.12-0.37 s late)', () => {
    expect(frames(shownRuns([[help, 1 / 60], [red, 1]]))).toEqual([[HELP, 1], [RED, 60]]);
    expect(frames(shownRuns([[cut, 2 / 60], [red, 1]]))).toEqual([[cut.text, 2], [RED, 60]]);
    expect(frames(shownRuns([[line(DRIFT_TEXT, 2, true), 2 / 60], [line(RED, 3, true), 1]]))).toEqual([[DRIFT_TEXT, 2], [RED, 60]]);
  });

  it('shows the GT3 front warning at once although a calmer line went up 0.12 s before (blind round 3, 11.32 s)', () => {
    const runs = shownRuns([[off, 1], [wspin, 0.12], [frontRed, 0.26], [off, 1]]);
    expect(runs.map(([t]) => t)).toContain(FRONT_RED);
    expect(runs.find(([t]) => t === FRONT_RED)![1]).toBeGreaterThanOrEqual(0.26 - 1e-6);
  });

  it('lets "Rodou!" replace any line at once, a red warning too', () => {
    expect(frames(shownRuns([[help, 1 / 60], [spin, 1]]))).toEqual([[HELP, 1], [SPIN, 60]]);
    expect(frames(shownRuns([[red, 2 / 60], [spin, 1]]))).toEqual([[RED, 2], [SPIN, 60]]);
  });

  it('shows and leaves the pause line at once', () => {
    expect(frames(shownRuns([[help, 1 / 60], [paused, 2 / 60], [help, 1]]))).toEqual([[HELP, 1], [paused.text, 2], [HELP, 60]]);
  });

  it('never shows the help line for a moment between two warnings (grid launch: 17-67 ms)', () => {
    for (const gap of [1, 2, 3, 4]) {
      for (const w of [cut, red]) {
        const runs = shownRuns([[w, 0.42], [help, gap / 60], [w, 0.42], [help, gap / 60], [wspin, 1]]);
        expect(runs.map(([t]) => t)).not.toContain(HELP);
      }
    }
  });

  it('switches down to a calmer line only once the shown one has been gone the hold time', () => {
    const runs = shownRuns([[red, 0.5], [help, 1]]);
    expect(runs.map(([t]) => t)).toEqual([RED, HELP]);
    // The calmer line takes the frame on which the shown one has been gone MSG_HOLD.
    expect(Math.abs(runs[0]![1] - (0.5 + MSG_HOLD))).toBeLessThanOrEqual(1 / 60 + 1e-6);
  });

  it(`lets a calmer line in only once it has been chosen ${CALM_ENTER} s without a break`, () => {
    // After the red warning, help and off-road alternate every 0.1 s: neither enters until help holds 0.2 s.
    const alt = Array.from({ length: 8 }, (_, i) => [i % 2 ? off : help, 0.1] as const);
    const runs = shownRuns([[red, 0.5], ...alt, [help, 1]]);
    expect(runs.map(([t]) => t)).toEqual([RED, HELP]);
    expect(runs[0]![1]).toBeGreaterThanOrEqual(0.5 + 0.8 + CALM_ENTER - 1 / 60 - 1e-6);
  });

  it('has no line flashing in a busy sequence like the launch, at 60 and 144 frames a second', () => {
    // Grid launch S15: wheelspin, rev cut and rear warnings come and go every few frames, with help between.
    const pool = [help, cut, wspin, red, warn, help, help];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const seq = Array.from({ length: 300 }, () => [pool[Math.floor(rnd() * pool.length)]!, (1 + Math.floor(rnd() * 12)) / 60] as const);
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

// S005-T15 (blind round 4, M3, m6, m7): a calmer line enters only once it has been chosen CALM_ENTER without a break,
// also over a still calmer line, so an escalation goes straight to the red warning; a different red warning replaces
// the shown one once it has been chosen RED_SWAP; "Saindo de traseira" has the red rank.
const DRIFT_LINE = line(DRIFT_TEXT, 2, true);
const frontWarn = line('Dianteira chegando ao limite — menos direção/freio', 2);
const rearSlide = line('Saindo de traseira — contraesterce', 3);
/** Runs of calmer lines (not red, not "Rodou!", not the pause) shown under CALM_ENTER and then replaced. */
const REDS = new Set([...URGENT, rearSlide.text]);
const shortCalm = (runs: [string, number][]) =>
  runs.filter(([t, s], i) => i > 0 && i < runs.length - 1 && !REDS.has(t) && !REDS.has(runs[i + 1]![0]) && s < CALM_ENTER - 1e-6);

describe('calm lines and red warnings (S005-T15)', () => {
  it(`uses a stated time: a different red warning takes over after ${RED_SWAP} s`, () => {
    expect(RED_SWAP).toBe(0.1);
  });

  it('goes straight from help to the red warning when a near-limit line escalates (M3: 1 frame of "chegando ao limite")', () => {
    for (const fps of [30, 60, 144]) {
      for (const lead of [1 / fps, 0.05, 0.13, 0.18]) {
        for (const [calm, redLine] of [[frontWarn, frontRed], [warn, red], [DRIFT_LINE, red]] as const) {
          const runs = shownRuns([[help, 1], [calm, lead], [redLine, 1]], fps);
          expect(runs.map(([t]) => t), `${calm.text} ${lead} s at ${fps} fps`).toEqual([HELP, redLine.text]);
        }
      }
    }
  });

  it(`shows a calmer line over a still calmer one only after ${CALM_ENTER} s without a break`, () => {
    const runs = shownRuns([[help, 1], [warn, 1]]);
    expect(runs.map(([t]) => t)).toEqual([HELP, warn.text]);
    expect(Math.abs(runs[0]![1] - (1 + CALM_ENTER))).toBeLessThanOrEqual(1 / 60 + 1e-6);
  });

  it('still shows a red warning at once over any calmer line', () => {
    expect(frames(shownRuns([[help, 1], [warn, 0.3], [red, 1]]))).toEqual([[HELP, 71], [warn.text, 7], [RED, 60]]);
  });

  it(`lets a different red warning replace the shown one after ${RED_SWAP} s, not ${MSG_HOLD} s (m6)`, () => {
    for (const fps of [60, 144]) {
      for (const [a, b] of [[red, frontRed], [frontRed, red], [red, rearSlide]] as const) {
        const runs = shownRuns([[help, 1], [a, 1 / fps], [b, 1]], fps);
        expect(runs.map(([t]) => t)).toEqual([HELP, a.text, b.text]);
        expect(runs[1]![1]).toBeLessThanOrEqual(RED_SWAP + 1 / fps + 1e-6);
        expect(runs[1]![1]).toBeGreaterThanOrEqual(RED_SWAP - 1e-6);
      }
    }
  });

  it('does not flicker between two red warnings that alternate faster than that', () => {
    const alt = Array.from({ length: 10 }, (_, i) => [i % 2 ? frontRed : red, 0.05] as const);
    expect(shownRuns([[help, 1], [red, 0.5], ...alt, [red, 0.5]]).map(([t]) => t)).toEqual([HELP, RED]);
  });

  it('gives "Saindo de traseira — contraesterce" the red rank, so it shows at once (m7)', () => {
    const c = coachLine(drifting(15, 0, 0.35), opts);
    expect([c.text, c.tone, c.rank]).toEqual([rearSlide.text, 'red', 3]);
    expect(frames(shownRuns([[help, 1 / 60], [c, 1]]))).toEqual([[HELP, 1], [rearSlide.text, 60]]);
    expect(frames(shownRuns([[help, 1], [DRIFT_LINE, 0.1], [c, 1]]))).toEqual([[HELP, 66], [rearSlide.text, 60]]);
  });

  it('keeps "Rodou!" above every red warning', () => {
    expect(frames(shownRuns([[rearSlide, 2 / 60], [spin, 1]]))).toEqual([[rearSlide.text, 2], [SPIN, 60]]);
    expect(shownRuns([[spin, 0.1], [red, 0.3], [spin, 1]]).map(([t]) => t)).toEqual([SPIN]);
  });

  it('shows no calmer line under the calm time in a busy sequence like the launch, at 60 and 144 frames a second', () => {
    // Lines are chosen in runs of 1-12 frames. A red warning may still cut a calm line short right after it entered
    // (Main Dev's cheapest fix keeps red at once), so a short calm run is counted only when a calm line replaced it.
    const pool = [help, cut, wspin, warn, frontWarn, red, frontRed, rearSlide, help, help];
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const seq = Array.from({ length: 300 }, () => [pool[Math.floor(rnd() * pool.length)]!, (1 + Math.floor(rnd() * 12)) / 60] as const);
    for (const fps of [60, 144]) expect(shortCalm(shownRuns(seq, fps))).toEqual([]);
  });
});

describe('the coaching line in a drift (S005-T11, S005-T13)', () => {
  it('keeps "Drift!" up while calmer lines come and go in a drift worth coaching', () => {
    const drift = line(DRIFT_TEXT, 2, true), slipping = line(wspin.text, 2, true), cutting = line(cut.text, 2, true);
    const seq = [[drift, 0.3], ...Array.from({ length: 12 }, (_, i) => [[slipping, cutting][i % 2]!, 0.3] as const), [drift, 0.05]] as const;
    expect(shownRuns(seq).map(([t]) => t)).toEqual([DRIFT_TEXT]);
  });

  it('shows the red warning at once when the slide grows past control, and "Drift!" never flashes back between two reds', () => {
    const view = createView(1), shown: string[] = [];
    for (let i = 0; i < 30; i++) shown.push(coachingLine(overLimit(0.2), view));
    for (let k = 0; k < 6; k++) {
      for (let i = 0; i < 20; i++) shown.push(coachingLine(overLimit(1.0), view));
      for (let i = 0; i < 4; i++) shown.push(coachingLine(overLimit(0.2), view));
    }
    expect(shown.indexOf(RED)).toBe(30);
    expect(new Set(shown.slice(30))).toEqual(new Set([RED]));
  });

  it('lets "Rodou!" end a drift at once', () => {
    const view = createView(1);
    coachingLine(overLimit(0.2), view);
    expect(coachingLine(deepFreeze({ ...overLimit(1.0), mode: 'spin' }), view)).toBe(SPIN);
  });
});

describe('the coaching line on real Interlagos launches (S005-T11, S005-T13, S005-T15)', () => {
  const cars = createCarRegistry([loadCarParams(s15, 's15-drift.json'), loadCarParams(gt3, 'gt3.json')]);
  const track = TRACKS.find((t) => t.id === 'interlagos')!;
  const W = { throttle: 1, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false };
  /**
   * Shown runs, the longest wait, s, from a red warning (or "Rodou!") being chosen to one being shown, and the longest
   * a different red warning was chosen without a break while another red one stayed up (S005-T15 m6).
   */
  function drive(car: string, fps: number, ticks: number, auto: boolean) {
    const run = startRun({ seed: 1, car, track: 'interlagos' }, cars), h = createCoachHold(), runs: [string, number][] = [];
    const input = auto ? autopilot(run, track, ticks, 60, 25) : null;
    let state = run.state, acc = 0, wait = -1, worst = 0, chosen = '', chosenFor = 0, swap = 0;
    for (let tick = 0; tick < ticks;) {
      for (acc += 1 / fps; acc >= 1 / 60 - 1e-9 && tick < ticks; acc -= 1 / 60, tick++) state = step(state, input ? input[tick]! : W, run.params, carStep);
      const s = state.car, c = coachLine(s, { paused: false, onTrack: true, lineSlip: predict(s, run.params).slip });
      const shown = holdLine(h, c, 1 / fps), last = runs[runs.length - 1];
      if (c.rank >= 3 && shown.rank < 3) wait = wait < 0 ? 1 / fps : wait + 1 / fps;
      else wait = -1;
      worst = Math.max(worst, wait);
      chosenFor = c.text === chosen ? chosenFor + 1 / fps : 1 / fps;
      chosen = c.text;
      if (c.rank === 3 && shown.rank === 3 && shown.text !== c.text) swap = Math.max(swap, chosenFor);
      if (last && last[0] === shown.text) last[1] += 1 / fps;
      else runs.push([shown.text, 1 / fps]);
    }
    return { runs, worst, swap };
  }
  for (const car of ['s15-drift', 'gt3']) {
    for (const fps of [60, 144]) {
      it(`${car} at ${fps} frames a second: no line flashes, no red warning waits, a red one swaps within ${RED_SWAP} s`, () => {
        for (const [ticks, auto] of [[480, false], [1200, true]] as const) {
          const { runs, worst, swap } = drive(car, fps, ticks, auto);
          expect(runs.length).toBeGreaterThan(1);
          expect(flashes(runs)).toEqual([]);
          expect(shortCalm(runs)).toEqual([]);
          expect(worst).toBe(0);
          expect(swap).toBeLessThan(RED_SWAP + 1 / fps + 1e-6);
        }
      });
    }
  }
});

// S005-T17 (blind round 5, m1 and the largest M2 group): "Saindo de traseira — contraesterce" showed while the slide
// was already being caught (slip -13.7 deg shrinking at 0.35 rad/s as it dropped below the sim's drift mark), and it
// cut "Drift!" short after one frame. It now shows only while the body slip grows or holds (the sim's rate dB).
describe('the rear-slide warning on a slide being caught (S005-T17)', () => {
  type S = ReturnType<typeof createState<CarState>>;
  const DEG = 180 / Math.PI, REAR = 'Saindo de traseira — contraesterce';
  const tick = (s: S, p: SimParams, k: Partial<InputFrame>): S => step(s, { ...idle, ...k }, p, carStep);
  /** Straight ahead at `kmh` in the automatic-box gear, settled for 20 ticks (as in the countersteer tests). */
  function at(kmh: number): { s: S; p: SimParams } {
    const p = open(s15Car()), c = p.car, v = kmh * KMH;
    const rpm = (g: number): number => ((v / c.wheelRadius) * c.gears[g]! * c.finalDrive * 60) / (2 * Math.PI);
    let g = 0;
    while (g < c.gears.length - 1 && rpm(g) > c.autoUpRpm) g++;
    const s0 = createState(1, createCar(p));
    let s: S = { ...s0, car: { ...s0.car, vx: v, v, gear: g, rpm: rpm(g), rateR: v / c.wheelRadius, rateF: v / c.wheelRadius, t: 0.5 } };
    for (let i = 0; i < 20; i++) s = tick(s, p, { throttle: s.car.v < v ? 1 : 0 });
    return { s, p };
  }
  /** Tester repro on the lot: W + D to `rel` deg of slip, D let go, A pressed `late` s later and held, W held, 3 s. */
  function repro(kmh: number, rel: number, late: number) {
    let { s, p } = at(kmh);
    const h = createCoachHold(), runs: [string, number][] = [], rearWhileShrinking: string[] = [];
    const frame = (k: Partial<InputFrame>) => {
      s = tick(s, p, k);
      const c = coachLine(s.car, { paused: false, onTrack: false, lineSlip: predict(s.car, p).slip });
      if (c.text === REAR && s.car.dB < -REAR_SHRINK_MAX) rearWhileShrinking.push(`${(s.car.beta * DEG).toFixed(1)} deg at ${s.car.dB.toFixed(2)} rad/s`);
      const t = holdLine(h, c, 1 / 60).text, last = runs[runs.length - 1];
      if (last && last[0] === t) last[1] += 1 / 60;
      else runs.push([t, 1 / 60]);
    };
    for (let n = 0; Math.abs(s.car.beta) < rel / DEG; n++) {
      if (n >= 900) throw new Error(`${kmh} km/h: W + D never reached ${rel} deg`);
      frame({ right: 1, throttle: 1 });
    }
    for (let i = 0; i < Math.round(late * 60); i++) frame({ throttle: 1 });
    for (let i = 0; i < 180; i++) frame({ left: 1, throttle: 1 });
    return { runs, rearWhileShrinking };
  }
  /** Calm lines (below red) shown under CALM_ENTER before any other line (or `by`, when given) replaced them. */
  const cutShort = (runs: [string, number][], by?: string) =>
    runs.filter(([t, s], i) => i > 0 && i < runs.length - 1 && !REDS.has(t) && s < CALM_ENTER - 1e-6 && (by === undefined || runs[i + 1]![0] === by));
  const caught = (beta: number, dB: number, t = 1): CarState =>
    deepFreeze({ ...createCar(params), mode: 'rear', beta, v: 66 / 3.6, vx: 66 / 3.6, t, ar: beta, dB });

  it(`uses a stated limit: a slide shrinking faster than ${REAR_SHRINK_MAX} rad/s is being caught`, () => {
    expect(REAR_SHRINK_MAX).toBe(0.1);
  });

  it('does not show the warning on the tester\'s slide being caught (-13.7 deg shrinking at 0.35 rad/s)', () => {
    expect(coachLine(caught(-13.7 / DEG, -0.35), opts).text).not.toBe(REAR);
    expect(coachLine(caught(-13.7 / DEG, -0.35), opts).rank).toBeLessThan(3);
  });

  it('still shows it while the slide grows or holds', () => {
    for (const dB of [0.5, 0, -REAR_SHRINK_MAX]) expect(coachLine(caught(-13.7 / DEG, dB), opts).text, `${dB} rad/s`).toBe(REAR);
    expect(coachLine(drifting(15, 0, 0.35), opts).text).toBe(REAR); // lifting in a drift, slip holding
  });

  it('does not show it either when the throttle is lifted in a drift that is being caught', () => {
    expect(coachLine(deepFreeze({ ...drifting(15, 0, 0.35), dB: -0.35 }), opts).text).not.toBe(REAR);
  });

  it('repro: lot, 66 km/h, 5 deg, W held, A 0.3 s late: no warning while shrinking and no calm line cut short', () => {
    const { runs, rearWhileShrinking } = repro(66, 5, 0.3);
    expect(rearWhileShrinking).toEqual([]);
    expect(cutShort(runs), JSON.stringify(frames(runs))).toEqual([]);
  });

  it('never cuts a calm line short with the rear warning on nearby catches', () => {
    // A red escalation ("passando do ponto") may still cut "Drift!" short (accepted in round 4); the rear warning may not.
    for (const [kmh, rel, late] of [[62, 5, 0.3], [70, 5, 0.3], [66, 10, 0.3], [66, 5, 0.2], [66, 5, 0.5]] as const) {
      const { runs, rearWhileShrinking } = repro(kmh, rel, late), at = `${kmh} km/h ${rel} deg ${late} s`;
      expect(rearWhileShrinking, at).toEqual([]);
      expect(cutShort(runs, REAR), at).toEqual([]);
    }
  });
});
