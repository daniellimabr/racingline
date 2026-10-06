// S003-AC-06 (first half): the offline converter rebuilds src/tracks/interlagos.json byte for byte
// from the saved OpenStreetMap extract (ADR-005).
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertTrack } from '../../tools/tracks/convert-track.mjs';

const at = (p: string): string => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const EXTRACT = at('tools/tracks/interlagos.osm.json');
const OUTPUT = at('src/tracks/interlagos.json');
const SCRIPT = at('tools/tracks/convert-track.mjs');

describe('track conversion (S003-AC-06)', () => {
  it('turns the saved extract into exactly the committed track file', () => {
    const text = convertTrack('interlagos', JSON.parse(readFileSync(EXTRACT, 'utf8')));
    expect(text).toBe(readFileSync(OUTPUT, 'utf8'));
  });

  it('gives the same bytes when the script runs on its own, with no network', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-track-'));
    try {
      const out = join(dir, 'interlagos.json');
      execFileSync(process.execPath, [SCRIPT, 'interlagos', EXTRACT, out], { stdio: 'pipe' });
      expect(readFileSync(out).equals(readFileSync(OUTPUT))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses an extract without the circuit, with a clear error', () => {
    expect(() => convertTrack('interlagos', { elements: [] })).toThrow(/circuit relation 6781071/);
  });

  it('refuses an extract whose straight to straighten is missing, with a clear error (S004-AC-07)', () => {
    const osm = JSON.parse(readFileSync(EXTRACT, 'utf8')) as { elements: { tags?: Record<string, string> }[] };
    for (const e of osm.elements) if (e.tags?.name === 'Reta Oposta') delete e.tags.name;
    expect(() => convertTrack('interlagos', osm)).toThrow(/no lap way is named "Reta Oposta"/);
  });

  it('refuses an unknown track id', () => {
    expect(() => convertTrack('monza', { elements: [] })).toThrow(/unknown track "monza"/);
  });
});
