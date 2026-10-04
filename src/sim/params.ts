// Car parameters as data (ADR-001): the S15 field list for src/data's generic validator, plus the
// run settings (skill, lot). Each field: unit · v24 source · confidence. "spec" = real S15 figure,
// "tuned" = Daniel tuned it by feel in v24 (keep unless he decides otherwise), "model" = model shape.
import { DataError } from '../data/check.ts';
import { parseCarParams, type CarParamsSchema, type ParamsOf } from '../data/car-params.ts';

const num = (min: number, max: number, integer = false) =>
  integer ? ({ type: 'number', min, max, integer } as const) : ({ type: 'number', min, max } as const);

export const CAR_SCHEMA = {
  id: { type: 'string' },
  name: { type: 'string' },
  mass: num(100, 5000), // kg · MASS · spec
  wheelbase: num(1, 5), // m · L · spec
  frontAxleFraction: num(0.1, 0.9), // CG to front axle / wheelbase · LA=0.45*L · tuned
  rearAxleFraction: num(0.1, 0.9), // CG to rear axle / wheelbase · LB=0.55*L · tuned (sum must be 1)
  cgHeightRatio: num(0, 1), // CG height / wheelbase, longitudinal load transfer · HL · tuned
  staticFrontWeight: num(0.1, 0.9), // static front axle load share · 0.55 in phys() · tuned
  frontWeightMin: num(0, 1), // clamp on the dynamic front share · 0.3 · tuned
  frontWeightMax: num(0, 1), // · 0.8 · tuned
  wheelRadius: num(0.1, 1), // m · RW · spec
  gripBase: num(0.1, 3), // friction coefficient at skill 0 · muOf() 0.95 · tuned
  gripPerSkill: num(0, 1), // extra friction at skill 1 · muOf() 0.1 · tuned
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
  steerRate: num(0.01, 100), // 1/s, steering travel speed · sim() 1.3 · tuned
  steerFastRate: num(0.01, 100), // 1/s, when reversing or countersteering · sim() 3 · tuned
  steerFastBeta: num(0, 1.5), // rad, slip angle that enables the fast rate · sim() 0.1 · tuned
  steerReturnRate: num(0.01, 100), // 1/s, self-centering · sim() 7 · tuned
  throttleRise: num(0.01, 100), // 1/s · sim() 2.0 · tuned
  throttleFall: num(0.01, 100), // 1/s · sim() 1.5 · tuned
  brakeRise: num(0.01, 100), // 1/s · sim() 1.1 · tuned
  brakeFall: num(0.01, 100), // 1/s · sim() 3 · tuned
  brakeDecel: num(0, 50), // m/s2 at full pedal · phys() D=b*10 · tuned
  brakeFront: num(0, 1), // front brake share · 0.7 · tuned
  brakeRear: num(0, 1), // rear brake share · 0.3 · tuned
  brakeLockMargin: num(0, 1), // share of grip a brake can use before lock · 0.98 · tuned
  lockUsage: num(0, 5), // front use shown while locked · 1.15 · tuned
  dragCoef: num(0, 0.01), // 1/m, aero drag per v^2 · 0.00036 · tuned
  rollingDecel: num(0, 5), // m/s2 when moving · 0.15 · tuned
  engineBrake: num(0, 5), // m/s2 engine braking scale · 0.35 · tuned
  engineBrakeRpm: num(1, 20000), // rpm where engine braking is full · 6000 · tuned
  engineBrakeGearDiv: num(0.1, 100), // gear ratio divisor (v24 writes GRS[gear]/2) · 2 · tuned
  engineBrakeThrottle: num(0, 1), // throttle below which engine braking applies · 0.05 · tuned
  spinLatOnset: num(0, 5), // wheelspin ratio where rear side grip starts to fade · 0.4 · tuned
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
  wobbleAmp: num(0, 10000), // steering wobble noise amplitude · step() 700 · tuned
  wobbleDecay: num(0, 100), // 1/s, wobble pull back to zero · step() 4 · tuned
  wobbleGain: num(0, 0.01), // rad of steer per wobble unit at skill 0 · 0.00015 · tuned
  wobbleSpeed: num(0.1, 200), // m/s where the wobble reaches full effect · 20 · tuned
} as const satisfies CarParamsSchema;

export type CarData = ParamsOf<typeof CAR_SCHEMA>;

/** Validated car data plus values v24 derives once from its constants (same expressions). */
export interface CarParams extends CarData {
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
  offDrag: number; // extra drag per m/s off the lot, 1/s · 0.8
}

/** v24's test lot (prototype lines 59 and 78, phys() off-lot terms). */
export const TEST_LOT: Lot = Object.freeze({
  scale: 9, x0: 100, y0: 100, x1: 2300, y1: 1700, startX: 400, startY: 900, offGrip: 0.55, offDrag: 0.8,
});

/** Everything the car step reads besides state and input. Skill comes from the run (input log header). */
export interface SimParams {
  car: CarParams;
  skill: number; // 0..1, v24 "Experiência" slider
  lot: Lot;
}

export function createSimParams(car: CarParams, skill: number, lot: Lot = TEST_LOT): SimParams {
  if (!(skill >= 0 && skill <= 1)) throw new RangeError(`skill must be a number in 0..1, got ${skill}`);
  return { car, skill, lot };
}
