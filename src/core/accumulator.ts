// Fixed-timestep accumulator for the browser loop (ADR-001). The caller measures frame time; the core never reads a clock.
// Time is counted in integer units (1 unit = 1/60 microsecond, so 1 tick = 1e6 units): the tick count then depends
// only on total elapsed time, not on how frames split it (up to 0.5 us rounding per frame).

export const MAX_FRAME = 0.25; // seconds; longer frames are clamped to avoid a spiral of death
const TICK_UNITS = 1_000_000;

export interface Advance {
  ticks: number; // sim ticks to run now
  acc: number; // leftover to pass into the next call (start with 0)
  alpha: number; // leftover fraction of a tick in [0, 1), for render interpolation
}

export function advance(acc: number, frameSeconds: number): Advance {
  const frame = frameSeconds > 0 ? Math.min(frameSeconds, MAX_FRAME) : 0; // NaN and negatives -> 0
  const total = acc + Math.round(frame * 1e6) * 60;
  const ticks = Math.floor(total / TICK_UNITS);
  const rest = total - ticks * TICK_UNITS;
  return { ticks, acc: rest, alpha: rest / TICK_UNITS };
}
