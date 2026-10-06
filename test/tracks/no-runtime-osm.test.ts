// S003-AC-06 (second half): the game never calls OpenStreetMap at runtime; track data ships in the
// bundle (ADR-005). Scans every file under src, code and data alike.
import { expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const CONVERTER = fileURLToPath(new URL('../../tools/tracks/convert-track.mjs', import.meta.url));

/** Any OpenStreetMap or Overpass service name (the credit "© OpenStreetMap contributors" stays allowed). */
const OSM_SERVICE = /overpass|nominatim|openstreetmap\.(org|fr|de)|\bosm\.org|tile\.openstreetmap|openstreetmap\.org\/api/i;
/** Absolute web addresses other than this machine (ADR-002 telemetry goes to 127.0.0.1 only). */
const REMOTE_URL = /\b(?:https?|wss?):\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/i;

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));

test('no file in src names an OpenStreetMap service or a remote address', () => {
  const all = files(SRC);
  expect(all.some((f) => f.endsWith('interlagos.json'))).toBe(true);
  for (const f of all) {
    const text = readFileSync(f, 'utf8');
    expect(text, f).not.toMatch(OSM_SERVICE);
    expect(text, f).not.toMatch(REMOTE_URL);
  }
});

test('the converter works offline: no network module, fetch or remote address', () => {
  const code = readFileSync(CONVERTER, 'utf8');
  expect(code).not.toMatch(/\bfetch\s*\(|node:(?:https?|net|dns|tls)\b|XMLHttpRequest|WebSocket/);
  expect(code).not.toMatch(REMOTE_URL);
});
