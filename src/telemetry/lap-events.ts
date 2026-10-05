// Lap and sector events for the telemetry summary stream (S003-AC-10, ADR-002 §3 and §6): one object
// line per crossing, keyed by the integer sim tick `k`. Times are seconds at full precision (they are
// results, not chart samples). Shape shared with Database in docs/sprints/SPRINT-003/mailbox/back-end-to-database-lap-lines.md.
import type { SimState } from '../core/sim.ts';
import type { CarState } from '../sim/index.ts';

export type LapLine =
  | { t: 'sector'; k: number; lap: number; sector: 1 | 2 | 3; time: number; valid: boolean }
  | { t: 'lap'; k: number; lap: number; time: number; sectors: [number, number, number]; valid: boolean; best: boolean };

/** Summary lines for the events of the tick that produced `state` (none on the test lot). */
export function lapEventLines(state: SimState<CarState>): LapLine[] {
  const k = state.tick;
  return (state.car.lap?.events ?? []).map((e) =>
    e.type === 'sector'
      ? { t: 'sector', k, lap: e.lap, sector: e.sector, time: e.time, valid: e.valid }
      : { t: 'lap', k, lap: e.lap, time: e.time, sectors: [...e.sectors], valid: e.valid, best: e.best },
  );
}
