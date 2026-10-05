// Lap HUD content (S003-T7): turns the sim's lap progress into the texts the screen shows. Formatting only;
// all timing comes from the sim. Shape agreed in docs/sprints/SPRINT-003/mailbox/back-end-to-front-end-track-api.md
// (lapProgress(car) in src/sim/laps.ts, S003-T5). UI text is Portuguese, as the rest of the game screen.

/** A finished lap: time and the three sector times, s; invalid laps never become the best lap. */
export interface LapRecord {
  readonly time: number;
  readonly sectors: readonly [number, number, number];
  readonly valid: boolean;
}

/** What lapProgress(car) returns on a track (null on the test lot). */
export interface LapProgress {
  /** 0 before the first start line crossing (the out lap). */
  readonly lap: number;
  readonly sector: 1 | 2 | 3;
  /** s since this lap began. */
  readonly time: number;
  /** Finished sector times of this lap, s (0 to 2 entries). */
  readonly splits: readonly number[];
  readonly valid: boolean;
  readonly last: LapRecord | null;
  readonly best: LapRecord | null;
}

export type SectorState = 'done' | 'running' | 'todo';

export interface LapHud {
  title: string;
  time: string;
  sectors: { label: string; time: string; state: SectorState }[];
  best: string;
  last: string | null;
  /** Words for the invalid-lap mark, null while the lap is valid. */
  invalid: string | null;
}

const NONE = '—';

/** m:ss,mmm with a decimal comma; a dash for a missing, negative or non-finite time. */
export function fmtLapTime(t: number | null): string {
  if (t === null || !Number.isFinite(t) || t < 0) return NONE;
  const ms = Math.round(t * 1000), m = Math.floor(ms / 60000), rest = ms - m * 60000;
  const sec = Math.floor(rest / 1000), milli = rest - sec * 1000;
  return m + ':' + String(sec).padStart(2, '0') + ',' + String(milli).padStart(3, '0');
}

export function lapHud(p: LapProgress | null): LapHud | null {
  if (p === null) return null;
  const started = p.lap > 0;
  const done = p.splits.reduce((sum, t) => sum + t, 0);
  const sectors = [0, 1, 2].map((i) => {
    const label = 'S' + (i + 1);
    if (!started) return { label, time: NONE, state: 'todo' as const };
    if (i < p.splits.length) return { label, time: fmtLapTime(p.splits[i]!), state: 'done' as const };
    if (i === p.sector - 1) return { label, time: fmtLapTime(p.time - done), state: 'running' as const };
    return { label, time: NONE, state: 'todo' as const };
  });
  return {
    title: started ? 'Volta ' + p.lap : 'Volta ' + NONE,
    time: started ? fmtLapTime(p.time) : 'Cruze a largada',
    sectors,
    best: 'Melhor ' + fmtLapTime(p.best?.time ?? null),
    last: p.last ? 'Última ' + fmtLapTime(p.last.time) + (p.last.valid ? '' : ' (inválida)') : null,
    invalid: started && !p.valid ? '✕ Volta inválida' : null,
  };
}
