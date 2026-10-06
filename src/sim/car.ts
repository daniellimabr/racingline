// The car step for src/core: one 1/60 s tick of v24, in v24's order (prototype lines 80-82, 137-151,
// 199-201): gear buttons, sim() with its sub-steps, clock, off-lot check, drift tracker.
// The v24 steering wobble was removed in S002-T10 with the skill setting.
import type { InputFrame } from '../core/input-frame.ts';
import type { CarStep } from '../core/sim.ts';
import type { Track } from '../data/track.ts';
import { trackDrift, DRIFT_BETA } from './drift.ts';
import { engine, manualShift } from './engine.ts';
import { allWheelsOff, createLapState, lapStep } from './laps.ts';
import { centreRate, phys, steerLockTime } from './physics.ts';
import { nextLeave, resetCar } from './reset.ts';
import type { SimParams } from './params.ts';
import type { CarState } from './state.ts';
import { lotSurface, trackSurface, type AxleSurface } from './surface.ts';

const MODE_SLIP = 0.13; // rad, axle slip angle that counts as sliding (v24 pk in sim())
const SPIN_BETA = 1.3; // rad

/** v24 sim(): pedals and steering travel, sub-stepped physics, engine, mode and traction risk. */
function sim(s: CarState, dt: number, k: InputFrame, p: SimParams, substeps: number, surf: AxleSurface): void {
  const c = p.car;
  // v24 keys are on/off: any pedal or steering value above zero counts as held.
  s.t = k.throttle > 0 ? Math.min(1, s.t + c.throttleRise * dt) : Math.max(0, s.t - c.throttleFall * dt);
  s.b = k.brake > 0 ? Math.min(1, s.b + c.brakeRise * dt) : Math.max(0, s.b - c.brakeFall * dt);
  // S004-T2: the steering stays where it is put (no self-centring); a key moves it at a speed-dependent rate.
  const sd = (k.right > 0 ? 1 : 0) - (k.left > 0 ? 1 : 0);
  if (sd) s.st = Math.max(-1, Math.min(1, s.st + (sd * dt) / steerLockTime(c, s.v)));
  // S005-T2: with no steering key pressed the wheel returns towards centre, pulled by the front tyres' self-aligning
  // torque (centreRate). It only acts while that torque points to centre (front slip opposite to the steering), never
  // moves the wheel past centre, and never acts while a key is held, so it cannot fight the driver or overshoot.
  const free = !(k.left > 0) && !(k.right > 0), h = dt / substeps;
  for (let i = 0; i < substeps; i++) {
    const fy = phys(s, h, p, surf);
    if (free && s.st !== 0 && s.af * s.st < 0) {
      const d = centreRate(c, fy, s.af) * h;
      s.st = s.st > 0 ? Math.max(0, s.st - d) : Math.min(0, s.st + d);
    }
  }
  engine(c, s, dt, surf.dragR);
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

function noLookup(tr: Track): never {
  throw new Error(`Track ${tr.id}: the run settings have no surface lookup (surfaceAt)`);
}

/** Pure: works on a copy of the car and returns it; car, input and params are never mutated. */
export const carStep: CarStep<CarState, SimParams> = (car, input, p, ctx) => {
  // R press (S004-T5): the tick only puts the car back at rest; nothing else runs on it.
  if (input.reset) return resetCar(car, p, ctx.dt);
  const s: CarState = { ...car }; // nested drift data is replaced, never edited (drift.ts)
  const c = p.car, dt = ctx.dt;
  // v24 key handlers run before the frame's step(); order up, down, automatic (recording order).
  if (input.shiftUp) manualShift(c, s, 1);
  if (input.shiftDown) manualShift(c, s, -1);
  if (input.toggleAuto) s.auto = !s.auto;
  const tr = p.track;
  // Surfaces are read once per tick from the position at its start, as v24 held `off` across sub-steps.
  sim(s, dt, input, p, ctx.substeps, tr ? trackSurface(tr, p.surfaceAt ?? noLookup(tr), c, s) : lotSurface(p.lot, s.off));
  s.tt += dt;
  // On a track, off means all four wheels off the road (the same test as the off-track rule; read by the
  // drift tracker and the HUD). Grip and drag never read it there: they come from the axle surfaces above.
  const L = p.lot, px = s.x * L.scale, py = s.y * L.scale;
  s.off = tr ? allWheelsOff(tr, s, c) : px < L.x0 || px > L.x1 || py < L.y0 || py > L.y1;
  trackDrift(s, dt);
  if (p.track) {
    s.lap = lapStep(car.lap ?? createLapState(p.track), car, s, p.track, c);
    s.leave = nextLeave(p.track, car.leave, s);
  }
  return s;
};
