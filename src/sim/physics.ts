// v24 phys() and its helpers (prototype lines 92-128): bicycle model with a friction circle per
// axle, load transfer, rear combined slip, drag and engine braking. Same math and operation order
// as v24 so traces match exactly; `s` is the car step's private working copy and is mutated in place.
import type { CarParams, SimParams } from './params.ts';
import type { CarState } from './state.ts';
import type { AxleSurface } from './surface.ts';

export const G = 9.81; // m/s2 (v24 g)

/** Steering curve: key travel -1..1 to share of lock (v24 shape). */
export const shape = (c: CarParams, st: number): number => c.steerLinear * st + c.steerQuad * st * Math.abs(st);
/** Speed-limited lock, rad (v24 dLim). */
export const dLim = (c: CarParams, v: number): number => Math.max(c.steerMin, c.maxSteer / (1 + v / c.steerSpeedRef));
/**
 * Seconds for the steering to travel from centre to full lock at speed v (m/s), from car data
 * (S004-T2): low + (top - low) * (|v| / topSpeed) ^ curve. Very quick when slow, slow at high speed.
 * The speed size is used (reverse steers like forward) and is capped at the top speed, so the base stays in
 * 0..1 and the time stays between the low and top values for any curve the car file allows (never NaN).
 */
export const steerLockTime = (c: CarParams, v: number): number =>
  c.steerLockTime + (c.steerLockTimeTop - c.steerLockTime) * Math.min(1, Math.abs(v) / c.steerLockTopSpeed) ** c.steerLockCurve;
/** Normalized tire force for a slip angle (v24 tire). */
export const tire = (c: CarParams, a: number): number => Math.sin(c.tireC * Math.atan(c.tireB * a));
/** Engine torque, N m (v24 torqueAt). */
export const torqueAt = (c: CarParams, r: number): number =>
  c.peakTorque * Math.max(c.torqueFloor, 1 - ((r - c.torquePeakRpm) / c.torqueWidthRpm) ** 2);
/** Aero accelerations (m/s2, per unit mass) at speed v: downforce on each axle and drag (ADR-004). */
export interface Aero {
  front: number;
  rear: number;
  drag: number;
}

/** F = 0.5 * airDensity * area * v^2, divided by mass. Exactly 0 for a car without aero areas. */
export function aero(c: CarParams, v: number): Aero {
  const q = (0.5 * c.airDensity * v * v) / c.mass;
  const down = q * c.downforceArea;
  return { front: down * c.aeroBalanceFront, rear: down * (1 - c.aeroBalanceFront), drag: q * c.dragArea };
}

/** Total ratio of a gear index 0..5 (v24 ratio). */
export const ratio = (c: CarParams, gr: number): number => c.gears[gr]! * c.finalDrive;

/** Road-wheel angle from the steering input, with countersteer lock while sliding (v24 steer). */
export function steer(c: CarParams, s: CarState, spd: number): number {
  const sh = shape(c, s.st);
  let d = sh * dLim(c, spd);
  if (Math.abs(s.beta) > c.counterBetaOnset && Math.sign(s.st) === Math.sign(s.beta)) {
    const w = Math.min(1, Math.abs(s.beta) / c.counterBetaFull);
    // S005-T8 (Main Dev option 2B): the extra countersteer lock goes at most as far as pointing the front wheels along
    // the direction of travel (wheel angle = body slip); more only throws the car into the opposite slide when held on.
    const lock = Math.min(Math.abs(sh) * c.maxSteer, Math.abs(s.beta));
    d = Math.sign(s.st) * ((1 - w) * Math.abs(d) + w * Math.max(Math.abs(d), lock));
  }
  // S005-T10 (Main Dev option 1B, catch hold): while the key that caught a slide stays held, and after its release until
  // the wheel is back at centre (s.hold, car.ts), the front wheels point at most along the direction of travel, less the
  // part from the car already rotating back towards the steering (front lever x yaw rate / speed). Once the slide has
  // closed that is straight ahead, so a countersteer held on can no longer throw the car into the opposite spin.
  // S005-T12: once the car has settled the cap opens (holdOpen) at the key rate while that key is held.
  if (s.hold && c.steerCatchHold > 0 && s.st !== 0 && Math.sign(s.st) === Math.sign(s.hold)) {
    const k = Math.sign(s.st), back = (Math.max(0, k * s.r) * c.la) / Math.max(spd, 1);
    const cap = Math.max(0, k * s.beta - back);
    d = k * (Math.abs(d) - c.steerCatchHold * (1 - (s.holdOpen ?? 0)) * Math.max(0, Math.abs(d) - cap));
  }
  return d;
}

/**
 * Speed (share of full steering travel per second) at which the released wheel turns back towards centre
 * (S005-T2): the front tyres' self-aligning torque (side force x trail) against the steering's damping. A damped
 * steering with negligible inertia turns at torque / damping, a first-order move that cannot oscillate. fyf is the
 * front side force (m/s2 per unit mass, any sign), af the front slip angle (rad). The trail is the caster part plus
 * the tyre's own trail, which falls to zero at steerTrailFade x tirePeakSlip, so a sliding front pulls less.
 * Speed enters through the side force: the same steering asks for more of it as speed rises (and with downforce).
 */
export function centreRate(c: CarParams, fyf: number, af: number): number {
  const tyre = Math.max(0, 1 - Math.abs(af) / (c.steerTrailFade * c.tirePeakSlip));
  return (c.steerCentreGain * Math.abs(fyf) * (c.steerCasterShare + (1 - c.steerCasterShare) * tyre)) / G;
}

/**
 * One physics sub-step (v24 phys) on the given surface under each axle (surface.ts). Returns the front axle side
 * force in m/s2 per unit mass (0 in the low-speed branch, where there are no slip angles), for the steering return.
 */
export function phys(s: CarState, dt: number, p: SimParams, surf: AxleSurface): number {
  const c = p.car, L = c.wheelbase, LA = c.la, LB = c.lb;
  // On the lot both factors are v24's `s.off ? offGrip : 1`, so the lot stays bit-identical.
  const muF = c.grip * surf.gripF, muR = c.grip * surf.gripR, spd = Math.hypot(s.vx, s.vy);
  // v24 evaluates this expression twice (Aav and Afull); once is the same double.
  const Afull = (torqueAt(c, s.rpm) * ratio(c, s.gear) * c.drivelineEff) / c.wheelRadius / c.mass;
  const Aav = s.cut || s.shiftT > 0 ? 0 : Afull;
  const A = s.t * Aav, D = s.b * c.brakeDecel;
  const Wf = Math.max(c.frontWeightMin, Math.min(c.frontWeightMax, c.staticFrontWeight - (c.cgHeightRatio * s.axp) / G));
  // Aero terms are added, never folded in: with zero aero `x + 0` is exact, so the S15 stays bit-identical.
  const ae = aero(c, spd);
  // S004-T3 tyre load sensitivity: grip per unit of load falls as an axle gains load, mu(W) = mu * (1 - ls * (W / W0 - 1)),
  // so weight transfer swings the cornering balance less. It applies to each axle's friction circle (front grip, rear
  // cornering and rear brake); the rear drive force keeps the plain load (Gr), so traction is unchanged, as the S003
  // rear margin did. At the static share the term is exactly 0, and loadSensitivity 0 is bit-identical.
  const Wr = 1 - Wf, W0f = c.staticFrontWeight, W0r = 1 - W0f, ls = c.loadSensitivity;
  const WfG = Wf - (ls * Wf * (Wf - W0f)) / W0f, WrG = Wr - (ls * Wr * (Wr - W0r)) / W0r;
  const Gf = muF * G * WfG + muF * ae.front, Gr = muR * G * Wr + muR * ae.rear, GrC = muR * G * WrG + muR * ae.rear;
  const u = A / Gr;
  s.u = u;
  s.lim = Math.min(1, Gr / Math.max(0.01, Afull));
  s.wspin = u > 1;
  s.spinR = Math.max(0, u - 1);
  const Fdrive = (Gr * u) / Math.pow(1 + u ** 4, 0.25);
  const latF = 1 / Math.pow(1 + (Math.max(0, u - c.spinLatOnset) * c.spinLatGain) ** 4, 0.25);
  const dir = s.vx >= 0 ? 1 : -1, mv = spd > 0.3;
  s.lockF = mv && c.brakeFront * D > Gf * c.brakeLockMargin;
  const fL = mv ? Math.min(c.brakeFront * D, Gf * c.brakeLockMargin) : 0;
  // S003: the rear brake is capped below the rear grip so cornering grip is left when weight moves forward.
  const rB = mv ? Math.min(c.brakeRear * D, GrC * c.rearBrakeMaxShare) : 0;
  const Fxr = Fdrive - dir * rB, Fxf = -dir * fL;
  const FfMax = Math.sqrt(Math.max(0, Gf * Gf - fL * fL)), GrL = GrC * latF * c.rearCornerGrip, FrMax = Math.sqrt(Math.max(0, GrL * GrL - rB * rB));
  const delta = steer(c, s, spd);
  s.delta = delta;
  const ebrake =
    s.t < c.engineBrakeThrottle && !s.cut
      ? (c.engineBrake * Math.min(1, s.rpm / c.engineBrakeRpm) * c.gears[s.gear]!) / c.engineBrakeGearDiv
      : 0;
  // Surface drag is the mean of the two axles; (d + d) / 2 is exactly d, so the lot's offDrag is unchanged.
  const sDrag = (surf.dragF + surf.dragR) / 2;
  const drag = c.dragCoef * spd * spd + (mv ? c.rollingDecel + ebrake : 0) + (sDrag ? spd * sDrag : 0) + ae.drag;
  const dx = spd > 0.05 ? (-drag * s.vx) / spd : 0, dy = spd > 0.05 ? (-drag * s.vy) / spd : 0;
  const fLong = s.lockF ? c.lockUsage : (c.brakeFront * D) / Math.max(Gf, 0.1), rLong = (A + rB) / Math.max(Gr, 0.1);
  let fy = 0;
  if (s.vx < 3 && Math.abs(s.vy) < 1.5) {
    // Low-speed kinematic branch (v24): no slip angles, lateral speed damped away.
    s.r = (s.vx * Math.tan(delta)) / L;
    s.vy *= Math.pow(0.0005, dt);
    s.af = 0;
    s.ar = 0;
    // S005-T8 (Main Dev option 5B): the front axle's share of the turn's side force, so the released wheel eases back in
    // a slow turn too (below about 3 km/h it is too small to move it); its sign follows the steering, as in the slip branch.
    fy = (s.vx * s.r * LB) / L;
    const ax = Fxr + Fxf + dx;
    s.vx += ax * dt;
    // S005-T8 (M1): below 0.3 m/s the brakes above are off (mv), so a held brake left the car creeping at about
    // 1 km/h. There a held brake acts as static friction: it takes up to its full force out of the speed, never
    // reversing it, so the car comes to rest and stays there (against the drive too, up to the brake force).
    if (!mv && D > 0) {
      const hold = (c.brakeFront + c.brakeRear) * D * dt;
      s.vx = Math.abs(s.vx) <= hold ? 0 : s.vx - Math.sign(s.vx) * hold;
    }
    s.axp = ax;
    s.useF = fLong;
    s.useR = rLong;
  } else {
    const vxa = Math.max(Math.abs(s.vx), 0.5);
    const af = Math.atan2(s.vy + LA * s.r, vxa) - delta, ar = Math.atan2(s.vy - LB * s.r, vxa);
    s.af = af;
    s.ar = ar;
    const Fyf = -FfMax * tire(c, af), Fyr = -FrMax * tire(c, ar), cd = Math.cos(delta), sd = Math.sin(delta);
    fy = Fyf;
    const ax = Fxr + Fxf * cd - Fyf * sd + dx, ay = Fyf * cd + Fyr + Fxf * sd + dy;
    s.axp = ax;
    s.vx += (ax + s.vy * s.r) * dt;
    s.vy += (ay - s.vx * s.r) * dt;
    s.r += ((LA * (Fyf * cd + Fxf * sd) - LB * Fyr) / c.iz) * dt;
    s.useF = Math.hypot(Math.abs(af) / c.tirePeakSlip, fLong);
    s.useR = Math.hypot(Math.abs(ar) / c.tirePeakSlip, rLong);
  }
  if (s.t === 0 && s.vx < 0) s.vx = 0;
  s.h += s.r * dt;
  const ch = Math.cos(s.h), sh = Math.sin(s.h);
  s.x += (s.vx * ch - s.vy * sh) * dt;
  s.y += (s.vx * sh + s.vy * ch) * dt;
  s.v = Math.hypot(s.vx, s.vy);
  s.beta = s.v > 1 ? Math.atan2(s.vy, Math.abs(s.vx)) : 0;
  s.rateF = s.lockF ? 0 : Math.max(0, s.vx) / c.wheelRadius;
  s.rateR = (Math.max(0, s.vx) + s.spinR * c.spinWheelGain) / c.wheelRadius;
  s.wF += s.rateF * dt;
  s.wR += s.rateR * dt;
  return fy;
}
