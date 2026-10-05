// S002-AC-05: downforce and drag grow with speed squared, are zero at standstill, and downforce is
// split front/rear by aeroBalanceFront. Values per unit mass (m/s2), as the sim works in accelerations.
import { describe, expect, it } from 'vitest';
import { aero } from '../../src/sim/index.ts';
import { gt3, KMH, s15 } from './gt3-helpers.ts';

const c = gt3();

describe('aero helper (S002-AC-05)', () => {
  it('is zero at standstill', () => {
    expect(aero(c, 0)).toEqual({ front: 0, rear: 0, drag: 0 });
  });

  it('is 4x when speed doubles', () => {
    const a = aero(c, 30), b = aero(c, 60);
    expect(b.front / a.front).toBeCloseTo(4, 12);
    expect(b.rear / a.rear).toBeCloseTo(4, 12);
    expect(b.drag / a.drag).toBeCloseTo(4, 12);
  });

  it('splits downforce by the aero balance', () => {
    const a = aero(c, 50);
    expect(a.front / (a.front + a.rear)).toBeCloseTo(c.aeroBalanceFront, 12);
    expect(c.aeroBalanceFront).toBe(0.42);
  });

  it('matches the ADR-004 forces at 100 and 250 km/h', () => {
    const at = (kmh: number) => aero(c, kmh * KMH);
    const N = (a: number) => a * c.mass;
    expect(N(at(100).front + at(100).rear)).toBeCloseTo(1418, -1);
    expect(N(at(250).front + at(250).rear)).toBeCloseTo(8861, -1);
    expect(N(at(250).drag)).toBeCloseTo(3249, -1);
  });

  it('is exactly zero for the S15, which has no aero fields', () => {
    expect(aero(s15(), 70)).toEqual({ front: 0, rear: 0, drag: 0 });
  });
});
