// Shared, dependency-free building blocks for the data validators in src/data.
// Every problem is reported as { path, reason } with JSON-style paths such as "$.frames[3].throttle".

export interface Issue {
  readonly path: string;
  readonly reason: string;
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly Issue[] };

/** Most issues listed in an error message; the full list stays on `errors`. */
const MAX_LISTED = 20;

export class DataError extends Error {
  readonly errors: readonly Issue[];
  constructor(what: string, errors: readonly Issue[]) {
    const listed = errors.slice(0, MAX_LISTED).map((e) => `  ${e.path}: ${e.reason}`);
    if (errors.length > MAX_LISTED) listed.push(`  ... and ${errors.length - MAX_LISTED} more`);
    super(`${what} is invalid (${errors.length} problem${errors.length === 1 ? '' : 's'}):\n${listed.join('\n')}`);
    this.name = 'DataError';
    this.errors = errors;
  }
}

/** Returns the value of a successful result, or throws a DataError naming `what`. */
export function orThrow<T>(what: string, result: Result<T>): T {
  if (!result.ok) throw new DataError(what, result.errors);
  return result.value;
}

export interface NumberRule {
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
}

const show = (v: unknown): string => {
  if (typeof v === 'string') return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}...` : v);
  if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) return String(v);
  return Array.isArray(v) ? 'an array' : `a ${typeof v}`;
};

/** Collects issues while a validator walks an unknown value. */
export class Checker {
  readonly issues: Issue[] = [];

  fail(path: string, reason: string): false {
    this.issues.push({ path, reason });
    return false;
  }

  /** A plain JSON object (not null, not an array, not a class instance). */
  object(v: unknown, path: string): v is Record<string, unknown> {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const proto: unknown = Object.getPrototypeOf(v);
      if (proto === Object.prototype || proto === null) return true;
    }
    return this.fail(path, `expected an object, got ${show(v)}`);
  }

  /** Reports missing required keys and unknown keys. Returns true when the key set is exact. */
  keys(obj: Record<string, unknown>, path: string, required: readonly string[], optional: readonly string[] = []): boolean {
    const before = this.issues.length;
    for (const k of required) if (!Object.hasOwn(obj, k)) this.fail(`${path}.${k}`, 'missing field');
    for (const k of Object.keys(obj)) {
      if (!required.includes(k) && !optional.includes(k)) this.fail(`${path}.${k}`, 'unknown field');
    }
    return this.issues.length === before;
  }

  /** A finite number, optionally integer and within [min, max] (inclusive). */
  number(v: unknown, path: string, rule: NumberRule = {}): v is number {
    if (typeof v !== 'number') return this.fail(path, `expected a number, got ${show(v)}`);
    if (!Number.isFinite(v)) return this.fail(path, `expected a finite number, got ${show(v)}`);
    if (rule.integer === true && !Number.isInteger(v)) return this.fail(path, `expected an integer, got ${v}`);
    const { min, max } = rule;
    if (min !== undefined && max !== undefined && (v < min || v > max)) {
      return this.fail(path, `expected a value in ${min}..${max}, got ${v}`);
    }
    if (min !== undefined && v < min) return this.fail(path, `expected a value >= ${min}, got ${v}`);
    if (max !== undefined && v > max) return this.fail(path, `expected a value <= ${max}, got ${v}`);
    return true;
  }

  /** A non-empty string. */
  string(v: unknown, path: string): v is string {
    if (typeof v !== 'string') return this.fail(path, `expected a string, got ${show(v)}`);
    if (v.length === 0) return this.fail(path, 'expected a non-empty string');
    return true;
  }

  boolean(v: unknown, path: string): v is boolean {
    return typeof v === 'boolean' || this.fail(path, `expected true or false, got ${show(v)}`);
  }

  array(v: unknown, path: string): v is unknown[] {
    return Array.isArray(v) || this.fail(path, `expected an array, got ${show(v)}`);
  }

  /** Exact match for a fixed constant (version tags, source ids, tick settings). */
  equals(v: unknown, expected: string | number, path: string, what: string): boolean {
    return v === expected || this.fail(path, `unsupported ${what} ${show(v)} (expected ${show(expected)})`);
  }

  /** Closes the walk: ok with the (now proven) value, or every collected issue. */
  result<T>(value: unknown): Result<T> {
    return this.issues.length === 0 ? { ok: true, value: value as T } : { ok: false, errors: this.issues };
  }
}
