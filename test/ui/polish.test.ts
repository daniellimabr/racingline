// S003-T11 blind-test polish: the page has an icon (no 404 for /favicon.ico in the console), and the HUD
// gear key hint names its keys instead of starting with a bare punctuation key.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createState } from '../../src/core/sim.ts';
import { createCar, createSimParams, loadCarParams } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import { buildLot, type CanvasFactory } from '../../src/render/lot.ts';
import { drawScene } from '../../src/render/scene.ts';
import { createView } from '../../src/render/view.ts';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

it('index.html declares an inline page icon, so the browser never asks for /favicon.ico', () => {
  const link = html.match(/<link[^>]*rel="icon"[^>]*>/)?.[0] ?? '';
  expect(link, '<link rel="icon">').not.toBe('');
  expect(link).toMatch(/href="data:image\/svg\+xml,[^"]+"/);
});

it('the gear key hint names its keys and never starts with a bare punctuation key', () => {
  const texts: string[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return () => ({ width: 40 });
      if (k === 'fillText') return (s: string) => void texts.push(String(s));
      return () => {};
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const params = createSimParams(loadCarParams(s15, 's15-drift.json'));
  const factory: CanvasFactory = (width, height) => ({ width, height, getContext: () => ctx });
  const lot = buildLot(factory, params.lot);
  texts.length = 0;
  const state = createState(3, createCar(params));
  drawScene(ctx, { car: state.car, params, view: createView(7), lot, paused: false, dt: 1 / 60, track: null, lap: null });
  const hint = texts.find((t) => t.includes('sobe'));
  expect(hint, 'gear key hint drawn at rest').toBeDefined();
  expect(hint).not.toMatch(/^[\s,.;:·]/);
  expect(hint).toMatch(/Vírgula reduz/);
  expect(hint).toMatch(/Ponto sobe/);
  expect(hint!.length).toBeLessThanOrEqual(50);
});
