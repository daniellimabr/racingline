#!/usr/bin/env node
// S001-T2: v24 reference-trace extractor.
// Runs the frozen prototype's OWN script (read from prototype/prototype-v24.html at runtime, never
// copied) inside a Node vm context with minimal DOM stubs, feeds InputFrame v1 sequences at a fixed
// 1/60 s per step(dt) call, and writes test/fixtures/v24/<scenario>.trace.json (input log inline).
//   node tools/v24-traces.mjs          (regenerate all fixtures; npm run traces)
// Formats: docs/sprints/SPRINT-001/mailbox/database-to-physics-dev-trace-format.md (outside the repo).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

export const V24_PATH = fileURLToPath(new URL('../prototype/prototype-v24.html', import.meta.url));
export const FIXTURE_DIR = fileURLToPath(new URL('../test/fixtures/v24', import.meta.url));
export const TICK = 1 / 60;
export const SAMPLE_EVERY = 6; // one trace sample per 0.1 s
const CAR = 's15-drift';
const SUB_STEPS = 10; // v24 sim(): n=10 phys() calls per step

/** mulberry32: identical to src/core/rng.ts (back-end, S001-T3). State is a uint32 seed. */
export function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function extractScript(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 1) throw new Error(`expected 1 inline script in v24, found ${scripts.length}`);
  return scripts[0][1];
}

/** v24 has no skill constant: the sim reads the "Experiência" slider, whose HTML default is used. */
export function defaultSkill(html) {
  const m = html.match(/<input id="sk"[^>]*\bvalue="([0-9.]+)"/);
  if (!m) throw new Error('v24 skill slider default not found');
  return Number(m[1]);
}

// Callable, chainable no-op: stands in for every canvas 2D context v24 touches at load time.
function inert() {
  const p = new Proxy(function () {}, {
    get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : p),
    set: () => true,
    apply: () => p,
  });
  return p;
}

const KEY_CODES = { throttle: 'KeyW', brake: 'KeyS', left: 'KeyA', right: 'KeyD' };
const BUTTON_CODES = [['shiftUp', 'Period'], ['shiftDown', 'Comma'], ['toggleAuto', 'KeyM']]; // applied in this order

function checkFrame(f) {
  if (!f || typeof f !== 'object') throw new Error('input frame must be an object');
  for (const k of Object.keys(KEY_CODES))
    if (f[k] !== 0 && f[k] !== 1) throw new Error(`input frame ${k} must be 0 or 1 (v24 keys are digital), got ${f[k]}`);
  for (const [k] of BUTTON_CODES)
    if (typeof f[k] !== 'boolean') throw new Error(`input frame ${k} must be a boolean, got ${f[k]}`);
}

/** Boots a fresh v24 instance. Each tick: buttons, then held keys, then v24 step(1/60). */
export function createV24({ seed, skill, html = readFileSync(V24_PATH, 'utf8') }) {
  const listeners = {};
  const el = (id) => ({
    id, value: String(skill), textContent: '', innerHTML: '', width: 0, height: 0,
    getContext: inert, focus() {},
    addEventListener(type, fn) { if (id === 'cv') listeners[type] = fn; },
  });
  const els = {};
  const ctx = vm.createContext({
    document: { getElementById: (id) => (els[id] ??= el(id)), createElement: () => el('offscreen') },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0, // the render loop never starts: no draw()/drawTel() runs
    matchMedia: () => ({ matches: false }),
  });
  vm.runInContext(extractScript(html), ctx, { filename: 'prototype-v24.html' });

  // Randomness: only step()'s wobble may draw. emit() (smoke/dust, cosmetic, never read by the sim)
  // is the only other Math.random user in step(); it is replaced by a counting no-op.
  const rng = mulberry32(seed);
  let draws = 0, emits = 0;
  vm.runInContext('Math', ctx).random = () => { draws++; return rng(); };
  ctx.__emit = () => { emits++; };
  const api = vm.runInContext(
    'emit = __emit; ({ step, predict, tractionState, S: () => S, cur: () => cur, drifts: () => drifts, PX })', ctx);

  const press = (code) => listeners.keydown({ code, repeat: false, preventDefault() {} });
  return {
    tick(frame) {
      checkFrame(frame);
      for (const [k, code] of BUTTON_CODES) if (frame[k]) press(code);
      for (const [k, code] of Object.entries(KEY_CODES))
        (frame[k] ? listeners.keydown : listeners.keyup)({ code, repeat: false, preventDefault() {} });
      api.step(TICK);
    },
    state: () => api.S(),
    randomCalls: () => draws,
    emitCalls: () => emits,
    sample(tick) {
      const S = api.S(), ts = api.tractionState(), pr = api.predict(skill), end = pr.pts[pr.pts.length - 1];
      const raw = { tick };
      for (const k of SAMPLE_FIELDS) raw[k] = S[k];
      Object.assign(raw, {
        mode: MODES.indexOf(S.mode),
        haloRisk: ts.risk, haloRear: ts.rear, haloP: ts.p, haloWarn: ts.warn, haloRising: ts.rising,
        predSlip: pr.slip, predEndX: end[0], predEndY: end[1],
        drifting: api.cur() !== null, driftsDone: api.drifts().length,
      });
      // ReferenceTrace v1 (Database): every signal is a finite number, yes/no stored as 0/1.
      const out = {};
      for (const [k, x] of Object.entries(raw)) {
        const n = typeof x === 'boolean' ? (x ? 1 : 0) : x;
        if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`v24 signal ${k} is not a finite number: ${x}`);
        out[k] = n;
      }
      return out;
    },
  };
}

/** v24 S.mode strings, stored in traces as their index (mode 0 = grip). */
export const MODES = ['', 'front', 'rear', 'drift', 'spin'];

// v24 state fields the port must reproduce (render-only wheel angles wF/wR and the derivative
// memories pF0/pR0/b0 are left out; the latter equal uFs/uRs/|beta| after every tick).
const SAMPLE_FIELDS = [
  'tt', 'x', 'y', 'h', 'vx', 'vy', 'r', 'v', 'beta', 't', 'b', 'st', 'delta', 'wob',
  'af', 'ar', 'axp', 'u', 'lim', 'wspin', 'spinR', 'lockF', 'useF', 'useR', 'uFs', 'uRs',
  'dFs', 'dRs', 'dB', 'riskF', 'riskR', 'rateF', 'rateR',
  'gear', 'auto', 'rpm', 'groundRpm', 'cut', 'shiftT', 'shiftCd', 'off',
];

// ---- Scenarios. input(i, S) returns the keys for tick i; it may read the v24 state S (a scripted
// on/off "driver"), but only the resulting frames are recorded, so replays never need the driver.
const NEUTRAL = { throttle: 0, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false };
const tk = (s) => Math.round(s * 60);
const on = (x) => (x ? 1 : 0);
// Steering towards a target steer position with on/off keys (dead band avoids chatter).
const steerTo = (S, target) => ({ right: on(S.st < target - 0.04), left: on(S.st > target + 0.04) });

export const SCENARIOS = [
  { name: 'straight-accel', seed: 2401, seconds: 8, about: 'Full throttle from rest in a straight line, automatic gearbox.',
    input: () => ({ throttle: 1 }) },
  { name: 'braking', seed: 2402, seconds: 7, about: 'Full throttle for 4 s, then full brake to a stop (no front lock-up on a straight at skill 0.4).',
    input: (i) => (i < tk(4) ? { throttle: 1 } : { brake: 1 }) },
  { name: 'steady-corner', seed: 2403, seconds: 12,
    about: 'Throttle for 3 s, then hold about 12 m/s and a third of the steering travel to the right.',
    input: (i, S) => (i < tk(3) ? { throttle: 1 } : { throttle: on(S.v < 12), ...steerTo(S, 0.3) }) },
  { name: 'drift-countersteer', seed: 2404, seconds: 9,
    about: 'Build speed, feint right then left under power, countersteer to the slide angle on throttle, then release.',
    input: (i, S) => (i < tk(2.5) ? { throttle: 1 }
      : i < tk(3.3) ? { throttle: 1, right: 1 }
      : i < tk(4.2) ? { throttle: 1, left: 1 }
      : i < tk(7) ? { throttle: on(Math.abs(S.beta) < 0.9), ...steerTo(S, Math.max(-1, Math.min(1, S.beta))) }
      : {}) },
  { name: 'wobble', seed: 2405, seconds: 10, about: 'Straight line at speed with no steering, so only the steering wobble moves the car sideways.',
    input: (i) => ({ throttle: on(i < tk(5)) }) },
  { name: 'manual-shift', seed: 2406, seconds: 7, about: 'Throttle with manual up, up, down shifts, then automatic switched back on.',
    input: (i) => ({ throttle: 1, shiftUp: i === tk(1) || i === tk(2.5), shiftDown: i === tk(4), toggleAuto: i === tk(5) }) },
];

// JSON with header keys one per line and array items one per line (diff-friendly, compact).
function toJson(obj) {
  const parts = Object.entries(obj).map(([k, v]) =>
    Array.isArray(v) && v.length && typeof v[0] === 'object'
      ? `${JSON.stringify(k)}:[\n${v.map((x) => JSON.stringify(x)).join(',\n')}\n]`
      : `${JSON.stringify(k)}:${JSON.stringify(v)}`);
  return `{\n${parts.join(',\n')}\n}\n`;
}

/** Runs one scenario; returns the input-log and trace file contents. */
export function renderScenario(sc, html = readFileSync(V24_PATH, 'utf8')) {
  const skill = defaultSkill(html);
  const v = createV24({ seed: sc.seed, skill, html });
  const frames = [], samples = [], n = tk(sc.seconds);
  if (n % SAMPLE_EVERY !== 0) throw new Error(`${sc.name}: tick count ${n} must be a multiple of the stride`);
  for (let i = 0; i < n; i++) {
    const f = { ...NEUTRAL, ...sc.input(i, v.state()) };
    frames.push(f);
    v.tick(f);
    if ((i + 1) % SAMPLE_EVERY === 0) samples.push(v.sample(i + 1));
  }
  if (v.randomCalls() !== frames.length) throw new Error(`${sc.name}: expected one wobble draw per tick`);
  // ReferenceTrace v1 as validated by src/data/trace.ts (Database, S001-T5): exactly these keys.
  const inputLog = toJson({ version: 1, seed: sc.seed, skill, car: CAR, tickSeconds: TICK, subSteps: SUB_STEPS, frames });
  const head = toJson({ version: 1, source: 'prototype-v24', scenario: sc.name });
  const tail = toJson({ stride: SAMPLE_EVERY, samples });
  return { trace: `${head.slice(0, -3)},\n"inputLog":${inputLog.slice(0, -1)},\n${tail.slice(2)}` };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const sc of SCENARIOS) {
    const { trace } = renderScenario(sc);
    writeFileSync(`${FIXTURE_DIR}/${sc.name}.trace.json`, trace);
    console.log(`${sc.name}: ${trace.length} bytes`);
  }
}
