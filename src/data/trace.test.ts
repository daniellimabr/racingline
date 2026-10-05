// ReferenceTrace v1: v24 recordings used by S001-AC-06 (format agreed in physics-dev-to-database-trace-format.md).
import { describe, expect, it } from 'vitest';
import { DataError } from './check.ts';
import { parseReferenceTrace, validateReferenceTrace, type ReferenceTrace } from './trace.ts';

const frame = { throttle: 1, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false };

const trace = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  source: 'prototype-v24',
  scenario: 'straight-accel',
  inputLog: {
    version: 1,
    seed: 7,
    skill: 0.4,
    car: 's15-drift',
    tickSeconds: 1 / 60,
    subSteps: 10,
    frames: Array.from({ length: 4 }, () => ({ ...frame })),
  },
  stride: 2,
  samples: [
    { tick: 0, x: 0, y: 0, v: 0, gear: 1 },
    { tick: 2, x: 0.01, y: 0, v: 0.4, gear: 1 },
    { tick: 4, x: 0.05, y: 0, v: 0.8, gear: 1 },
  ],
  ...over,
});

const errorsOf = (v: unknown) => {
  const r = validateReferenceTrace(v);
  if (r.ok) throw new Error('expected the trace to be rejected');
  return r.errors;
};
const pathsOf = (v: unknown) => errorsOf(v).map((e) => e.path);

describe('validateReferenceTrace', () => {
  it('accepts a valid v1 trace and returns it typed', () => {
    const r = validateReferenceTrace(trace());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const typed: ReferenceTrace = r.value;
      expect(typed.samples[2]?.['v']).toBe(0.8);
    }
  });

  it('round-trips through JSON (write -> read -> equal)', () => {
    const original = trace();
    expect(parseReferenceTrace(JSON.parse(JSON.stringify(original)))).toEqual(original);
  });

  it.each([2, '1', undefined])('rejects version %s', (version) => {
    expect(pathsOf(trace({ version }))).toContain('$.version');
  });

  it('rejects an unknown source', () => {
    expect(pathsOf(trace({ source: 'prototype-v23' }))).toContain('$.source');
  });

  it.each(['', 7])('rejects a bad scenario id (%s)', (scenario) => {
    expect(pathsOf(trace({ scenario }))).toContain('$.scenario');
  });

  it('rejects missing and unknown top-level fields', () => {
    const bad = trace({ extra: 1 });
    delete bad['stride'];
    expect(errorsOf(bad)).toEqual(
      expect.arrayContaining([
        { path: '$.stride', reason: 'missing field' },
        { path: '$.extra', reason: 'unknown field' },
      ]),
    );
  });

  it('validates the embedded input log with nested paths', () => {
    const t = trace();
    (t['inputLog'] as { frames: Record<string, unknown>[] }).frames[3] = { ...frame, brake: 9 };
    expect(pathsOf(t)).toContain('$.inputLog.frames[3].brake');
  });

  it.each([0, -1, 1.5, '2'])('rejects stride %s', (stride) => {
    expect(pathsOf(trace({ stride }))).toContain('$.stride');
  });

  it.each([[], {}, null])('rejects samples that are not a non-empty array (%s)', (samples) => {
    expect(pathsOf(trace({ samples }))).toContain('$.samples');
  });

  it('rejects ticks that do not increase', () => {
    const samples = [
      { tick: 0, v: 0 },
      { tick: 2, v: 1 },
      { tick: 2, v: 1 },
    ];
    expect(pathsOf(trace({ samples }))).toContain('$.samples[2].tick');
  });

  it('rejects ticks off the stride grid or beyond the recorded frames', () => {
    expect(pathsOf(trace({ samples: [{ tick: 1, v: 0 }] }))).toContain('$.samples[0].tick');
    expect(pathsOf(trace({ samples: [{ tick: 6, v: 0 }] }))).toContain('$.samples[0].tick');
    expect(pathsOf(trace({ samples: [{ tick: -2, v: 0 }] }))).toContain('$.samples[0].tick');
  });

  it('rejects a sample without a tick', () => {
    expect(errorsOf(trace({ samples: [{ v: 0 }] }))).toContainEqual({ path: '$.samples[0].tick', reason: 'missing field' });
  });

  it('rejects non-finite or non-number signal values', () => {
    const samples = [
      { tick: 0, v: Number.NaN, gear: 1 },
      { tick: 2, v: 1, gear: '2' },
    ];
    expect(pathsOf(trace({ samples }))).toEqual(['$.samples[0].v', '$.samples[1].gear']);
  });

  it('rejects samples whose signal set differs from the first sample', () => {
    const samples = [
      { tick: 0, v: 0, gear: 1 },
      { tick: 2, v: 1 },
      { tick: 4, v: 1, gear: 1, rpm: 900 },
    ];
    expect(errorsOf(trace({ samples }))).toEqual([
      { path: '$.samples[1].gear', reason: 'missing field' },
      { path: '$.samples[2].rpm', reason: 'unknown field' },
    ]);
  });

  it('parseReferenceTrace throws a DataError with path and reason', () => {
    expect(() => parseReferenceTrace(trace({ stride: 0 }))).toThrowError(DataError);
    expect(() => parseReferenceTrace(trace({ stride: 0 }))).toThrowError(/\$\.stride: /);
  });
});
