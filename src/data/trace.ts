// ReferenceTrace v1: a run of the frozen v24 prototype, recorded headless by Physics Dev (S001-T2),
// that the TS port must reproduce within per-signal tolerances (S001-AC-06).
// Layout agreed in docs/sprints/SPRINT-001/mailbox/physics-dev-to-database-trace-format.md.
import { Checker, orThrow, type Result } from './check.ts';
import { checkInputLog, type V24InputLog } from './input-log.ts';

export const TRACE_VERSION = 1;
export const TRACE_SOURCE = 'prototype-v24';

/** State after `tick` ticks (tick 0 = initial state); every other key is a numeric signal. */
export interface TraceSample {
  tick: number;
  [signal: string]: number;
}

export interface ReferenceTrace {
  version: typeof TRACE_VERSION;
  source: typeof TRACE_SOURCE;
  scenario: string; // e.g. "straight-accel", "drift-countersteer"
  inputLog: V24InputLog; // the exact v24 inputs that produced the samples (input log version 1)
  stride: number; // a sample every `stride` ticks
  samples: TraceSample[];
}

const TRACE_KEYS = ['version', 'source', 'scenario', 'inputLog', 'stride', 'samples'] as const;

function checkSamples(c: Checker, v: unknown, path: string, stride: number, frameCount: number): void {
  if (!c.array(v, path)) return;
  if (v.length === 0) {
    c.fail(path, 'expected at least one sample');
    return;
  }
  let signals: string[] | undefined;
  let lastTick = -1;
  for (let i = 0; i < v.length; i++) {
    const p = `${path}[${i}]`;
    const s = v[i];
    if (!c.object(s, p)) continue;
    // The first valid sample fixes the signal set; every later sample must carry the same one.
    signals ??= Object.keys(s).filter((k) => k !== 'tick');
    c.keys(s, p, ['tick', ...signals]);
    if (Object.hasOwn(s, 'tick')) checkTick(c, s['tick'], `${p}.tick`, lastTick, stride, frameCount);
    if (typeof s['tick'] === 'number' && Number.isInteger(s['tick'])) lastTick = Math.max(lastTick, s['tick']);
    for (const k of Object.keys(s)) if (k !== 'tick') c.number(s[k], `${p}.${k}`);
  }
}

function checkTick(c: Checker, t: unknown, path: string, lastTick: number, stride: number, frameCount: number): void {
  const max = frameCount >= 0 ? frameCount : Number.MAX_SAFE_INTEGER;
  if (!c.number(t, path, { min: 0, max, integer: true })) return;
  if (t <= lastTick) c.fail(path, `ticks must increase, got ${t} after ${lastTick}`);
  else if (stride > 0 && t % stride !== 0) c.fail(path, `expected a multiple of stride ${stride}, got ${t}`);
}

export function validateReferenceTrace(v: unknown): Result<ReferenceTrace> {
  const c = new Checker();
  if (!c.object(v, '$')) return c.result(v);
  c.keys(v, '$', TRACE_KEYS);
  const has = (k: string): boolean => Object.hasOwn(v, k);
  if (has('version')) c.equals(v['version'], TRACE_VERSION, '$.version', 'version');
  if (has('source')) c.equals(v['source'], TRACE_SOURCE, '$.source', 'source');
  if (has('scenario')) c.string(v['scenario'], '$.scenario');
  const frameCount = has('inputLog') ? checkInputLog(c, v['inputLog'], '$.inputLog', true) : -1;
  let stride = 0;
  if (has('stride') && c.number(v['stride'], '$.stride', { min: 1, integer: true })) stride = v['stride'];
  if (has('samples')) checkSamples(c, v['samples'], '$.samples', stride, frameCount);
  return c.result<ReferenceTrace>(v);
}

/** Like validateReferenceTrace, but throws a DataError listing every path and reason. */
export function parseReferenceTrace(v: unknown, what = 'Reference trace'): ReferenceTrace {
  return orThrow(what, validateReferenceTrace(v));
}
