// v24 phys() and its helpers (prototype lines 92-128): bicycle model with a friction circle per
// axle, load transfer, rear combined slip, drag and engine braking. Same math and operation order
// as v24 so traces match exactly; `s` is the car step's private working copy and is mutated in place.
import type { CarParams, SimParams } from './params.ts';
import type { CarState } from './state.ts';

export const G = 9.81; // m/s2 (v24 g)

/** Steering curve: key travel -1..1 to share of lock (v24 shape). */
export const shape = (c: CarParams, st: number): number => c.steerLinear * st + c.steerQuad * st * Math.abs(st);
/** Speed-limited lock, rad (v24 dLim). */
export const dLim = (c: CarParams, v: number): number => Math.max(c.steerMin, c.maxSteer / (1 + v / c.steerSpeedRef));
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
    d = Math.sign(s.st) * ((1 - w) * Math.abs(d) + w * Math.max(Math.abs(d), Math.abs(sh) * c.maxSteer));
  }
  return d;
}

/** One physics sub-step (v24 phys). */
export function phys(s: CarState, dt: number, p: SimParams): void {
  const c = p.car, L = c.wheelbase, LA = c.la, LB = c.lb;
  const mu = c.grip * (s.off ? p.lot.offGrip : 1), spd = Math.hypot(s.vx, s.vy);
  // v24 evaluates this expression twice (Aav and Afull); once is the same double.
  const Afull = (torqueAt(c, s.rpm) * ratio(c, s.gear) * c.drivelineEff) / c.wheelRadius / c.mass;
  const Aav = s.cut || s.shiftT > 0 ? 0 : Afull;
  const A = s.t * Aav, D = s.b * c.brakeDecel;
  const Wf = Math.max(c.frontWeightMin, Math.min(c.frontWeightMax, c.staticFrontWeight - (c.cgHeightRatio * s.axp) / G));
  // Aero terms are added, never folded in: with zero aero `x + 0` is exact, so the S15 stays bit-identical.
  const ae = aero(c, spd);
  const Wr = 1 - Wf, Gf = mu * G * Wf + mu * ae.front, Gr = mu * G * Wr + mu * ae.rear;
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
  const rB = mv ? Math.min(c.brakeRear * D, Gr * c.brakeLockMargin) : 0;
  const Fxr = Fdrive - dir * rB, Fxf = -dir * fL;
  const FfMax = Math.sqrt(Math.max(0, Gf * Gf - fL * fL)), GrL = Gr * latF, FrMax = Math.sqrt(Math.max(0, GrL * GrL - rB * rB));
  const delta = steer(c, s, spd);
  s.delta = delta;
  const ebrake =
    s.t < c.engineBrakeThrottle && !s.cut
      ? (c.engineBrake * Math.min(1, s.rpm / c.engineBrakeRpm) * c.gears[s.gear]!) / c.engineBrakeGearDiv
      : 0;
  const drag = c.dragCoef * spd * spd + (mv ? c.rollingDecel + ebrake : 0) + (s.off ? spd * p.lot.offDrag : 0) + ae.drag;
  const dx = spd > 0.05 ? (-drag * s.vx) / spd : 0, dy = spd > 0.05 ? (-drag * s.vy) / spd : 0;
  const fLong = s.lockF ? c.lockUsage : (c.brakeFront * D) / Math.max(Gf, 0.1), rLong = (A + rB) / Math.max(Gr, 0.1);
  if (s.vx < 3 && Math.abs(s.vy) < 1.5) {
    // Low-speed kinematic branch (v24): no slip angles, lateral speed damped away.
    s.r = (s.vx * Math.tan(delta)) / L;
    s.vy *= Math.pow(0.0005, dt);
    s.af = 0;
    s.ar = 0;
    const ax = Fxr + Fxf + dx;
    s.vx += ax * dt;
    s.axp = ax;
    s.useF = fLong;
    s.useR = rLong;
  } else {
    const vxa = Math.max(Math.abs(s.vx), 0.5);
    const af = Math.atan2(s.vy + LA * s.r, vxa) - delta, ar = Math.atan2(s.vy - LB * s.r, vxa);
    s.af = af;
    s.ar = ar;
    const Fyf = -FfMax * tire(c, af), Fyr = -FrMax * tire(c, ar), cd = Math.cos(delta), sd = Math.sin(delta);
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
}
