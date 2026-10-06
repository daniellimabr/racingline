// Car parameters as data (ADR-001): the S15 field list for src/data's generic validator, plus the
// run settings (lot). Each field: unit · v24 source · confidence. "spec" = real S15 figure,
// "tuned" = Daniel tuned it by feel in v24 (keep unless he decides otherwise), "model" = model shape.
import { DataError } from '../data/check.ts';
import type { Track } from '../data/track.ts';
import { parseCarParams, type CarBase, type CarParamsSchema, type ParamsOf } from '../data/car-params.ts';
import type { SurfaceAt } from './surface.ts';

const num = (min: number, max: number, integer = false) =>
  integer ? ({ type: 'number', min, max, integer } as const) : ({ type: 'number', min, max } as const);

// id, name and the aero fields (downforceArea, dragArea, aeroBalanceFront, airDensity) come from
// CAR_BASE_FIELDS in src/data/car-params.ts, shared by every car file.
export const CAR_SCHEMA = {
  mass: num(100, 5000), // kg · MASS · spec
  wheelbase: num(1, 5), // m · L · spec
  frontAxleFraction: num(0.1, 0.9), // CG to front axle / wheelbase · LA=0.45*L · tuned
  rearAxleFraction: num(0.1, 0.9), // CG to rear axle / wheelbase · LB=0.55*L · tuned (sum must be 1)
  cgHeightRatio: num(0, 1), // CG height / wheelbase, longitudinal load transfer · HL · tuned
  staticFrontWeight: num(0.1, 0.9), // static front axle load share · 0.55 in phys() · tuned
  frontWeightMin: num(0, 1), // clamp on the dynamic front share · 0.3 · tuned
  frontWeightMax: num(0, 1), // · 0.8 · tuned
  loadSensitivity: num(0, 1), // tyre grip coefficient falls by this share per 100% extra axle load, mu(W) = mu (1 - ls (W/W0 - 1)) · model; S15 0.5 (S004-T3), GT3 0.3 (S004-T11: keeps the braking GT3 stable at speed; race slicks are load sensitive, the rest stands in for side-to-side weight transfer) · tuned
  wheelRadius: num(0.1, 1), // m · RW · spec
  grip: num(0.1, 3), // tire friction coefficient · v24 muOf() at its default skill 0.4 (S15 0.95 + 0.1*0.4) · tuned
  tireB: num(1, 50), // tire curve stiffness, F = sin(C*atan(B*slip)) · tire() 14 · model
  tireC: num(0.5, 3), // tire curve shape · tire() 1.5 · model
  tirePeakSlip: num(0.01, 0.5), // rad, slip angle shown as 100% use · PK · tuned
  maxSteerDeg: num(5, 90), // deg, road-wheel lock · DMAX · tuned
  steerMin: num(0, 1), // rad, smallest speed-limited lock · dLim() 0.07 · tuned
  steerSpeedRef: num(0.1, 100), // m/s, lock halves at this speed · dLim() 8 · tuned
  steerLinear: num(0, 1), // linear part of the steering curve · shape() 0.35 · tuned
  steerQuad: num(0, 1), // quadratic part · shape() 0.65 · tuned
  counterBetaOnset: num(0, 1.5), // rad, slip angle where countersteer lock starts · steer() 0.05 · tuned
  counterBetaFull: num(0.01, 1.5), // rad, slip angle with full countersteer lock · steer() 0.25 · tuned
  // Steering stays where it is put (no self-centring); its travel time depends on speed (S004-T2, Daniel
  // 2026-10-06). Replaces v24's steerRate 1.3/s, steerFastRate 3/s and steerReturnRate 7/s.
  steerLockTime: num(0.02, 10), // s, centre to full lock at rest · 0.2 · tuned (S004-T2)
  steerLockTimeTop: num(0.02, 60), // s, centre to full lock at steerLockTopSpeed (not below steerLockTime) · 5 · tuned (S004-T2)
  steerLockTopSpeed: num(1, 200), // m/s, speed of steerLockTimeTop · 83.333 = 300 km/h · tuned (S004-T2)
  steerLockCurve: num(0.5, 6), // shape of the travel time between the two: 1 straight, 2 square of speed (equal to v24's 1.3/s near 105 km/h), 3 stays quick through drift speeds · S15 3, GT3 2 · tuned (S004-T2, Main Dev)
  // S005-T2 (Daniel 2026-10-06): with no steering key pressed the wheel returns to centre like a real one, pulled by
  // the front tyres' self-aligning torque (side force x trail). Trail = caster part (stays when sliding) + tyre part
  // (falls to zero at steerTrailFade x tirePeakSlip). Return speed = gain x front side force (g) x trail share.
  steerCentreGain: num(0, 20), // 1/s per g, share of full steering travel per second for each g of front axle side force at full trail; 0 = no return (S004 held steering) · S15 1.5, GT3 2.5 (from full lock at 100 km/h back within 0.02 of centre in 2.4 s and 2.7 s) · tuned (S005-T2, Physics Dev proposal for Main Dev)
  steerCasterShare: num(0, 1), // share of the aligning trail that is mechanical caster, kept when the front slides · 0.3 (road and race cars run roughly 20-30% caster trail against 70-80% tyre trail at small slip) · model, low confidence
  steerTrailFade: num(1, 5), // front slip, in multiples of tirePeakSlip, where the tyre's own trail is gone, so the aligning torque peaks before the side force does · 2 · model, medium confidence
  steerReturnMaxShare: num(0.01, 1), // the return never turns the wheel faster than this share of the key rate at the current speed, so it stays slow at speed; at 1 it binds only on the GT3 around 200 km/h (downforce), never at low speed · 1 · tuned (S005-T2, Main Dev option B)
  // S005-T3 (Main Dev option 1B): while the car slides, a released wheel returns to centre at a share of the key speed,
  // whatever the front slip, standing in for the caster pulling a free wheel quickly in a slide; the slow tyre return
  // above stays for normal driving. Without it a keyboard catch released at the right moment spun the S15 the other way.
  steerSlideBeta: num(0, 1.5), // rad, slip at the rear axle above which the car counts as sliding for the steering return (or past tirePeakSlip if lower; only above drift speed, S005-T8) · 0.1 · tuned (S005-T3, Main Dev option 1B)
  steerSlideShare: num(0, 4), // share of the key rate at the current speed for that slide return; 0 = off (only the tyre return) · 2 (S005-T8 option 2B: 1 left 0-0.05 s of countersteer overhold at 100-150 km/h, 2 tolerates 0.2 s) · tuned (S005-T3, Main Dev option 1B)
  // S005-T8 (Main Dev options 4B and m1A): near centre the key-rate limit shrinks, so key taps at speed add up instead of
  // being undone between taps, and above a speed a small minimum return clears the slow tail a light tap used to leave.
  steerReturnSoftSteer: num(0, 1), // steering travel below which the return limit shrinks in proportion (limit x |st| / this); 0 = off · 0.3 (100 ms taps every 250 ms at 200 km/h reach 0.20 S15 / 0.16 GT3, was 0.18 / 0.11) · tuned (S005-T8 option 4B)
  steerReturnMin: num(0, 1), // share of full travel per second the released wheel always returns at from steerReturnMinSpeed (unless sliding faster) · 0.1 · tuned (S005-T8 option m1A)
  // S005-T10 (Main Dev option 2A, blind test round 2 M2): the minimum and the geometry return ramp in between these two
  // speeds instead of switching on at once (the step between 20 and 22 km/h), and act in full above the second.
  steerReturnRampFrom: num(0, 100), // m/s, below this the wheel stays put (walking pace, S005-AC-02) · 0.833 = 3 km/h · tuned (S005-T10)
  steerReturnMinSpeed: num(0, 100), // m/s, speed from which the minimum and geometry returns act in full (must be above steerReturnRampFrom) · 5 = 18 km/h (S005-T8 had a step at 20 km/h) · tuned (S005-T10 option 2A)
  steerGeometryGain: num(0, 20), // share of full travel per second at full lock that the steering geometry (caster and kingpin lifting the car) returns, times the speed-limited lock share dLim / maxSteer, so it fades with speed; 0 = off · 2 (full lock back in about 1.3-2.2 s at 10-50 km/h, both cars) · tuned (S005-T10 option 2A)
  // S005-T10 (Main Dev option 1B): catch hold; while the key that caught a slide is held (and until the released wheel is
  // back at centre) the front wheels point at most along the direction of travel, so a held countersteer cannot spin the car.
  steerCatchHold: num(0, 1), // share of the catch hold, 1 = full, 0 = off · 1 (S15 tester catch released 0-0.2 s after the slide closes: 0-4 deg the other way, was a spin) · tuned (S005-T10 option 1B)
  throttleRise: num(0.01, 100), // 1/s · sim() 2.0 · tuned
  throttleFall: num(0.01, 100), // 1/s · sim() 1.5 · tuned
  brakeRise: num(0.01, 100), // 1/s · sim() 1.1 · tuned
  brakeFall: num(0.01, 100), // 1/s · sim() 3 · tuned
  brakeDecel: num(0, 50), // m/s2 at full pedal · phys() D=b*10 · tuned
  brakeFront: num(0, 1), // front brake share · 0.7 · tuned
  brakeRear: num(0, 1), // rear brake share · 0.3 · tuned
  brakeLockMargin: num(0, 1), // share of grip a brake can use before lock · 0.98 · tuned
  rearBrakeMaxShare: num(0, 1), // most of the rear grip the rear brake may take, like a brake balance valve · 0.75 · tuned (S003-T3, Daniel option 1B)
  rearCornerGrip: num(0.5, 2), // rear cornering grip factor over the front, a stability margin; traction and braking unchanged · 1.05 · tuned (S003-T3, Daniel option 2B); GT3 1.09 (S005-T8 option 3A; 1.08 alone left 10.6 deg once the countersteer cap of 2B was in: keeps a corner brake from rotating on once both axles pass their peak); S15 1.15 (S004-T11: settles at the limit with the wheels straight; stands in for front-biased roll stiffness)
  lockUsage: num(0, 5), // front use shown while locked · 1.15 · tuned
  dragCoef: num(0, 0.01), // 1/m, aero drag per v^2 · 0.00036 · tuned
  rollingDecel: num(0, 5), // m/s2 when moving · 0.15 · tuned
  engineBrake: num(0, 5), // m/s2 engine braking scale · 0.35 · tuned
  engineBrakeRpm: num(1, 20000), // rpm where engine braking is full · 6000 · tuned
  engineBrakeGearDiv: num(0.1, 100), // gear ratio divisor (v24 writes GRS[gear]/2) · 2 · tuned
  engineBrakeThrottle: num(0, 1), // throttle below which engine braking applies · 0.05 · tuned
  spinLatOnset: num(0, 5), // wheelspin ratio where rear side grip starts to fade · 0.4 · tuned; S15 0.2 (S004-T11: keeps the power-on drift with the larger rear margin)
  spinLatGain: num(0, 20), // how fast rear side grip fades with wheelspin · 1.8 · tuned
  spinWheelGain: num(0, 100), // m/s of rear wheel overspeed per unit of wheelspin · 14 · tuned
  peakTorque: num(1, 2000), // N m · torqueAt() 330 · spec-ish
  torquePeakRpm: num(1, 20000), // rpm · 4800 · tuned
  torqueWidthRpm: num(1, 20000), // rpm, parabola half width · 5200 · tuned
  torqueFloor: num(0, 1), // lowest torque share · 0.36 · tuned
  gear1: num(0.1, 10), // GRS[0..5] · spec
  gear2: num(0.1, 10),
  gear3: num(0.1, 10),
  gear4: num(0.1, 10),
  gear5: num(0.1, 10),
  gear6: num(0.1, 10),
  finalDrive: num(0.5, 10), // FD · spec
  drivelineEff: num(0.1, 1), // EFF · tuned
  idleRpm: num(100, 5000), // IDLE · spec-ish
  redlineRpm: num(1000, 20000), // RED, tachometer red zone (display) · spec-ish
  cutRpm: num(1000, 20000), // CUT, rev limiter engages · tuned
  cutResumeRpm: num(1000, 20000), // CUTOFF, rev limiter releases · tuned
  rpmOvershoot: num(0, 2000), // rpm allowed above the cut · 150 · tuned
  rpmResponse: num(0.1, 1000), // 1/s, rpm follow speed · 12 · tuned
  launchRpm: num(0, 10000), // rpm added by full throttle in first gear at low speed · 3500 · tuned
  launchSpeed: num(0, 50), // m/s below which the launch rpm applies · 5 · tuned
  autoUpRpm: num(1000, 20000), // automatic upshift above this rpm · 7100 · tuned
  autoDownRpm: num(100, 20000), // automatic downshift below this rpm · 3000 · tuned
  autoDownMaxRpm: num(1000, 20000), // ... only if the lower gear stays below this rpm · 6500 · tuned
  shiftTime: num(0, 5), // s without drive while shifting · 0.15 · tuned
  shiftCooldown: num(0, 5), // s before the next shift · 0.3 · tuned
} as const satisfies CarParamsSchema;

export type CarData = ParamsOf<typeof CAR_SCHEMA>;

/** Validated car data plus values v24 derives once from its constants (same expressions). */
export interface CarParams extends CarData, CarBase {
  gears: readonly number[]; // GRS
  maxSteer: number; // DMAX, rad
  la: number; // LA, m
  lb: number; // LB, m
  iz: number; // IZ = LA*LB, yaw inertia per unit mass (m2)
}

/** Validates car JSON (unknown) and returns typed params; throws a DataError naming the file and fields. */
export function loadCarParams(json: unknown, file: string): CarParams {
  const d = parseCarParams(CAR_SCHEMA, json, file);
  const issues: { path: string; reason: string }[] = [];
  if (Math.abs(d.frontAxleFraction + d.rearAxleFraction - 1) > 1e-9)
    issues.push({ path: '$.rearAxleFraction', reason: 'frontAxleFraction + rearAxleFraction must equal 1' });
  if (d.steerLockTimeTop < d.steerLockTime)
    issues.push({ path: '$.steerLockTimeTop', reason: 'must not be below steerLockTime (steering never quickens with speed)' });
  if (!(d.steerReturnRampFrom < d.steerReturnMinSpeed))
    issues.push({ path: '$.steerReturnRampFrom', reason: 'must be below steerReturnMinSpeed (the return ramps in between them)' });
  if (d.frontWeightMin > d.frontWeightMax) issues.push({ path: '$.frontWeightMin', reason: 'must not exceed frontWeightMax' });
  if (!(d.idleRpm < d.cutResumeRpm)) issues.push({ path: '$.idleRpm', reason: 'idleRpm must be below cutResumeRpm' });
  if (!(d.cutResumeRpm < d.cutRpm)) issues.push({ path: '$.cutResumeRpm', reason: 'cutResumeRpm must be below cutRpm' });
  if (issues.length) throw new DataError(`Car params ${file}`, issues);
  const la = d.frontAxleFraction * d.wheelbase;
  const lb = d.rearAxleFraction * d.wheelbase;
  return {
    ...d,
    gears: [d.gear1, d.gear2, d.gear3, d.gear4, d.gear5, d.gear6],
    maxSteer: (d.maxSteerDeg * Math.PI) / 180,
    la,
    lb,
    iz: la * lb,
  };
}

/** The driving area and its surroundings, in v24 world pixels (scale px per meter). */
export interface Lot {
  scale: number; // PX, px per meter
  x0: number; // LX0..LX1, LY0..LY1: paved lot bounds, px
  y0: number;
  x1: number;
  y1: number;
  startX: number; // reset() position, px
  startY: number;
  offGrip: number; // friction factor off the lot · 0.55
  offDrag: number; // extra drag per m/s off the lot, 1/s · 0.08, the same grass as Interlagos (Daniel 2026-10-05, S003-T12 option 2A; was 0.8)
}

/** v24's test lot (prototype lines 59 and 78, phys() off-lot terms); since S003-T12 its outside is Interlagos grass. */
export const TEST_LOT: Lot = Object.freeze({
  scale: 9, x0: 100, y0: 100, x1: 2300, y1: 1700, startX: 400, startY: 900, offGrip: 0.55, offDrag: 0.08,
});

/** Everything the car step reads besides state and input (the skill setting was removed in S002-T10). */
export interface SimParams {
  car: CarParams;
  lot: Lot; // on a track only its scale (px per m) is used for drawing
  track?: Track; // the checked track; absent on the test lot (S003-T5)
  /** Surface lookup for `track` (src/tracks/surface-at.ts); required whenever `track` is set (S003-T6). */
  surfaceAt?: SurfaceAt;
}

export function createSimParams(car: CarParams, lot: Lot = TEST_LOT, track?: Track): SimParams {
  return track === undefined ? { car, lot } : { car, lot, track };
}
