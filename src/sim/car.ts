// The car step for src/core: one 1/60 s tick of v24, in v24's order (prototype lines 80-82, 137-151,
// 199-201): gear buttons, sim() with its sub-steps, clock, off-lot check, drift tracker.
// The v24 steering wobble was removed in S002-T10 with the skill setting.
import type { InputFrame } from '../core/input-frame.ts';
import type { CarStep } from '../core/sim.ts';
import { trackDrift, DRIFT_BETA } from './drift.ts';
import { engine, manualShift } from './engine.ts';
import { allWheelsOff, createLapState, lapStep } from './laps.ts';
import { phys } from './physics.ts';
import type { SimParams } from './params.ts';
import type { CarState } from './state.ts';

const MODE_SLIP = 0.13; // rad, axle slip angle that counts as sliding (v24 pk in sim())
const SPIN_BETA = 1.3; // rad

/** v24 sim(): pedals and steering travel, sub-stepped physics, engine, mode and traction risk. */
function sim(s: CarState, dt: number, k: InputFrame, p: SimParams, substeps: number): void {
  const c = p.car;
  // v24 keys are on/off: any pedal or steering value above zero counts as held.
  s.t = k.throttle > 0 ? Math.min(1, s.t + c.throttleRise * dt) : Math.max(0, s.t - c.throttleFall * dt);
  s.b = k.brake > 0 ? Math.min(1, s.b + c.brakeRise * dt) : Math.max(0, s.b - c.brakeFall * dt);
  const sd = (k.right > 0 ? 1 : 0) - (k.left > 0 ? 1 : 0);
  if (sd) {
    const fast = Math.sign(s.st) === -sd || (Math.abs(s.beta) > c.steerFastBeta && sd === Math.sign(s.beta));
    s.st += sd * (fast ? c.steerFastRate : c.steerRate) * dt;
    s.st = Math.max(-1, Math.min(1, s.st));
  } else s.st -= Math.sign(s.st) * Math.min(Math.abs(s.st), c.steerReturnRate * dt);
  for (let i = 0; i < substeps; i++) phys(s, dt / substeps, p);
  engine(c, s, dt);
  const ab = Math.abs(s.beta);
  s.mode =
    ab > SPIN_BETA ? 'spin'
    : ab > DRIFT_BETA ? 'drift'
    : (Math.abs(s.ar) > MODE_SLIP && Math.abs(s.ar) >= Math.abs(s.af)) || (s.wspin && ab > 0.05) ? 'rear'
    : Math.abs(s.af) > MODE_SLIP ? 'front'
    : '';
  if (dt > 0) {
    // Smoothed grip use, its rate, and the predicted risk the traction halo shows.
    const a = Math.min(1, dt * 10);
    s.uFs += (Math.min(2, s.useF) - s.uFs) * a;
    s.uRs += (Math.min(2, s.useR) - s.uRs) * a;
    const k2 = Math.min(1, dt * 6);
    s.dFs += ((s.uFs - s.pF0) / dt - s.dFs) * k2;
    s.dRs += ((s.uRs - s.pR0) / dt - s.dRs) * k2;
    const growB = (Math.abs(s.beta) - s.b0) / dt;
    s.dB += (growB - s.dB) * k2;
    s.b0 = Math.abs(s.beta);
    s.pF0 = s.uFs;
    s.pR0 = s.uRs;
    const tgtR =
      s.uRs +
      Math.max(0, s.dRs) * 0.35 +
      (Math.abs(s.beta) > 0.05 ? Math.max(0, s.dB) * 0.6 : 0) +
      (Math.abs(s.beta) > 0.9 ? (Math.abs(s.beta) - 0.9) * 0.8 : 0);
    const tgtF = s.uFs + Math.max(0, s.dFs) * 0.35;
    const kr = Math.min(1, dt * 8);
    s.riskR += (tgtR - s.riskR) * kr;
    s.riskF += (tgtF - s.riskF) * kr;
  }
}

/** Pure: works on a copy of the car and returns it; car, input and params are never mutated. */
export const carStep: CarStep<CarState, SimParams> = (car, input, p, ctx) => {
  const s: CarState = { ...car }; // nested drift data is replaced, never edited (drift.ts)
  const c = p.car, dt = ctx.dt;
  // v24 key handlers run before the frame's step(); order up, down, automatic (recording order).
  if (input.shiftUp) manualShift(c, s, 1);
  if (input.shiftDown) manualShift(c, s, -1);
  if (input.toggleAuto) s.auto = !s.auto;
  sim(s, dt, input, p, ctx.substeps);
  s.tt += dt;
  const L = p.lot, px = s.x * L.scale, py = s.y * L.scale;
  // On a track, off means all four wheels off the road (the off-track rule) until T6 reads surfaces per axle.
  s.off = p.track ? allWheelsOff(p.track, s, c) : px < L.x0 || px > L.x1 || py < L.y0 || py > L.y1;
  trackDrift(s, dt);
  if (p.track) s.lap = lapStep(car.lap ?? createLapState(p.track), car, s, p.track, c);
  return s;
};
