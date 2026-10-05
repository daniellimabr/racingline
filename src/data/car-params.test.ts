// S001-AC-09 (generic part): car params are data; invalid or missing fields are rejected with a clear error.
// Physics Dev adds the S15 field list and cars/params.test.ts on top of this validator in T4.
import { describe, expect, it } from 'vitest';
import { DataError } from './check.ts';
import { CAR_BASE_FIELDS, parseCarParams, validateCarParams, type CarBase, type CarParamsSchema, type ParamsOf } from './car-params.ts';

const SAMPLE = {
  id: { type: 'string' },
  name: { type: 'string' },
  mass: { type: 'number', min: 1 },
  gears: { type: 'number', min: 1, max: 8, integer: true },
  grip: { type: 'number', min: 0, max: 2 },
  drag: { type: 'number' },
} as const satisfies CarParamsSchema;

const params = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'sample',
  name: 'Sample',
  mass: 1240,
  gears: 6,
  grip: 1,
  drag: -0.3,
  ...over,
});

/** What the validator adds to every car file that leaves the aero fields out (S002-AC-02). */
const NO_AERO = { downforceArea: 0, dragArea: 0, aeroBalanceFront: 0, airDensity: 1.225 };

const errorsOf = (v: unknown) => {
  const r = validateCarParams(SAMPLE, v);
  if (r.ok) throw new Error('expected the params to be rejected');
  return r.errors;
};

describe('validateCarParams (S001-AC-09 generic part)', () => {
  it('accepts valid params and types them from the schema', () => {
    const r = validateCarParams(SAMPLE, params());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const typed: ParamsOf<typeof SAMPLE> = r.value;
      expect(typed.mass + typed.gears).toBe(1246);
      expect(typed.id).toBe('sample');
    }
  });

  it('round-trips through JSON (write -> read -> equal)', () => {
    const original = params({ downforceArea: 2, dragArea: 0.8, aeroBalanceFront: 0.4, airDensity: 1.2 });
    expect(parseCarParams(SAMPLE, JSON.parse(JSON.stringify(original)), 'sample.json')).toEqual(original);
  });

  it('names one-sided bounds in the reason', () => {
    expect(errorsOf(params({ mass: 0.5 }))).toEqual([{ path: '$.mass', reason: 'expected a value >= 1, got 0.5' }]);
  });

  it('accepts the range bounds inclusively', () => {
    expect(validateCarParams(SAMPLE, params({ gears: 8, grip: 0 })).ok).toBe(true);
  });

  it.each([null, [], 'x'])('rejects a non-object file (%s)', (v) => {
    expect(errorsOf(v)[0]?.path).toBe('$');
  });

  it.each(Object.keys(SAMPLE))('rejects a missing field "%s"', (key) => {
    const bad = params();
    delete bad[key];
    expect(errorsOf(bad)).toEqual([{ path: `$.${key}`, reason: 'missing field' }]);
  });

  it('rejects an unknown field (catches typos in the JSON)', () => {
    expect(errorsOf(params({ masss: 1 }))).toEqual([{ path: '$.masss', reason: 'unknown field' }]);
  });

  it.each([
    ['mass', '1240'],
    ['mass', Number.NaN],
    ['drag', Number.POSITIVE_INFINITY],
    ['mass', 0],
    ['grip', 2.5],
    ['gears', 5.5],
    ['gears', 9],
    ['id', 3],
    ['id', ''],
  ])('rejects %s = %s', (key, value) => {
    expect(errorsOf(params({ [key]: value })).map((e) => e.path)).toEqual([`$.${key}`]);
  });

  it('parseCarParams names the file, the field and the reason', () => {
    expect(() => parseCarParams(SAMPLE, params({ grip: 3 }), 'sample.json')).toThrowError(DataError);
    expect(() => parseCarParams(SAMPLE, params({ grip: 3 }), 'sample.json')).toThrowError(
      /sample\.json[\s\S]*\$\.grip: expected a value in 0\.\.2, got 3/,
    );
  });

  it('fills the base fields left out with their defaults, without changing the input', () => {
    const input = params();
    const r = validateCarParams(SAMPLE, input);
    expect(r.ok && r.value).toEqual({ ...params(), ...NO_AERO });
    expect(input).toEqual(params());
    if (r.ok) {
      const typed: CarBase = r.value;
      expect(typed.downforceArea + typed.dragArea + typed.aeroBalanceFront).toBe(0);
    }
  });

  it('lets a caller schema declare its own optional number with a default', () => {
    const withDefault = { ...SAMPLE, ballast: { type: 'number', min: 0, default: 25 } } as const satisfies CarParamsSchema;
    const r = validateCarParams(withDefault, params());
    expect(r.ok && r.value.ballast).toBe(25);
    expect(validateCarParams(withDefault, params({ ballast: 10 })).ok && 10).toBe(10);
    expect(validateCarParams(withDefault, params({ ballast: -1 })).ok).toBe(false);
  });

  it('every number default lies inside its own range', () => {
    for (const [key, spec] of Object.entries(CAR_BASE_FIELDS)) {
      if (spec.type !== 'number' || !('default' in spec)) continue;
      expect(spec.default, key).toBeGreaterThanOrEqual(spec.min);
      expect(spec.default, key).toBeLessThanOrEqual(spec.max);
    }
  });

  it('base fields win over a caller field with the same name (the id keeps its pattern)', () => {
    expect(errorsOf(params({ id: 'Sample Car' }))).toEqual([
      { path: '$.id', reason: 'expected lowercase letters, digits and single dashes (like "s15-drift"), got "Sample Car"' },
    ]);
  });
});
