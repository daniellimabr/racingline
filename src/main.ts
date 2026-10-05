// Entry point (ADR-001): fixed-timestep sim + keyboard + canvas render + DOM UI, behaving like
// prototype-v24.html. The sim advances in 1/60 s ticks; rendering reads state and interpolates position.
import { advance } from './core/accumulator.ts';
import { createCarRegistry, switchCar } from './core/car-registry.ts';
import { step, TICK, type SimState } from './core/sim.ts';
import { KeyboardDevice } from './input/index.ts';
import { carStep, createSimParams, lapProgress, loadCarParams, type CarState, type DriftRecord } from './sim/index.ts';
import { buildLot, type LotArt } from './render/lot.ts';
import { drawScene } from './render/scene.ts';
import { drawTelemetry } from './render/telemetry.ts';
import { createView, recordTick, type View } from './render/view.ts';
import { analysisHtml, driftTableHtml } from './ui/drifts.ts';
import { carHud, rpmLegend } from './ui/hud-car.ts';
import { buildTrackArt, type TrackArt } from './render/track.ts';
import { bindTrackChooser } from './ui/track-chooser.ts';
import { LOT_TRACK_ID, startRun, TRACK_CHOICES } from './run.ts';

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

const cv = byId('cv', HTMLCanvasElement), tc = byId('tc', HTMLCanvasElement);
const pst = byId('pst', HTMLElement), msg = byId('msg', HTMLElement);
const dt = byId('dt', HTMLTableElement), an = byId('an', HTMLElement);
const carEl = byId('car', HTMLElement), rpml = byId('rpml', HTMLElement);
const c = context2d(cv), t2 = context2d(tc);
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

// Every car file in src/cars is selectable (S002-T6); a new file such as gt3.json joins the C-key cycle.
const carFiles = import.meta.glob<unknown>('./cars/*.json', { eager: true, import: 'default' });
const cars = createCarRegistry(Object.entries(carFiles).map(([file, json]) => loadCarParams(json, file)));
let carId = cars.has('s15-drift') ? 's15-drift' : cars.list[0]!.id;
let params = createSimParams(cars.get(carId));
const makeCanvas = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h });
let lot: LotArt = buildLot(makeCanvas, params.lot);
const seed = () => crypto.getRandomValues(new Uint32Array(1))[0]!;

let trackId = LOT_TRACK_ID, art: TrackArt | null = null;
const arts = new Map<string, TrackArt>(); // track drawing data, built once per track
const LOT_LABEL = cv.getAttribute('aria-label') ?? '';

let state: SimState<CarState>, prev: CarState, view: View, acc = 0, alpha = 0, paused = false;
let shownDrifts: readonly DriftRecord[] | null = null;

function renderDrifts(drifts: readonly DriftRecord[]): void {
  shownDrifts = drifts;
  dt.innerHTML = driftTableHtml(drifts);
  an.innerHTML = analysisHtml(drifts);
}

/** v24 reset(): new car and empty histories; the chosen car and track are kept. */
function reset(): void {
  ({ state, params } = startRun({ seed: seed(), car: carId, track: trackId }, cars));
  const track = params.track;
  art = track ? arts.get(track.id) ?? arts.set(track.id, buildTrackArt(track, params.lot.scale)).get(track.id)! : null;
  cv.setAttribute('aria-label', track
    ? `Pista ${track.name} com o carro, a linha de trajetória projetada, os tempos de volta e o painel de instrumentos. Dados do mapa: ${track.credit}. Clique ou use Tab para focar e dirija com W, A, S, D.`
    : LOT_LABEL);
  // The lot art must match the run's lot settings, whichever car started the run.
  if (params.lot !== lot.lot) lot = buildLot(makeCanvas, params.lot);
  carEl.textContent = carHud(params.car).label;
  rpml.textContent = rpmLegend(params.car);
  prev = state.car;
  view = createView(seed());
  acc = 0;
  alpha = 0;
  keyboard.clearPresses();
  renderDrifts(state.car.drifts);
}

// Gear presses made while paused are dropped, so they cannot pile up and fire after resume.
function togglePause(): void {
  paused = !paused;
  keyboard.clearPresses();
  pst.textContent = paused ? 'Continuar (P)' : 'Pausar (P)';
}

/** C key: restart the run with the next car; ignored while paused. */
function nextCar(): void {
  const next = switchCar(cars, carId, paused);
  if (next === null) return;
  carId = next;
  reset();
}

const keyboard = new KeyboardDevice(cv, { onPause: togglePause, onCarSwitch: nextCar });
const HINT_IDLE = 'Clique no jogo ou use Tab para focar';
cv.addEventListener('blur', () => (msg.textContent = HINT_IDLE));
cv.addEventListener('focus', () => (msg.textContent = 'W/S pedais · A/D direção · , reduz · . sobe · M auto · C carro · P pausa'));
cv.addEventListener('click', () => cv.focus());
byId('ps', HTMLButtonElement).addEventListener('click', () => {
  togglePause();
  cv.focus();
});
byId('rs', HTMLButtonElement).addEventListener('click', () => {
  reset();
  cv.focus();
});
bindTrackChooser(byId('tk', HTMLButtonElement), TRACK_CHOICES, trackId, (id) => {
  trackId = id;
  reset();
  cv.focus();
});

/** Render-only copy of the car with position and heading blended between the last two ticks. */
function blended(a: CarState, b: CarState, k: number): CarState {
  return { ...b, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, h: a.h + (b.h - a.h) * k };
}

reset();
let last = performance.now();
// A hidden tab gets no frames; restart the clock on return so the sim does not catch up in one jump.
document.addEventListener('visibilitychange', () => (last = performance.now()));
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
  drawScene(c, {
    car: blended(prev, state.car, alpha), params, view, lot, paused, dt: Math.min(0.033, Math.max(0, frame)),
    track: art, lap: lapProgress(state.car),
  });
  drawTelemetry(t2, view, state.car.tt, darkQuery.matches, carHud(params.car).rpmScale);
  if (state.car.drifts !== shownDrifts) renderDrifts(state.car.drifts);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
