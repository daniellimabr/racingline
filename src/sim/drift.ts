// v24 driftTrack() and finishDrift() (prototype lines 153-162) as pure data: returns the new
// current drift and drift list instead of writing page globals; the table text is the UI's job.
import type { CarState, DriftEnd, DriftRecord, DriftRun } from './state.ts';

export const DRIFT_BETA = 0.25; // rad, slip angle that counts as drifting (v24 DB)
const DRIFT_MIN_SPEED = 4; // m/s
const DRIFT_MIN_TIME = 0.3; // s, shorter slides are not recorded unless they spun
const SPIN_BETA = 1.3; // rad
const SLOW_KMH = 18;
const KEEP = 10; // records kept, newest first
const DEG = 57.3; // v24's degrees factor

const newRun = (): DriftRun => ({
  dur: 0, maxB: 0, sB: 0, sThr: 0, sThr2: 0, sLim: 0, above: 0, cs: 0, sK: 0, sR: 0, cutN: 0, n: 0, spun: false,
  gears: {}, lastThr: 0, lastLim: 0, lastK: 0,
});

function finish(d: DriftRun, s: CarState): DriftRecord {
  const n = Math.max(1, d.n), mT = d.sThr / n, sd = Math.sqrt(Math.max(0, d.sThr2 / n - mT * mT));
  let end: DriftEnd;
  if (d.spun || Math.abs(s.beta) > SPIN_BETA) end = 'spin';
  else if (s.off) end = 'off';
  else if (d.lastK < SLOW_KMH) end = 'slow';
  else if (d.lastThr < d.lastLim) end = 'gripLow';
  else end = 'gripHigh';
  // Most used gear; ties go to the lowest gear (integer keys iterate in ascending order, sort is stable).
  const gear = +Object.entries(d.gears).sort((a, b) => b[1] - a[1])[0]![0];
  return {
    dur: d.dur, maxB: d.maxB * DEG, avgB: (d.sB / n) * DEG, kmh: d.sK / n, thr: mT, lim: d.sLim / n, above: d.above / n,
    sd, cs: d.cs / n, rpm: d.sR / n, cut: d.cutN / n, gear, end,
  };
}

/** Updates s.cur and s.drifts for one tick (call after s.off is set, as v24 does). Never mutates the old objects. */
export function trackDrift(s: CarState, dt: number): void {
  const ab = Math.abs(s.beta), inD = s.v > DRIFT_MIN_SPEED && ab > DRIFT_BETA && !s.off;
  let cur = s.cur;
  if (s.mode === 'spin' && cur) cur = { ...cur, spun: true };
  if (inD) {
    cur = cur ? { ...cur, gears: { ...cur.gears } } : newRun();
    cur.dur += dt;
    cur.n++;
    cur.maxB = Math.max(cur.maxB, ab);
    cur.sB += ab;
    cur.sThr += s.t;
    cur.sThr2 += s.t * s.t;
    cur.sLim += s.lim;
    if (s.t > s.lim) cur.above++;
    if (Math.abs(s.st) > 0.1 && Math.sign(s.st) === Math.sign(s.beta)) cur.cs++;
    cur.sK += s.v * 3.6;
    cur.sR += s.rpm;
    if (s.cut) cur.cutN++;
    const g = String(s.gear + 1);
    cur.gears[g] = (cur.gears[g] ?? 0) + 1;
    cur.lastThr = s.t;
    cur.lastLim = s.lim;
    cur.lastK = s.v * 3.6;
  } else if (cur) {
    if (cur.dur >= DRIFT_MIN_TIME || cur.spun) s.drifts = [finish(cur, s), ...s.drifts].slice(0, KEEP);
    cur = null;
  }
  s.cur = cur;
}
