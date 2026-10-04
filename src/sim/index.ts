// Public API of the pure car simulation (S001-T4). Use with src/core: createState(seed, createCar(p)),
// then step(state, input, p, carStep) once per 1/60 s tick.
export { carStep } from './car.ts';
export { createCar, MODES, type CarState, type DriftEnd, type DriftRecord, type DriftRun, type Mode } from './state.ts';
export { CAR_SCHEMA, createSimParams, loadCarParams, TEST_LOT, type CarData, type CarParams, type Lot, type SimParams } from './params.ts';
export { predict, type Prediction } from './predict.ts';
export { tractionState, HALO_SPAN, HALO_THRESHOLD, type TractionState } from './traction.ts';
export { DRIFT_BETA } from './drift.ts';
