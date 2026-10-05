// Seeded PRNG (mulberry32). State is a plain uint32 stored in SimState, so it serializes as JSON.
// Physics Dev's v24 trace extractor uses the same algorithm; do not change it without a version bump.

export interface Draw {
  value: number; // [0, 1)
  state: number; // next uint32 state
}

/** Turns an integer seed into an rng state (uint32). */
export function seedState(seed: number): number {
  if (!Number.isInteger(seed)) throw new RangeError(`rng seed must be an integer, got ${seed}`);
  return seed >>> 0;
}

/** Pure mulberry32 step: same state in, same draw out. */
export function next(state: number): Draw {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: a >>> 0 };
}
