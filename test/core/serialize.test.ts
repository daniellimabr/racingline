// S001-AC-04: serialize mid-run -> deserialize -> continue => same final hash as the uninterrupted run.
import { describe, expect, test } from 'vitest';
import { createState, replay } from '../../src/core/sim.ts';
import { canonicalJson, hashState } from '../../src/core/hash.ts';
import { deserialize, serialize } from '../../src/core/serialize.ts';
import { scriptedLog, testCar, testCarStep, testParams, type TestCar } from './helpers.ts';

const log = scriptedLog(500);

describe('S001-AC-04 serialize and resume', () => {
  test('resuming from a serialized mid-run state reaches the same final hash', () => {
    const full = replay(log, createState(99, testCar()), testParams, testCarStep).state;
    const mid = replay(log.slice(0, 237), createState(99, testCar()), testParams, testCarStep).state;
    const text = serialize(mid);
    expect(typeof text).toBe('string');
    const resumed = replay(log.slice(237), deserialize<TestCar>(text), testParams, testCarStep).state;
    expect(hashState(resumed)).toBe(hashState(full));
    expect(resumed).toEqual(full);
  });

  test('round trip keeps negative zero and exact doubles', () => {
    const s = createState(5, { a: -0, b: 0.1 + 0.2, c: 1e-300, d: [1 / 3] });
    const back = deserialize<typeof s.car>(serialize(s));
    expect(Object.is(back.car.a, -0)).toBe(true);
    expect(back).toEqual(s);
    expect(hashState(back)).toBe(hashState(s));
  });
});

describe('deserialize validation', () => {
  const bad: Array<[string, string]> = [
    ['not json', 'not json {'],
    ['not an object', '[1,2]'],
    ['wrong version', '{"v":2,"tick":0,"rng":1,"car":{}}'],
    ['negative tick', '{"v":1,"tick":-1,"rng":1,"car":{}}'],
    ['fractional tick', '{"v":1,"tick":1.5,"rng":1,"car":{}}'],
    ['rng not uint32', '{"v":1,"tick":0,"rng":4294967296,"car":{}}'],
    ['missing car', '{"v":1,"tick":0,"rng":1}'],
  ];
  for (const [name, text] of bad) {
    test(`rejects ${name}`, () => expect(() => deserialize(text)).toThrow(/SimState/));
  }
});

describe('canonical JSON and hash', () => {
  test('key order does not change the hash; values do', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe('{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}');
    const s1 = { v: 1 as const, tick: 1, rng: 2, car: { x: 1, y: 2 } };
    const s2 = { car: { y: 2, x: 1 }, rng: 2, tick: 1, v: 1 as const };
    expect(hashState(s1)).toBe(hashState(s2));
    expect(hashState(s1)).not.toBe(hashState({ ...s1, car: { x: 1, y: 2.0000000001 } }));
    expect(hashState(s1)).toMatch(/^[0-9a-f]{16}$/);
  });

  test('FNV-1a 64 matches the reference vectors', async () => {
    const { fnv1a64 } = await import('../../src/core/hash.ts');
    expect(fnv1a64('')).toBe('cbf29ce484222325');
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
    expect(fnv1a64('foobar')).toBe('85944171f73967e8');
  });

  test('rejects values that JSON cannot represent exactly', () => {
    for (const v of [Number.NaN, Infinity, undefined, () => 1, 10n]) {
      expect(() => canonicalJson({ v })).toThrow(/canonical/);
    }
  });
});
