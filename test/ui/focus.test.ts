// S003-AC-14 (focus): the game area shows a visible keyboard focus outline, and game keys work only while
// it has focus (intended since S002-T11: keys typed elsewhere on the page never drive the car).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KeyboardDevice, type KeyEventLike, type KeyTarget } from '../../src/input/index.ts';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');

class FakeTarget implements KeyTarget {
  private map = new Map<string, Set<(e: KeyEventLike) => void>>();
  addEventListener(type: string, fn: (e: KeyEventLike) => void): void {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: KeyEventLike) => void): void {
    this.map.get(type)?.delete(fn);
  }
  fire(type: string, code = ''): void {
    for (const fn of this.map.get(type) ?? []) fn({ code, preventDefault() {} });
  }
}

describe('game area focus outline', () => {
  const canvas = html.match(/<canvas[^>]*id="cv"[^>]*>/)?.[0] ?? '';

  it('the game area is in the tab order', () => {
    expect(canvas).toMatch(/tabindex="0"/);
  });

  it('no inline style hides the outline (an inline outline:none beats the stylesheet)', () => {
    expect(canvas).not.toMatch(/outline\s*:\s*(none|0)/);
  });

  it('a stylesheet rule draws a solid outline of at least 2 px whenever the game area has focus', () => {
    const rule = html.match(/#cv:focus(?![-\w])[^{]*\{([^}]*)\}/)?.[1] ?? '';
    const m = rule.match(/outline\s*:\s*(\d+)px\s+solid\s+(#[0-9a-f]{3,6})/i);
    expect(m, 'outline rule for #cv:focus').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(2);
  });
});

describe('game keys only while the game area has focus', () => {
  it('keys reach the car only from the game area, and leaving it releases them', () => {
    const area = new FakeTarget(), page = new FakeTarget();
    const kb = new KeyboardDevice(area);
    page.fire('keydown', 'KeyW');
    expect(kb.sample().throttle).toBe(0);
    area.fire('keydown', 'KeyW');
    expect(kb.sample().throttle).toBe(1);
    area.fire('blur');
    expect(kb.sample().throttle).toBe(0);
  });

  it('the game listens for keys on the game area only, never on the whole page', () => {
    expect(main).toMatch(/new KeyboardDevice\(cv\b/);
    expect(main).not.toMatch(/(window|document)\.addEventListener\(\s*['"]key/);
  });
});
