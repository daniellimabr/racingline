import { expect, test } from 'vitest';
import { next, seedState } from '../../src/core/rng.ts';

test('mulberry32 seed 1 yields the known first values and uint32 states', () => {
  const a = next(seedState(1));
  const b = next(a.state);
  const c = next(b.state);
  expect([a.value, b.value, c.value]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  expect([a.state, b.state, c.state]).toEqual([1831565814, 3663131627, 1199730144]);
});

test('next is pure: same state gives same draw', () => {
  expect(next(12345)).toEqual(next(12345));
});

test('values stay in [0, 1) and states stay uint32', () => {
  let s = seedState(0xdeadbeef);
  for (let i = 0; i < 5000; i++) {
    const r = next(s);
    expect(r.value >= 0 && r.value < 1).toBe(true);
    expect(Number.isInteger(r.state) && r.state >= 0 && r.state <= 0xffffffff).toBe(true);
    s = r.state;
  }
});

test('seedState rejects non-integer seeds', () => {
  expect(() => seedState(1.5)).toThrow(/seed/);
  expect(() => seedState(Number.NaN)).toThrow(/seed/);
  expect(seedState(-1)).toBe(0xffffffff);
});
