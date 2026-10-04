// Car params are data (ADR-001): src/cars/*.json is checked against a flat schema before the sim uses it.
// Generic part of S001-AC-09; Physics Dev supplies the S15 field list (schema object) in S001-T4.
import { Checker, orThrow, type NumberRule, type Result } from './check.ts';

export type FieldSpec = ({ readonly type: 'number' } & NumberRule) | { readonly type: 'string' };
export type CarParamsSchema = Readonly<Record<string, FieldSpec>>;

/** The typed params object a schema describes: every field required, numbers finite. */
export type ParamsOf<S extends CarParamsSchema> = {
  -readonly [K in keyof S]: S[K] extends { readonly type: 'string' } ? string : number;
};

export function validateCarParams<S extends CarParamsSchema>(schema: S, v: unknown): Result<ParamsOf<S>> {
  const c = new Checker();
  if (!c.object(v, '$')) return c.result(v);
  c.keys(v, '$', Object.keys(schema));
  for (const [key, spec] of Object.entries(schema)) {
    if (!Object.hasOwn(v, key)) continue;
    if (spec.type === 'string') c.string(v[key], `$.${key}`);
    else c.number(v[key], `$.${key}`, spec);
  }
  return c.result<ParamsOf<S>>(v);
}

/** Like validateCarParams, but throws a DataError naming the file, each field and the reason. */
export function parseCarParams<S extends CarParamsSchema>(schema: S, v: unknown, file: string): ParamsOf<S> {
  return orThrow(`Car params ${file}`, validateCarParams(schema, v));
}
