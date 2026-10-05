// One-off download of an OpenStreetMap extract through the Overpass API (ADR-005).
// Never part of the game: run by hand when a track's source data must be refreshed, then commit the
// saved extract and re-run convert-track.mjs. Usage: node tools/tracks/fetch-osm.mjs <query.overpassql> <out.osm.json>
import { readFileSync, writeFileSync } from 'node:fs';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const [queryFile, outFile] = process.argv.slice(2);
if (!queryFile || !outFile) {
  console.error('usage: node tools/tracks/fetch-osm.mjs <query.overpassql> <out.osm.json>');
  process.exit(2);
}
const query = readFileSync(queryFile, 'utf8');

for (let round = 0; round < 4; round++) {
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'RacingLine-trackdata/1.0 (one-off offline extract)' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(120_000),
      });
      const text = await res.text();
      const json = res.ok ? JSON.parse(text) : null; // busy servers answer with an HTML error page
      if (json && Array.isArray(json.elements) && json.elements.length > 0) {
        writeFileSync(outFile, `${JSON.stringify(json, null, 1)}\n`);
        console.log(`saved ${json.elements.length} elements from ${url} to ${outFile}`);
        process.exit(0);
      }
      console.warn(`${url}: HTTP ${res.status}, no usable elements`);
    } catch (e) {
      console.warn(`${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await new Promise((r) => setTimeout(r, 15_000 * (round + 1)));
}
console.error('every Overpass endpoint failed; nothing was written');
process.exit(1);
