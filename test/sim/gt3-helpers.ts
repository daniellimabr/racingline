// Shared setup for the GT3 aero tests: the real car files and an open lot, so long runs never leave
// the pavement (off-lot grip and drag would hide the aero effect).
import type { InputFrame } from '../../src/core/input-frame.ts';
import { createSimParams, loadCarParams, TEST_LOT, type CarParams, type Lot, type SimParams } from '../../src/sim/index.ts';
import gt3Json from '../../src/cars/gt3.json';
import s15Json from '../../src/cars/s15-drift.json';

export const gt3 = (): CarParams => loadCarParams(gt3Json, 'gt3.json');
export const s15 = (): CarParams => loadCarParams(s15Json, 's15-drift.json');

/** TEST_LOT with bounds far away; the car starts in the middle. */
export const OPEN_LOT: Lot = Object.freeze({ ...TEST_LOT, x0: -1e7, y0: -1e7, x1: 1e7, y1: 1e7, startX: 0, startY: 0 });
export const open = (car: CarParams, skill = 0.4): SimParams => createSimParams(car, skill, OPEN_LOT);

export const KMH = 1 / 3.6;
export const idle: InputFrame = { throttle: 0, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false };
