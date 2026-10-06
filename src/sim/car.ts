// The car step for src/core: one 1/60 s tick of v24, in v24's order (prototype lines 80-82, 137-151,
// 199-201): gear buttons, sim() with its sub-steps, clock, off-lot check, drift tracker.
// The v24 steering wobble was removed in S002-T10 with the skill setting.
import type { InputFrame } from '../core/input-frame.ts';
import type { CarStep } from '../core/sim.ts';
import type { Track } from '../data/track.ts';
import { trackDrift, DRIFT_BETA, DRIFT_MIN_SPEED } from './drift.ts';
import { engine, manualShift } from './engine.ts';
import { allWheelsOff, createLapState, lapStep } from './laps.ts';
import { centreRate, dLim, phys, steerLockTime } from './physics.ts';
import { resetCar, trackLeave } from './reset.ts';
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
  // Main Dev: it is also capped at steerReturnMaxShare (1: never faster than the key) of the key rate at the current speed, so it is never a snap.
  const free = !(k.left > 0) && !(k.right > 0), h = dt / substeps;
  // S005-T10 (Main Dev option 1B): the catch hold read by steer(). A key pressed against a slide (rear and body slip on
  // the key's side, past the countersteer onset) arms it (+-1). Released, or with the other key unwinding it, it stays
  // (+-2) while the wheel is still on that side, so letting go never brings the full lock back. The same key pressed
  // again ends it, so a release and a new press steer freely, which keeps side-to-side drifts possible. Absent when not
  // holding, so runs without a catch hash as before.
  let hold = s.hold ?? 0;
  const hk = Math.sign(hold);
  if (hold && Math.sign(s.st) !== hk && !(Math.abs(hold) === 1 && sd === hk)) hold = 0; // the wheel is back at centre
  else if (hold && sd !== hk) hold = 2 * hk; // released, or the other key unwinding it
  else if (Math.abs(hold) === 2) hold = 0; // the same key pressed again
  if (!hold && sd && Math.sign(s.ar) === sd && Math.sign(s.beta) === sd && Math.abs(s.beta) > c.counterBetaOnset) hold = sd;
  if (hold) s.hold = hold;
  else delete s.hold;
  // S005-T10 (Main Dev option 2A): the steering geometry (caster and kingpin lift the car as the wheels turn) pulls a
  // free wheel back even when slow. It ramps in from steerReturnRampFrom to steerReturnMinSpeed (so there is no step),
  // fades with speed as the speed-limited lock narrows (dLim / maxSteer), and shrinks near centre like the tyre limit.
  const ramp = Math.min(1, Math.max(0, (s.v - c.steerReturnRampFrom) / (c.steerReturnMinSpeed - c.steerReturnRampFrom)));
  for (let i = 0; i < substeps; i++) {
    const fy = phys(s, h, p, surf);
    // S005-T3 (Main Dev option 1B): while the car slides, the released wheel goes to centre at steerSlideShare of the key
    // rate whatever the front slip, so a caught slide does not leave countersteer on that swings it into the other spin.
    // S005-T8 (M5): the slip is read at the rear axle, not the body: in a tight slow turn the body slip is geometry (the
    // rear axle rolls straight, so the centre of mass points inwards) and is no slide. Below DRIFT_MIN_SPEED it never
    // counts (as for drifts), which also skips the rear slip left by the switch from the low-speed branch near 11 km/h.
    const slide = s.v > DRIFT_MIN_SPEED && Math.abs(s.ar) > Math.min(c.steerSlideBeta, c.tirePeakSlip);
    // S005-T8: the tyre pulls to centre while its side force points that way (fy has the steering's sign; in the slip
    // branch that is the front slip opposite the steering). The key-rate limit shrinks near centre (steerReturnSoftSteer,
    // so taps add up at speed), and a minimum return clears the slow tail (steerReturnMin; ramped in since S005-T10).
    const pull = fy * s.st > 0, minR = c.steerReturnMin * ramp;
    if (free && s.st !== 0 && ((slide && c.steerSlideShare > 0) || pull || ramp > 0)) {
      const soft = c.steerReturnSoftSteer > 0 ? Math.min(1, Math.abs(s.st) / c.steerReturnSoftSteer) : 1;
      const tyre = pull ? Math.min(centreRate(c, fy, s.af), (c.steerReturnMaxShare * soft) / steerLockTime(c, s.v)) : 0;
      const geo = ((c.steerGeometryGain * dLim(c, s.v)) / c.maxSteer) * ramp * soft;
      const d = Math.max(tyre, geo, minR, slide ? c.steerSlideShare / steerLockTime(c, s.v) : 0) * h;
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
    trackLeave(p.track, car, s, dt);
  }
  return s;
};
