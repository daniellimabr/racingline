// S001-AC-10: malformed input logs are rejected with path + reason.
// S002-T10: version 2 drops the skill setting; version 1 logs are rejected with a clear reason.
import { describe, expect, it } from 'vitest';
import { Checker, DataError } from './check.ts';
import { checkInputLog, parseInputLog, validateInputLog, type InputLog } from './input-log.ts';

const frame = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  throttle: 1,
  brake: 0,
  left: 0,
  right: 0.5,
  shiftUp: false,
  shiftDown: false,
  toggleAuto: false,
  ...over,
});

const log = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 2,
  seed: 12345,
  car: 's15-drift',
  tickSeconds: 1 / 60,
  subSteps: 10,
  frames: [frame(), frame({ throttle: 0, brake: 1, shiftUp: true })],
  ...over,
});

const errorsOf = (v: unknown) => {
  const r = validateInputLog(v);
  if (r.ok) throw new Error('expected the log to be rejected');
  return r.errors;
};

describe('validateInputLog (S001-AC-10)', () => {
  it('accepts a valid v2 log and returns it typed', () => {
    const r = validateInputLog(log());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const typed: InputLog = r.value;
      expect(typed.frames[1]?.shiftUp).toBe(true);
    }
  });

  it('round-trips through JSON (write -> read -> equal)', () => {
    const original = log();
    const back = parseInputLog(JSON.parse(JSON.stringify(original)));
    expect(back).toEqual(original);
  });

  // S003-T5: a run may name its track (absent means the test lot); agreed with Database in
  // docs/sprints/SPRINT-003/mailbox/back-end-to-database-lap-lines.md.
  it('round-trips a run that names its track', () => {
    const original = log({ track: 'interlagos' });
    expect(parseInputLog(JSON.parse(JSON.stringify(original)))).toEqual(original);
  });

  it.each(['', 'Interlagos', 'inter lagos', 7])('rejects the track name %j', (track) => {
    expect(errorsOf(log({ track })).map((e) => e.path)).toEqual(['$.track']);
  });

  it('rejects a track in a v24 version 1 run (those were all recorded on the test lot)', () => {
    const c = new Checker();
    checkInputLog(c, { ...log({ version: 1, skill: 0.4 }), track: 'interlagos' }, '$.inputLog', true);
    expect(c.issues.map((e) => e.path)).toEqual(['$.inputLog.track']);
  });

  it('accepts an empty frame list (a run of zero ticks)', () => {
    expect(validateInputLog(log({ frames: [] })).ok).toBe(true);
  });

  it.each([null, undefined, 'log', 42, [], new Date()])('rejects a non-object root (%s)', (v) => {
    expect(errorsOf(v)[0]?.path).toBe('$');
  });

  it.each([3, 0, '2', null])('rejects version %s', (version) => {
    expect(errorsOf(log({ version }))).toContainEqual(
      expect.objectContaining({ path: '$.version', reason: expect.stringMatching(/version/) }),
    );
  });

  it('rejects a version 1 log with one clear reason (it carries the removed skill setting)', () => {
    const errors = errorsOf(log({ version: 1, skill: 0.4 }));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe('$.version');
    expect(errors[0]?.reason).toMatch(/version 1 .*no longer supported.*skill.*record the run again/);
    expect(() => parseInputLog(log({ version: 1, skill: 0.4 }))).toThrowError(/version 1 .*no longer supported/);
  });

  it('rejects a skill field in a version 2 log', () => {
    expect(errorsOf(log({ skill: 0.4 }))).toContainEqual({ path: '$.skill', reason: 'unknown field' });
  });

  it.each(['version', 'seed', 'car', 'tickSeconds', 'subSteps', 'frames'])(
    'rejects a missing top-level field "%s"',
    (key) => {
      const bad = log();
      delete bad[key];
      expect(errorsOf(bad)).toContainEqual({ path: `$.${key}`, reason: 'missing field' });
    },
  );

  it('rejects an unknown top-level field', () => {
    expect(errorsOf(log({ pause: true }))).toContainEqual({ path: '$.pause', reason: 'unknown field' });
  });

  it.each(['throttle', 'brake', 'left', 'right', 'shiftUp', 'shiftDown', 'toggleAuto'])(
    'rejects a frame missing "%s"',
    (key) => {
      const f = frame();
      delete f[key];
      expect(errorsOf(log({ frames: [frame(), f] }))).toContainEqual({
        path: `$.frames[1].${key}`,
        reason: 'missing field',
      });
    },
  );

  it('rejects an unknown frame field (no combined steer axis in v1)', () => {
    expect(errorsOf(log({ frames: [frame({ steer: 0.2 })] }))).toContainEqual({
      path: '$.frames[0].steer',
      reason: 'unknown field',
    });
  });

  it.each([
    ['seed', '1'],
    ['car', 5],
    ['car', ''],
    ['tickSeconds', '1/60'],
    ['subSteps', '10'],
  ])('rejects a bad type for %s (%s)', (key, value) => {
    expect(errorsOf(log({ [key]: value })).map((e) => e.path)).toContain(`$.${key}`);
  });

  it.each([
    ['throttle', '1'],
    ['brake', true],
    ['shiftUp', 1],
    ['shiftDown', 'false'],
    ['toggleAuto', null],
  ])('rejects a bad frame type for %s (%s)', (key, value) => {
    expect(errorsOf(log({ frames: [frame({ [key]: value })] })).map((e) => e.path)).toContain(
      `$.frames[0].${key}`,
    );
  });

  it.each([1.5, -0.1, Number.NaN, Number.POSITIVE_INFINITY])('rejects throttle %s (outside 0..1 or not finite)', (v) => {
    expect(errorsOf(log({ frames: [frame({ throttle: v })] })).map((e) => e.path)).toContain('$.frames[0].throttle');
  });

  it.each([-1, 1.5, 2 ** 32, Number.NaN])('rejects seed %s (not a uint32)', (seed) => {
    expect(errorsOf(log({ seed })).map((e) => e.path)).toContain('$.seed');
  });

  it('accepts the uint32 seed bounds', () => {
    expect(validateInputLog(log({ seed: 0 })).ok).toBe(true);
    expect(validateInputLog(log({ seed: 2 ** 32 - 1 })).ok).toBe(true);
  });

  it.each([
    ['tickSeconds', 1 / 30],
    ['subSteps', 5],
  ])('rejects a tick setting other than 1/60 s x 10 (%s = %s)', (key, value) => {
    expect(errorsOf(log({ [key]: value })).map((e) => e.path)).toContain(`$.${key}`);
  });

  it.each([{ 0: frame() }, 'frames', null])('rejects frames that are not a plain array (%s)', (frames) => {
    expect(errorsOf(log({ frames })).map((e) => e.path)).toContain('$.frames');
  });

  it('rejects a hole or a non-object frame (frame order is the array index)', () => {
    const holes: unknown[] = [frame()];
    holes[2] = frame();
    expect(errorsOf(log({ frames: holes })).map((e) => e.path)).toContain('$.frames[1]');
    expect(errorsOf(log({ frames: [frame(), [1, 0, 0, 0]] })).map((e) => e.path)).toContain('$.frames[1]');
  });

  it('reports every problem, not only the first', () => {
    const errors = errorsOf(log({ seed: -1, frames: [frame({ brake: 2 }), frame({ left: 'x' })] }));
    expect(errors.map((e) => e.path)).toEqual(['$.seed', '$.frames[0].brake', '$.frames[1].left']);
  });

  it('parseInputLog throws a DataError whose message lists path and reason', () => {
    expect(() => parseInputLog(log({ frames: [frame({ right: 3 })] }))).toThrowError(DataError);
    expect(() => parseInputLog(log({ frames: [frame({ right: 3 })] }))).toThrowError(
      /\$\.frames\[0\]\.right: .*0\.\.1/,
    );
  });
});
