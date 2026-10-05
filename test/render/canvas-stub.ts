// Canvas 2D stand-in for render tests: every method call is recorded with its arguments, and
// properties store what is written (so fillStyle, font and the like read back).
import type { CanvasFactory } from '../../src/render/lot.ts';

export interface Recording {
  ctx: CanvasRenderingContext2D;
  calls: [string, unknown[]][];
  /** Every fillText call as [text, x, y], in order. */
  texts(): [string, number, number][];
}

export function recordingContext(): Recording {
  const calls: [string, unknown[]][] = [];
  const props: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(props, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return (s: string) => ({ width: 6 * String(s).length });
      return (...args: unknown[]) => void calls.push([String(k), args]);
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const texts = () =>
    calls.filter(([k]) => k === 'fillText').map(([, a]) => [String(a[0]), Number(a[1]), Number(a[2])] as [string, number, number]);
  return { ctx, calls, texts };
}

export const factoryFor = (ctx: CanvasRenderingContext2D): CanvasFactory => (width, height) => ({ width, height, getContext: () => ctx });
