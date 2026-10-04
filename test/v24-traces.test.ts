// S001-T2: v24 reference-trace extractor. Runs the frozen prototype's own sim headless and
// locks its output as fixtures for the port (S001-AC-06). Same engine => exact equality.
import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import {
  FIXTURE_DIR, MODES, SCENARIOS, V24_PATH, createV24, defaultSkill, extractScript, mulberry32, renderScenario,
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
    type Sample = Record<string, number>;
    const run = (n: string) => JSON.parse(renderScenario(byName(n)).trace).samples as Sample[];
    const max = (xs: Sample[], k: string) => Math.max(...xs.map((x) => Math.abs(x[k]!)));
    const DRIFT = MODES.indexOf('drift'), SPIN = MODES.indexOf('spin');
    expect(max(run('straight-accel'), 'gear')).toBeGreaterThanOrEqual(1); // at least one auto upshift
    const brake = run('braking');
    expect(max(brake, 'v')).toBeGreaterThan(15);
    expect(brake[brake.length - 1]!.v).toBeLessThan(0.5);
    expect(brake.some((x) => x.b === 1)).toBe(true);
    const drift = run('drift-countersteer');
    expect(drift.some((x) => x.mode === DRIFT && Math.sign(x.st!) === Math.sign(x.beta!))).toBe(true);
    expect(drift.some((x) => x.mode === SPIN)).toBe(false);
    expect(drift[drift.length - 1]!.driftsDone).toBeGreaterThanOrEqual(1);
    const shifts = run('manual-shift');
    expect(shifts.some((x) => x.auto === 0)).toBe(true);
    expect(shifts[shifts.length - 1]!.auto).toBe(1);
    const corner = run('steady-corner').filter((x) => x.tt! > 8.5);
    expect(max(corner, 'r') - Math.min(...corner.map((x) => Math.abs(x.r!)))).toBeLessThan(0.08); // on/off steering ripple
    expect(max(corner, 'v') - Math.min(...corner.map((x) => x.v!))).toBeLessThan(0.2);
  });

  test('replaying the committed input log alone reproduces the committed trace exactly', () => {
    for (const s of SCENARIOS) {
      const trace = JSON.parse(readFileSync(`${FIXTURE_DIR}/${s.name}.trace.json`, 'utf8')), log = trace.inputLog;
      expect(Object.keys(trace)).toEqual(['version', 'source', 'scenario', 'inputLog', 'stride', 'samples']);
      expect(log).toMatchObject({ version: 1, seed: s.seed, skill: 0.4, car: 's15-drift', tickSeconds: 1 / 60, subSteps: 10 });
      const v = createV24({ seed: log.seed, skill: log.skill });
      const got: unknown[] = [];
      log.frames.forEach((f: typeof NEUTRAL, i: number) => {
        v.tick(f);
        if ((i + 1) % trace.stride === 0) got.push(v.sample(i + 1));
      });
      expect(JSON.parse(JSON.stringify(got)), s.name).toEqual(trace.samples);
    }
  });

  test('committed fixtures match a fresh regeneration byte for byte', () => {
    for (const s of SCENARIOS) {
      const out = renderScenario(s);
      expect(readFileSync(`${FIXTURE_DIR}/${s.name}.trace.json`, 'utf8'), s.name).toBe(out.trace);
    }
  });

  test('fixtures stay small (under 1 MB in total) and every sample signal is a finite number', () => {
    const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(SCENARIOS.length);
    expect(files.reduce((n, f) => n + statSync(`${FIXTURE_DIR}/${f}`).size, 0)).toBeLessThan(1_000_000);
    for (const f of files) {
      const t = JSON.parse(readFileSync(`${FIXTURE_DIR}/${f}`, 'utf8'));
      const keys = Object.keys(t.samples[0]).join();
      for (const s of t.samples) {
        expect(Object.keys(s).join(), f).toBe(keys);
        for (const x of Object.values(s)) expect(Number.isFinite(x), f).toBe(true);
      }
    }
  });

  test('running the extractor leaves the frozen prototype untouched', () => {
    renderScenario(byName('straight-accel'));
    expect(sha(V24_PATH)).toBe(V24_SHA256);
  });
});
