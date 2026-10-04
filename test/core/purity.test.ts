// src/core must stay deterministic: no wall clock, no Math.random, no DOM (ADR-001).
import { expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../../src/core/', import.meta.url);
const FORBIDDEN = /\bMath\.random\b|\bDate\b|\bperformance\b|\bwindow\b|\bdocument\b|\brequestAnimationFrame\b/;

test('no file in src/core uses Math.random, Date, performance or the DOM', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    const code = readFileSync(new URL(f, dir), 'utf8').replace(/\/\/.*$/gm, '');
    expect(code, f).not.toMatch(FORBIDDEN);
  }
});
