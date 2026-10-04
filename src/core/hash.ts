// Stable state hash: canonical JSON (sorted keys) -> FNV-1a 64 over UTF-8 bytes, as 16 hex chars.
// Why FNV-1a 64: equality check, not security; synchronous, dependency-free and identical in browser
// and Node (crypto.subtle SHA-256 is async in the browser). 64 bits makes accidental collisions negligible.

/** Canonical JSON: object keys sorted, -0 kept as "-0"; throws on values JSON cannot round-trip. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`canonical JSON: non-finite number ${value}`);
    return Object.is(value, -0) ? '-0' : JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') + '}';
  }
  throw new TypeError(`canonical JSON: unsupported ${typeof value}`);
}

const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;
const utf8 = new TextEncoder();

export function fnv1a64(text: string): string {
  let h = OFFSET;
  for (const byte of utf8.encode(text)) h = ((h ^ BigInt(byte)) * PRIME) & MASK;
  return h.toString(16).padStart(16, '0');
}

export function hashState(state: unknown): string {
  return fnv1a64(canonicalJson(state));
}
