// S002-AC-13: with either car active, the HUD shows that car's name, and the tacho red zone, gear count
// and rpm scale come from its data, never from S15 constants. Also checks the GT3 is drawn differently.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createState } from '../../src/core/sim.ts';
import { createCar, createSimParams, loadCarParams, type CarParams } from '../../src/sim/index.ts';
import s15json from '../../src/cars/s15-drift.json';
import gt3json from '../../src/cars/gt3.json';
import { buildLot, type CanvasFactory } from '../../src/render/lot.ts';
import { carLook, drawScene } from '../../src/render/scene.ts';
import { createView } from '../../src/render/view.ts';
import { carHud, gearText, rpmLegend } from '../../src/ui/hud-car.ts';

const s15 = loadCarParams(s15json, 's15-drift.json');
const gt3 = loadCarParams(gt3json, 'gt3.json');
const CARS: [string, CarParams][] = [['s15-drift', s15], ['gt3', gt3]];

/** Canvas stand-in that records every method call with its arguments. */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: [string, unknown[]][] } {
  const calls: [string, unknown[]][] = [];
  const props: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(props, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return () => ({ width: 40 });
      return (...args: unknown[]) => void calls.push([String(k), args]);
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function drawOnce(car: CarParams): [string, unknown[]][] {
  const params = createSimParams(car, 0.4);
  const { ctx, calls } = recordingContext();
  const factory: CanvasFactory = (width, height) => ({ width, height, getContext: () => ctx });
  const lot = buildLot(factory, params.lot);
  const state = createState(1, createCar(params));
  calls.length = 0;
  drawScene(ctx, { car: state.car, params, view: createView(1), lot, paused: false, dt: 1 / 60 });
  return calls;
}

describe.each(CARS)('HUD for %s', (id, car) => {
  it('takes name, red zone, rev cut and gear count from the car data', () => {
    const hud = carHud(car);
    expect(hud.name).toBe(car.name);
    expect(hud.label).toBe('Carro: ' + car.name);
    expect(hud.redlineRpm).toBe(car.redlineRpm);
    expect(hud.cutRpm).toBe(car.cutRpm);
    expect(hud.gearCount).toBe(car.gears.length);
    expect(hud.rpmScale).toBeGreaterThanOrEqual(car.cutRpm);
    expect(rpmLegend(car)).toBe(`RPM (0–${hud.rpmScale})`);
  });

  it('draws the car name and the gear out of the car gear count on the canvas HUD', () => {
    const texts = drawOnce(car).filter(([k]) => k === 'fillText').map(([, a]) => String(a[0]));
    expect(texts).toContain(car.name);
    expect(texts.some((t) => t.startsWith(gearText(0, car.gears.length)))).toBe(true);
    expect(gearText(0, car.gears.length)).toBe(`1ª/${car.gears.length}`);
  });

  it('starts the tacho red zone at the car redline', () => {
    const calls = drawOnce(car);
    const tach = calls.filter(([k, a]) => k === 'arc' && a[2] === 48).map(([, a]) => a as number[]);
    const h = createCar(createSimParams(car, 0.4)).h;
    const fr = (car.redlineRpm - car.idleRpm) / (car.cutRpm - car.idleRpm);
    expect(tach[1]![3]).toBeCloseTo(h - 1.05 + 2.1 * fr, 9);
    expect(id).toBeTruthy();
  });
});

it('gives the S15 an 8000 rpm chart scale and the GT3 a higher one that covers its 8500 rpm cut', () => {
  expect(carHud(s15).rpmScale).toBe(8000);
  expect(carHud(gt3).rpmScale).toBe(9000);
});

it('draws the GT3 with its own color, body length from its wheelbase and a rear wing for its downforce', () => {
  const a = carLook(s15, 9), b = carLook(gt3, 9);
  expect(b.color).not.toBe(a.color);
  expect(a.length).toBeCloseTo((s15.wheelbase + 2 * 0.96) * 9, 9);
  expect(b.length).toBeGreaterThan(a.length);
  expect(b.halfWidth).toBeGreaterThan(a.halfWidth);
  expect(a.halfWidth).toBeCloseTo(7.6, 9); // the S15 keeps its current look
  expect(a.wing).toBe(false);
  expect(b.wing).toBe(true);
});

it('has no hard-coded S15 rpm numbers left in the render and UI code', () => {
  for (const dir of ['src/render', 'src/ui']) {
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, `${dir}/${f}`).not.toMatch(/\b(5500|7000|7100|7500|7600|8000)\b/);
    }
  }
});
