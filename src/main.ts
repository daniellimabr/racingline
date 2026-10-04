// Entry point (ADR-001): fixed-timestep sim + keyboard + canvas render + DOM UI, behaving like
// prototype-v24.html. The sim advances in 1/60 s ticks; rendering reads state and interpolates position.
import { advance } from './core/accumulator.ts';
import { createState, step, TICK, type SimState } from './core/sim.ts';
import { KeyboardDevice } from './input/index.ts';
import { carStep, createCar, createSimParams, loadCarParams, type CarState, type DriftRecord } from './sim/index.ts';
import s15 from './cars/s15-drift.json';
import { buildLot } from './render/lot.ts';
import { drawScene } from './render/scene.ts';
import { drawTelemetry } from './render/telemetry.ts';
import { createView, recordTick, type View } from './render/view.ts';
import { analysisHtml, driftTableHtml } from './ui/drifts.ts';

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof type)) throw new Error(`index.html is missing #${id}`);
  return el;
}
function context2d(cv: HTMLCanvasElement): CanvasRenderingContext2D {
  const c = cv.getContext('2d');
  if (!c) throw new Error('2D canvas is not available');
  return c;
}

const cv = byId('cv', HTMLCanvasElement), tc = byId('tc', HTMLCanvasElement), sk = byId('sk', HTMLInputElement);
const skv = byId('skv', HTMLElement), pst = byId('pst', HTMLElement), msg = byId('msg', HTMLElement);
const dt = byId('dt', HTMLTableElement), an = byId('an', HTMLElement);
const c = context2d(cv), t2 = context2d(tc);
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

const carParams = loadCarParams(s15, 'src/cars/s15-drift.json');
const skill = () => Math.min(1, Math.max(0, Number(sk.value) || 0));
let params = createSimParams(carParams, skill());
const lot = buildLot((w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }), params.lot);
const seed = () => crypto.getRandomValues(new Uint32Array(1))[0]!;

let state: SimState<CarState>, prev: CarState, view: View, acc = 0, alpha = 0, paused = false;
let shownDrifts: readonly DriftRecord[] | null = null;

function renderDrifts(drifts: readonly DriftRecord[]): void {
  shownDrifts = drifts;
  dt.innerHTML = driftTableHtml(drifts);
  an.innerHTML = analysisHtml(drifts);
}

/** v24 reset(): new car and empty histories; the skill setting is kept. */
function reset(): void {
  state = createState(seed(), createCar(params));
  prev = state.car;
  view = createView(seed());
  acc = 0;
  alpha = 0;
  renderDrifts(state.car.drifts);
}

function togglePause(): void {
  paused = !paused;
  pst.textContent = paused ? 'Continuar (P)' : 'Pausar (P)';
}

const keyboard = new KeyboardDevice(cv, { onPause: togglePause });
const HINT_IDLE = 'Clique no pátio para focar';
cv.addEventListener('blur', () => (msg.textContent = HINT_IDLE));
cv.addEventListener('focus', () => (msg.textContent = 'W/S pedais · A/D direção · , reduz · . sobe · M auto · P pausa'));
cv.addEventListener('click', () => cv.focus());
// v24: the slider only changes the skill used from the next tick on; it does not reset the run.
sk.addEventListener('input', () => {
  const pctText = Math.round(skill() * 100) + '%';
  skv.textContent = pctText;
  sk.setAttribute('aria-valuetext', pctText);
  params = createSimParams(carParams, skill());
});
byId('ps', HTMLButtonElement).addEventListener('click', () => {
  togglePause();
  cv.focus();
});
byId('rs', HTMLButtonElement).addEventListener('click', () => {
  reset();
  cv.focus();
});

/** Render-only copy of the car with position and heading blended between the last two ticks. */
function blended(a: CarState, b: CarState, k: number): CarState {
  return { ...b, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, h: a.h + (b.h - a.h) * k };
}

reset();
let last = performance.now();
function loop(now: number): void {
  const frame = (now - last) / 1000;
  last = now;
  if (!paused) {
    const a = advance(acc, frame);
    acc = a.acc;
    alpha = a.alpha;
    for (let i = 0; i < a.ticks; i++) {
      prev = state.car;
      state = step(state, keyboard.sample(), params, carStep);
      recordTick(view, state.car, params, TICK);
    }
  }
  drawScene(c, { car: blended(prev, state.car, alpha), params, view, lot, paused, dt: Math.min(0.033, Math.max(0, frame)) });
  drawTelemetry(t2, view, state.car.tt, darkQuery.matches);
  if (state.car.drifts !== shownDrifts) renderDrifts(state.car.drifts);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
