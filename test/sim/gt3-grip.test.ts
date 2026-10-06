// S002-AC-07: the GT3's maximum lateral grip grows with speed (downforce). Measured in the sim's own
// physics step: the car slides sideways with both axles at the tyre's peak slip angle, so each axle
// gives its full lateral capacity; the lateral acceleration over one sub-step is that capacity.
import { describe, expect, it } from 'vitest';
import { createCar, G, phys } from '../../src/sim/index.ts';
import { gt3, KMH, open, s15 } from './gt3-helpers.ts';
import type { CarParams } from '../../src/sim/index.ts';
import { lotSurface } from '../../src/sim/surface.ts';

function maxLateralG(car: CarParams, kmh: number): number {
  const p = open(car);
  const v = kmh * KMH, a = car.tirePeakSlip, dt = 1e-4;
  const s = { ...createCar(p), vx: v * Math.cos(a), vy: v * Math.sin(a), r: 0, gear: 5, rpm: 3000 };
  const vy0 = s.vy;
  phys(s, dt, p, lotSurface(p.lot, false));
  return Math.abs((s.vy - vy0) / dt) / G;
}

describe('GT3 lateral grip vs speed (S002-AC-07)', () => {
  it('is higher at 200 km/h than at 80 km/h, near the ADR-004 values', () => {
    const g80 = maxLateralG(gt3(), 80), g200 = maxLateralG(gt3(), 200);
    expect(g200).toBeGreaterThan(g80 * 1.25);
    // ADR-004 amended 2026-10-05: the S003 rear cornering margin (rearCornerGrip 1.05) raised 1.65/2.21 g.
    expect(g80).toBeCloseTo(1.7, 1);
    expect(g200).toBeCloseTo(2.29, 1);
  });

  it('stays flat for the S15, which has no aero', () => {
    expect(maxLateralG(s15(), 200)).toBeCloseTo(maxLateralG(s15(), 80), 1);
  });
});
