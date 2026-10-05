// Car params are data (ADR-001): src/cars/*.json is checked against a flat schema before the sim uses it.
// The caller (Physics Dev, src/sim/params.ts) supplies the per-car physics fields; every car file also
// gets CAR_BASE_FIELDS: identity (S002-T3) and optional aero fields (S002-AC-01/02). Field names are
// agreed with Physics Dev in docs/sprints/SPRINT-002/mailbox/physics-dev-to-database-aero-fields.md.
import { Checker, orThrow, type NumberRule, type Result } from './check.ts';

/** A number field is required unless it has a `default`, which fills it when the key is absent. */
export type FieldSpec =
  | ({ readonly type: 'number'; readonly default?: number } & NumberRule)
  | { readonly type: 'string'; readonly pattern?: RegExp; readonly patternHint?: string };
export type CarParamsSchema = Readonly<Record<string, FieldSpec>>;

/** The typed params object a schema describes: every field present after validation, numbers finite. */
export type ParamsOf<S extends CarParamsSchema> = {
  -readonly [K in keyof S]: S[K] extends { readonly type: 'string' } ? string : number;
};

/** Car ids: lowercase letters and digits in groups joined by single dashes, e.g. "s15-drift", "gt3". */
export const CAR_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Fields every car file carries, on top of the caller's schema (these win on a name clash). */
export const CAR_BASE_FIELDS = {
  id: { type: 'string', pattern: CAR_ID_PATTERN, patternHint: 'lowercase letters, digits and single dashes (like "s15-drift")' },
  name: { type: 'string' }, // shown on the HUD, e.g. "S15 Drift", "GT3"
  // Aero: absent means no aero (0), so older car files keep their behavior. F = 0.5 * airDensity * area * v^2.
  downforceArea: { type: 'number', min: 0, max: 20, default: 0 }, // m2, lift coefficient x frontal area (ClA)
  dragArea: { type: 'number', min: 0, max: 10, default: 0 }, // m2, drag coefficient x frontal area (CdA)
  aeroBalanceFront: { type: 'number', min: 0, max: 1, default: 0 }, // share of downforce on the front axle
  airDensity: { type: 'number', min: 0, max: 2, default: 1.225 }, // kg/m3, sea level at 15 C
} as const satisfies CarParamsSchema;

export type CarBase = ParamsOf<typeof CAR_BASE_FIELDS>;

export function validateCarParams<S extends CarParamsSchema>(schema: S, v: unknown): Result<ParamsOf<S> & CarBase> {
  const c = new Checker();
  if (!c.object(v, '$')) return c.result(v);
  const fields: CarParamsSchema = { ...schema, ...CAR_BASE_FIELDS };
  const entries = Object.entries(fields);
  const optional = entries.filter(([, s]) => s.type === 'number' && s.default !== undefined).map(([k]) => k);
  c.keys(v, '$', entries.map(([k]) => k).filter((k) => !optional.includes(k)), optional);
  const out: Record<string, unknown> = { ...v };
  for (const [key, spec] of entries) {
    if (!Object.hasOwn(v, key)) {
      if (spec.type === 'number' && spec.default !== undefined) out[key] = spec.default;
      continue;
    }
    if (spec.type === 'number') c.number(v[key], `$.${key}`, spec);
    else if (c.string(v[key], `$.${key}`) && spec.pattern && !spec.pattern.test(v[key])) {
      c.fail(`$.${key}`, `expected ${spec.patternHint ?? `a string matching ${spec.pattern}`}, got ${JSON.stringify(v[key])}`);
    }
  }
  // Without a stated balance, all downforce would silently land on the rear axle.
  if (typeof v.downforceArea === 'number' && v.downforceArea > 0 && !Object.hasOwn(v, 'aeroBalanceFront')) {
    c.fail('$.aeroBalanceFront', 'required when downforceArea is above 0');
  }
  return c.result<ParamsOf<S> & CarBase>(out);
}

/** Like validateCarParams, but throws a DataError naming the file, each field and the reason. */
export function parseCarParams<S extends CarParamsSchema>(schema: S, v: unknown, file: string): ParamsOf<S> & CarBase {
  return orThrow(`Car params ${file}`, validateCarParams(schema, v));
}
