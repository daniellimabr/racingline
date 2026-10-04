// SimState <-> text. Canonical JSON keeps doubles exact (shortest round-trip) and -0 (JSON.parse("-0") is -0).
import { canonicalJson } from './hash.ts';
import type { SimState } from './sim.ts';

export function serialize(state: SimState): string {
  return canonicalJson(state);
}

/** Parses and validates the envelope; the car payload is checked by its owner (Physics Dev / Database). */
export function deserialize<C = unknown>(text: string): SimState<C> {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    throw new SyntaxError('SimState: text is not valid JSON');
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) throw new TypeError('SimState: not an object');
  const s = o as Record<string, unknown>;
  if (s.v !== 1) throw new TypeError(`SimState: unsupported version ${String(s.v)}`);
  if (!Number.isSafeInteger(s.tick) || (s.tick as number) < 0) throw new TypeError('SimState: tick must be a non-negative integer');
  if (!Number.isInteger(s.rng) || (s.rng as number) < 0 || (s.rng as number) > 0xffffffff)
    throw new TypeError('SimState: rng must be a uint32');
  if (!('car' in s) || s.car === undefined) throw new TypeError('SimState: missing car');
  return { v: 1, tick: s.tick as number, rng: s.rng as number, car: s.car as C };
}
