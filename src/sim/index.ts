// Public API of the pure car simulation (S001-T4). Use with src/core: createState(seed, createCar(p)),
// then step(state, input, p, carStep) once per 1/60 s tick.
export { carStep } from './car.ts';
export { createCar, MODES, type CarState, type DriftEnd, type DriftRecord, type DriftRun, type Mode } from './state.ts';
export { CAR_SCHEMA, createSimParams, loadCarParams, TEST_LOT, type CarData, type CarParams, type Lot, type SimParams } from './params.ts';
export { predict, type Prediction } from './predict.ts';
export { aero, G, phys, ratio, steerLockTime, type Aero } from './physics.ts';
export { tractionState, HALO_SPAN, HALO_THRESHOLD, type TractionState } from './traction.ts';
export { DRIFT_BETA } from './drift.ts';
export { nextLeave, resetCar, spawnLeave } from './reset.ts';
export { lotSurface, trackSurface, type AxleSurface, type SurfaceAt } from './surface.ts';
export {
  allWheelsOff, createLapState, crossing, lapProgress, lapStep, LINE_MARGIN, wheelPositions,
  type LapEvent, type LapProgress, type LapState, type LapTime,
} from './laps.ts';
