// S001-T2: v24 reference-trace extractor. Runs the frozen prototype's own sim headless and
// locks its output as fixtures for the port (S001-AC-06). Same engine => exact equality.
import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import {
  FIXTURE_DIR, SCENARIOS, V24_PATH, createV24, defaultSkill, extractScript, mulberry32, renderScenario,
} from '../tools/v24-traces.mjs';

const V24_SHA256 = '2f07c3ae431ddceb055268bfd608b7e624d3005ae31993fbaaf057fa535ee239';
const NEUTRAL = { throttle: 0, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false };
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const byName = (n: string) => {
  const s = SCENARIOS.find((x) => x.name === n);
  if (!s) throw new Error('missing scenario ' + n);
  return s;
};

describe('mulberry32 (shared with src/core/rng.ts)', () => {
  test('golden values for seed 1 and seed 0xDEADBEEF', () => {
    const a = mulberry32(1), b = mulberry32(0xdeadbeef);
    expect([a(), a(), a()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
    expect([b(), b(), b()]).toEqual([0.9413696140982211, 0.26719574979506433, 0.772033357527107]);
  });
  test('values stay in [0, 1)', () => {
    const r = mulberry32(42);
    for (let i = 0; i < 10000; i++) { const v = r(); expect(v >= 0 && v < 1).toBe(true); }
  });
});

describe('v24 headless harness', () => {
  const html = readFileSync(V24_PATH, 'utf8');

  test('extracts the single inline script and the default skill from the frozen HTML', () => {
    const src = extractScript(html);
    expect(src).toContain('function phys(s,dt,skill)');
    expect(src).toContain('function step(dt)');
    expect(defaultSkill(html)).toBe(0.4);
  });

  test('only the wobble draws a random number: exactly one draw per tick, smoke code never runs', () => {
    const v = createV24({ seed: 7, skill: 0.4 });
    const hard = { ...NEUTRAL, throttle: 1, right: 1 };
    for (let i = 0; i < 300; i++) v.tick(hard); // wheelspin + slip: v24 smoke would draw here
    expect(v.randomCalls()).toBe(300);
    expect(v.emitCalls()).toBe(300);
  });

  test('rejects analog pedal values, because v24 keys are on or off', () => {
    const v = createV24({ seed: 1, skill: 0.4 });
    expect(() => v.tick({ ...NEUTRAL, throttle: 0.5 })).toThrow(/0 or 1/);
    expect(() => v.tick({ ...NEUTRAL, shiftUp: 1 as unknown as boolean })).toThrow(/boolean/);
  });

  test('shift buttons go through the v24 key handler (manual shift turns auto off)', () => {
    const v = createV24({ seed: 1, skill: 0.4 });
    v.tick({ ...NEUTRAL, shiftUp: true });
    expect(v.state().gear).toBe(1);
    expect(v.state().auto).toBe(false);
    for (let i = 0; i < 30; i++) v.tick(NEUTRAL); // wait out the 0.3 s shift cooldown
    v.tick({ ...NEUTRAL, toggleAuto: true });
    expect(v.state().auto).toBe(true);
  });
});

describe('reference traces', () => {
  test('cover the agreed scenarios', () => {
    expect(SCENARIOS.map((s) => s.name)).toEqual(
      ['straight-accel', 'braking', 'steady-corner', 'drift-countersteer', 'wobble', 'manual-shift']);
  });

  test('same seed gives a byte-identical trace', () => {
    const s = byName('drift-countersteer');
    expect(renderScenario(s).trace).toBe(renderScenario(s).trace);
  });

  test('a different seed changes the wobble and only wobble-driven values', () => {
    const s = byName('wobble');
    const a = JSON.parse(renderScenario(s).trace), b = JSON.parse(renderScenario({ ...s, seed: s.seed + 1 }).trace);
    const last = (t: { samples: Record<string, unknown>[] }) => t.samples[t.samples.length - 1]!;
    expect(last(a).wob).not.toBe(last(b).wob);
    expect(last(a).y).not.toBe(last(b).y);
    expect(last(a).gear).toBe(last(b).gear);
  });

  test('scenarios exercise what they are named after', () => {
    const run = (n: string) => JSON.parse(renderScenario(byName(n)).trace).samples as Record<string, number | string | boolean>[];
    const max = (xs: Record<string, number | string | boolean>[], k: string) => Math.max(...xs.map((x) => Math.abs(x[k] as number)));
    expect(max(run('straight-accel'), 'gear')).toBeGreaterThanOrEqual(2);
    expect(run('braking').some((x) => x.lockF === true)).toBe(true);
    expect(run('drift-countersteer').some((x) => x.mode === 'drift')).toBe(true);
    expect(run('manual-shift').some((x) => x.auto === false)).toBe(true);
    const corner = run('steady-corner').filter((x) => (x.tt as number) > 6);
    expect(max(corner, 'r') - Math.min(...corner.map((x) => Math.abs(x.r as number)))).toBeLessThan(0.15);
  });

  test('committed fixtures match a fresh regeneration byte for byte', () => {
    for (const s of SCENARIOS) {
      const out = renderScenario(s);
      expect(readFileSync(`${FIXTURE_DIR}/${s.name}.input.json`, 'utf8'), s.name).toBe(out.inputLog);
      expect(readFileSync(`${FIXTURE_DIR}/${s.name}.trace.json`, 'utf8'), s.name).toBe(out.trace);
    }
  });

  test('fixtures stay small (under 1 MB in total) and hold only finite numbers', () => {
    const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(SCENARIOS.length * 2);
    expect(files.reduce((n, f) => n + statSync(`${FIXTURE_DIR}/${f}`).size, 0)).toBeLessThan(1_000_000);
    for (const f of files) expect(readFileSync(`${FIXTURE_DIR}/${f}`, 'utf8')).not.toMatch(/null|NaN|Infinity/);
  });

  test('running the extractor leaves the frozen prototype untouched', () => {
    renderScenario(byName('straight-accel'));
    expect(sha(V24_PATH)).toBe(V24_SHA256);
  });
});
