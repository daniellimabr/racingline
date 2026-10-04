// S001-AC-08: uneven frame times advance the same ticks as even frames for equal elapsed time.
import { describe, expect, test } from 'vitest';
import { advance, MAX_FRAME } from '../../src/core/accumulator.ts';

function run(frames: number[]) {
  let acc = 0;
  let ticks = 0;
  let alpha = 0;
  for (const f of frames) {
    const r = advance(acc, f);
    acc = r.acc;
    ticks += r.ticks;
    alpha = r.alpha;
  }
  return { ticks, alpha };
}

describe('S001-AC-08 fixed-timestep accumulator', () => {
  test('5/40/16 ms frames equal three ~20.33 ms frames and one 61 ms frame', () => {
    const uneven = run([0.005, 0.04, 0.016]);
    expect(uneven.ticks).toBe(3);
    expect(run([0.061 / 3, 0.061 / 3, 0.061 / 3]).ticks).toBe(3);
    expect(run([0.061]).ticks).toBe(3);
  });

  test('about ten seconds of jittery frames give floor(elapsed * 60) ticks, like steady 60 Hz', () => {
    const jitter = [0.005, 0.04, 0.016, 0.0123, 0.0277, 0.009, 0.0303, 0.017, 0.0124, 0.0023];
    const loop = jitter.reduce((a, b) => a + b, 0); // 0.172 s per pattern
    const frames: number[] = [];
    for (let i = 0; i < Math.round(10 / loop); i++) frames.push(...jitter);
    const elapsed = Math.round(10 / loop) * 0.172;
    const expected = Math.floor(elapsed * 60 + 1e-9);
    expect(run(frames).ticks).toBe(expected);
    expect(run(Array.from({ length: 600 }, () => 1 / 60)).ticks).toBe(600);
  });

  test('alpha is the leftover fraction of a tick', () => {
    const r = advance(0, 0.025);
    expect(r.ticks).toBe(1);
    expect(r.alpha).toBeCloseTo(0.5, 3);
  });

  test('clamps long frames to avoid a spiral of death', () => {
    expect(advance(0, 5).ticks).toBe(Math.floor(MAX_FRAME * 60));
  });

  test('ignores negative, NaN and infinite frame times', () => {
    for (const f of [-1, Number.NaN, Infinity, -Infinity]) {
      const r = advance(0, f);
      expect(r.ticks).toBe(f === Infinity ? Math.floor(MAX_FRAME * 60) : 0);
    }
  });
});
