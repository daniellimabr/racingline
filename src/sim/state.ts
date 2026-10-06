// Car state: v24's S object as plain JSON (same field names, so traces compare one to one),
// plus the drift tracker that v24 kept in the page globals `cur` and `drifts`.
import type { LapState } from './laps.ts';
import type { SimParams } from './params.ts';

/** v24 S.mode: grip, front sliding, rear sliding, drift, spin. Index order matches the trace files. */
export const MODES = ['', 'front', 'rear', 'drift', 'spin'] as const;
export type Mode = (typeof MODES)[number];

/** Running totals of the current drift (v24 `cur`). */
export interface DriftRun {
  dur: number; // s
  n: number; // ticks
  maxB: number; // rad
  sB: number; // sums over ticks: |beta|, throttle, throttle^2, traction limit, km/h, rpm
  sThr: number;
  sThr2: number;
  sLim: number;
  sK: number;
  sR: number;
  above: number; // ticks with throttle above the traction limit
  cs: number; // ticks with countersteer
  cutN: number; // ticks on the rev limiter
  spun: boolean;
  gears: Record<string, number>; // ticks per gear, keyed by gear number (1-based) as v24
  lastThr: number;
  lastLim: number;
  lastK: number;
}

/** Why a drift ended (v24 finishDrift() texts, as codes for the UI to word). */
export type DriftEnd = 'spin' | 'off' | 'slow' | 'gripLow' | 'gripHigh';

/** One finished drift (v24 `drifts` row). Angles in degrees (v24 x57.3), shares 0..1. */
export interface DriftRecord {
  dur: number;
  maxB: number;
  avgB: number;
  kmh: number;
  thr: number;
  lim: number;
  above: number;
  sd: number; // throttle standard deviation
  cs: number;
  rpm: number;
  cut: number;
  gear: number; // most used gear, 1-based
  end: DriftEnd;
}

export interface CarState {
  x: number; y: number; h: number; // m, m, rad (world)
  vx: number; vy: number; r: number; // m/s body frame, rad/s yaw rate
  v: number; beta: number; // speed, body slip angle
  t: number; b: number; st: number; // throttle 0..1, brake 0..1, steering -1..1
  delta: number; // road-wheel angle (rad)
  af: number; ar: number; axp: number; // slip angles, last longitudinal accel
  u: number; lim: number; spinR: number; wspin: boolean; lockF: boolean; // rear drive use, traction limit, wheelspin, front lock
  useF: number; useR: number; uFs: number; uRs: number; // axle grip use, raw and smoothed
  pF0: number; pR0: number; b0: number; dFs: number; dRs: number; dB: number; // derivative memories and rates
  riskF: number; riskR: number; // traction-halo risk per axle
  wF: number; wR: number; rateF: number; rateR: number; // wheel angle (render) and speed (rad, rad/s)
  mode: Mode;
  off: boolean; // outside the lot
  tt: number; // s since reset
  gear: number; auto: boolean; rpm: number; cut: boolean; shiftT: number; shiftCd: number; groundRpm: number;
  cur: DriftRun | null; // current drift, if any
  drifts: DriftRecord[]; // last 10 finished drifts, newest first
  lap?: LapState; // lap timing, only on a track (absent on the test lot, so lot states hash as before)
  leave?: number; // m along the centreline where the car was last on the track (R reset, S004-T5); only on a track
}

/** v24 reset(). */
export function createCar(p: SimParams): CarState {
  return {
    x: p.lot.startX / p.lot.scale, y: p.lot.startY / p.lot.scale, h: 0, vx: 0, vy: 0, r: 0, v: 0, t: 0, b: 0, st: 0,
    beta: 0, af: 0, ar: 0, delta: 0, axp: 0, u: 0, lim: 1, useF: 0, useR: 0, uFs: 0, uRs: 0, dFs: 0, dRs: 0,
    pF0: 0, pR0: 0, b0: 0, dB: 0, riskF: 0, riskR: 0, lockF: false, spinR: 0, wF: 0, wR: 0, rateF: 0, rateR: 0,
    mode: '', wspin: false, off: false, tt: 0, gear: 0, auto: true, rpm: p.car.idleRpm, cut: false, shiftT: 0,
    shiftCd: 0, groundRpm: 0, cur: null, drifts: [],
  };
}
