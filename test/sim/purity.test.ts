// S001-AC-07: src/sim is pure: no DOM, Math.random, Date, performance or globals, and the car step
// never mutates its inputs (frozen inputs would throw in strict-mode modules).
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createState, step } from '../../src/core/sim.ts';
import { carStep, createCar, createSimParams, loadCarParams, predict, tractionState } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import { deepFreeze } from '../core/helpers.ts';

const dir = new URL('../../src/sim/', import.meta.url);
const FORBIDDEN =
  /\bMath\.random\b|\bDate\b|\bperformance\b|\bwindow\b|\bdocument\b|\bglobalThis\b|\bnavigator\b|\blocalStorage\b|\brequestAnimationFrame\b|\bsetTimeout\b|\bsetInterval\b/;

it('no file in src/sim uses the DOM, Math.random, Date, performance or globals', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    const code = readFileSync(new URL(f, dir), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code, f).not.toMatch(FORBIDDEN);
  }
});

it('the car step, predict and traction state leave frozen inputs untouched', () => {
  const params = deepFreeze(createSimParams(loadCarParams(s15, 's15-drift.json'), 0.4));
  let state = createState(9, createCar(params));
  const drive = { throttle: 1, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false };
  for (let i = 0; i < 400; i++) {
    const frame = deepFreeze({ ...drive, right: i > 150 && i < 200 ? 1 : 0, left: i > 200 && i < 260 ? 1 : 0, shiftUp: i === 10 });
    deepFreeze(state);
    const before = JSON.stringify(state);
    state = step(state, frame, params, carStep);
    predict(state.car, params);
    tractionState(state.car);
    expect(JSON.stringify(deepFreeze(state))).not.toBe(before);
  }
});
