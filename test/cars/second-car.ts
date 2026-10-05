// Test-only second car (stands in for gt3.json until Physics Dev delivers it): the S15 with a new
// id and name and a few values changed, so a replay with the wrong car gives a different hash.
import { loadCarParams, type CarParams } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';

export function secondCar(): CarParams {
  return loadCarParams(
    { ...s15, id: 'test-car-b', name: 'Test car B', mass: 1250, peakTorque: 480, grip: 1.34, idleRpm: 1100 },
    'test-car-b.json',
  );
}
