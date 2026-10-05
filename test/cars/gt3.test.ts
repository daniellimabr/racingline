// S002-AC-01 (gt3.json part): the GT3 file loads, carries the ADR-004 aero values, and has the data
// the HUD reads per car (name, redline, six gears) so Front End needs no S15 constants (T7).
import { describe, expect, it } from 'vitest';
import { loadCarParams } from '../../src/sim/index.ts';
import gt3Json from '../../src/cars/gt3.json';
import s15Json from '../../src/cars/s15-drift.json';

describe('gt3.json (ADR-004)', () => {
  const c = loadCarParams(gt3Json, 'gt3.json');

  it('is valid, with id, HUD name and the ADR-004 aero values', () => {
    expect(c.id).toBe('gt3');
    expect(c.name).toBe('GT3');
    expect([c.downforceArea, c.dragArea, c.aeroBalanceFront, c.airDensity]).toEqual([3, 1.1, 0.42, 1.225]);
    expect(c.dragCoef).toBe(0);
  });

  it('carries the tacho redline, rev cut and six gears', () => {
    expect([c.redlineRpm, c.cutRpm]).toEqual([8000, 8500]);
    expect(c.gears).toEqual([3.154, 2.294, 1.85, 1.526, 1.292, 1.097]);
  });

  it('has exactly the same keys as the S15 file plus the four aero fields', () => {
    const extra = ['downforceArea', 'dragArea', 'aeroBalanceFront', 'airDensity'];
    expect(Object.keys(gt3Json).sort()).toEqual([...Object.keys(s15Json), ...extra].sort());
  });
});
