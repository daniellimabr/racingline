// Drift table and analysis: every end reason has its v24 wording, and no percentage exceeds 100%.
import { expect, it } from 'vitest';
import type { DriftRecord } from '../../src/sim/index.ts';
import { analysisHtml, driftTableHtml, END_TEXT } from '../../src/ui/drifts.ts';

const rec = (over: Partial<DriftRecord>): DriftRecord => ({
  dur: 1.2, maxB: 48, avgB: 50, kmh: 25, thr: 1.4, lim: 1.3, above: 1.2, sd: 0.9, cs: 0.3, rpm: 3500, cut: 1.5, gear: 2, end: 'spin',
  ...over,
});

it('shows the empty-state text before any drift', () => {
  expect(driftTableHtml([])).toContain('Nenhum drift registrado ainda');
  expect(analysisHtml([])).toBe('Faça alguns drifts para gerar a análise.');
});

it('words every end reason and never shows a percentage above 100%', () => {
  const drifts = (Object.keys(END_TEXT) as DriftRecord['end'][]).map((end, i) => rec({ end, dur: 1 + i }));
  const html = driftTableHtml(drifts) + analysisHtml(drifts);
  for (const text of Object.values(END_TEXT)) expect(html).toContain(text);
  const percents = [...html.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
  expect(percents.length).toBeGreaterThan(10);
  expect(Math.max(...percents)).toBeLessThanOrEqual(100);
});
