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
  const kr = dt / steerLockTime(c, s.v), follow = (c.steerCatchFollow * dt) / steerLockTime(c, s.v);
  if (sd && sd * s.st < 0 && slideReturn(s, c)) {
    // S005-T14 (M2): a key against a wheel that the slide return would bring back takes it to centre at least as fast
    // as letting go would (the slide return), then on past centre at the key rate for the rest of the tick.
    const fr = kr * Math.max(1, c.steerSlideShare);
    s.st = Math.abs(s.st) > fr ? s.st + sd * fr : sd * Math.min(1, kr * (1 - Math.abs(s.st) / fr));
  } else if (sd) {
    // S005-T14 (M1): while a catch is open, its key puts the countersteer on at least as fast as the free wheel follows.
    const r = catchOpen(s, c) === sd && sd * s.st >= 0 ? Math.max(kr, follow) : kr;
    s.st = Math.max(-1, Math.min(1, s.st + sd * r));
  }
  // S005-T2: with no steering key pressed the wheel returns towards centre, pulled by the front tyres' self-aligning
  // torque (centreRate). It only acts while that torque points to centre (front slip opposite to the steering), never
  // moves the wheel past centre, and never acts while a key is held, so it cannot fight the driver or overshoot.
  // Main Dev: it is also capped at steerReturnMaxShare (1: never faster than the key) of the key rate at the current speed, so it is never a snap.
  const free = !(k.left > 0) && !(k.right > 0), h = dt / substeps;
  // S005-T10 (Main Dev option 1B) and S005-T12 (blind test round 3): the catch hold read by steer(). A key pressed
  // against an open slide (rear and body slip on the key's side, past the countersteer onset) arms it on that side
  // (hold +-1, catching). It ends on the car's own motion, never on key presses: once the slide on that side is closed
  // and the car no longer rotates back towards it faster than steerCatchSettleYaw, it is releasing (+-2) and the cap
  // opens (holdOpen 0 -> 1) at the key rate while a key on that side is held, so a held key steers again like any held
  // key; it ends when fully open or when the wheel is back at centre. A slide reopening on that side makes it catch again
  // (the cap closes at the key rate). Absent when not holding, so runs without a catch hash as before.
  let hk = Math.sign(s.hold ?? 0), phase = Math.abs(s.hold ?? 0), open = s.holdOpen ?? 0, keyAgo = s.holdKey ?? 0;
  if (sd && sd !== hk && Math.sign(s.ar) === sd && Math.sign(s.beta) === sd && Math.abs(s.beta) > c.counterBetaOnset) {
    hk = sd; phase = 1; open = 0;
  }
  if (hk) {
    const slideOpen = hk * s.beta > c.counterBetaOnset;
    if (phase === 1 && !slideOpen && hk * s.r <= c.steerCatchSettleYaw) phase = 2;
    else if (phase === 2 && slideOpen) phase = 1;
    if (phase === 2 && sd === hk) open = Math.min(1, open + kr);
    else open = Math.max(0, open - kr); // catching, or that key let go: the cap closes again at the key rate
    if (phase === 2 && (open >= 1 || Math.sign(s.st) !== hk)) hk = 0;
    keyAgo = sd === hk ? 0 : keyAgo + dt; // S005-T16: time since that side's key was last down (steerCatchWindow)
  }
  if (hk) { s.hold = hk * phase; s.holdOpen = open; s.holdKey = keyAgo; }
  else { delete s.hold; delete s.holdOpen; delete s.holdKey; }
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
    // S005-T14 (M1): not for countersteer an open catch keeps in check: that follows the slide instead (steerCatchFollow,
    // like a free wheel pulled by its caster), or with steerCatchFollow 0 returns at the normal rate, so taps add up.
    // S005-T16 (round 5 M1): it only follows while that key was down within steerCatchWindow, so steady taps keep it
    // following but one short touch does not catch by itself; after that the released wheel returns as normal.
    const slide = slideReturn(s, c), hs = catchOpen(s, c);
    const recent = (s.holdKey ?? Infinity) <= c.steerCatchWindow + 1e-9; // 1e-9: tick times summed in floating point
    // S005-T8: the tyre pulls to centre while its side force points that way (fy has the steering's sign; in the slip
    // branch that is the front slip opposite the steering). The key-rate limit shrinks near centre (steerReturnSoftSteer,
    // so taps add up at speed), and a minimum return clears the slow tail (steerReturnMin; ramped in since S005-T10).
    const pull = fy * s.st > 0, minR = c.steerReturnMin * ramp;
    if (free && hs && recent && c.steerCatchFollow > 0 && (s.st === 0 || Math.sign(s.st) === hs)) {
      s.st = hs * Math.min(1, Math.abs(s.st) + follow / substeps);
    } else if (free && s.st !== 0 && (slide || pull || ramp > 0)) {
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

/** S005-T14: the side (+-1) of a catch hold still catching an open slide on that side, else 0. */
function catchOpen(s: CarState, c: SimParams['car']): number {
  const hk = Math.sign(s.hold ?? 0);
  return hk && Math.abs(s.hold!) === 1 && hk * s.beta > c.counterBetaOnset ? hk : 0;
}

/**
 * The slide return applies (S005-T3, T8): the car slides at the rear axle above drift speed, and (S005-T14) the wheel is
 * not countersteer that a catch hold still catching on its side keeps in check.
 */
function slideReturn(s: CarState, c: SimParams['car']): boolean {
  const slide = s.v > DRIFT_MIN_SPEED && Math.abs(s.ar) > Math.min(c.steerSlideBeta, c.tirePeakSlip);
  const held = Math.abs(s.hold ?? 0) === 1 && s.st !== 0 && Math.sign(s.st) === Math.sign(s.hold!);
  return slide && c.steerSlideShare > 0 && !held;
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
