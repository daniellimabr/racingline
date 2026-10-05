// Traction-halo data (v24 tractionState(), line 234): which axle is closest to losing grip and
// how strongly to warn. Pure read of the car state; the drawing is Front End's job.
import type { CarState } from './state.ts';

export const HALO_THRESHOLD = 0.9; // risk where the halo appears (v24 TH)
export const HALO_SPAN = 0.5; // risk range from faint to full halo (v24 SPAN)

export interface TractionState {
  rear: boolean; // the rear axle is the one at risk
  risk: number; // predicted grip use of that axle (1 = at the limit)
  cur: number; // its smoothed grip use now
  p: number; // halo strength 0..1
  warn: boolean; // predicted over the limit while still gripping
  rising: boolean; // risk growing fast
}

export function tractionState(s: CarState): TractionState {
  const rear = s.riskR >= s.riskF, risk = rear ? s.riskR : s.riskF, cu = rear ? s.uRs : s.uFs;
  const rising = rear ? s.dRs > 0.3 || s.dB > 0.15 : s.dFs > 0.3;
  return { rear, risk, cur: cu, p: Math.max(0, Math.min(1, (risk - HALO_THRESHOLD) / HALO_SPAN)), warn: risk >= 1 && cu < 1, rising };
}
