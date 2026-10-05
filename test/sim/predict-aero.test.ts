// S002-AC-08: with aero, the projected racing line still shows where the car goes. The GT3 enters a
// fast corner with steering and throttle held; the line drawn at that moment is compared with the
// path the sim then drives over the same distance. The line uses the same aero helper as the sim,
// so at speed it bends with the downforce grip; a line without aero would point well wide.
import { describe, expect, it } from 'vitest';
import { createState, step, type SimState } from '../../src/core/sim.ts';
import { carStep, createCar, predict, type CarState, type SimParams } from '../../src/sim/index.ts';
import { gt3, idle, KMH, open } from './gt3-helpers.ts';

const TOL = 2.5; // m between line end and driven position after the line's length (~80 m)

/** Accelerates straight to `kmh`, then holds full steering and throttle for `holdTicks`. */
function corner(p: SimParams, kmh: number, holdTicks: number): SimState<CarState> {
  let s = createState(1, createCar(p));
  while (s.car.v < kmh * KMH) s = step(s, { ...idle, throttle: 1 }, p, carStep);
  for (let i = 0; i < holdTicks; i++) s = step(s, { ...idle, throttle: 1, right: 1 }, p, carStep);
  return s;
}

/** Drives on with the same held input until the car has covered `len` meters. */
function driveFor(s: SimState<CarState>, p: SimParams, len: number): [number, number] {
  let d = 0;
  while (d < len) {
    const n = step(s, { ...idle, throttle: 1, right: 1 }, p, carStep);
    d += Math.hypot(n.car.x - s.car.x, n.car.y - s.car.y);
    s = n;
  }
  return [s.car.x, s.car.y];
}

const len = (pts: [number, number][]) => pts.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - pts[i]![0], q[1] - pts[i]![1]), 0);

describe('racing line with aero (S002-AC-08)', () => {
  it.each([160, 200])('matches the driven path at %i km/h', (kmh) => {
    const p = open(gt3());
    const s = corner(p, kmh, 90);
    const line = predict(s.car, p);
    expect(line.slip).toBe(true); // full steering asks more than the grip: the aero grip cap draws the line
    const end = line.pts[line.pts.length - 1]!;
    const got = driveFor(s, p, len(line.pts));
    const noAero = predict(s.car, { ...p, car: { ...p.car, downforceArea: 0 } }).pts.at(-1)!;
    const err = Math.hypot(got[0] - end[0], got[1] - end[1]);
    const errNoAero = Math.hypot(got[0] - noAero[0], got[1] - noAero[1]);
    console.info(`${kmh} km/h: line end ${err.toFixed(2)} m from the driven path, ${errNoAero.toFixed(2)} m without aero`);
    expect(err).toBeLessThan(TOL);
    expect(err).toBeLessThan(errNoAero / 2);
  });
});
