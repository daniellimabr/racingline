// Offline converter: saved OpenStreetMap extract -> game track file (ADR-005). No network access.
// Usage: node tools/tracks/convert-track.mjs <track id> [extract.osm.json] [out.json]
// Defaults: tools/tracks/<id>.osm.json -> src/tracks/<id>.json. Same extract in, same bytes out
// (test/tracks/convert.test.ts). Output shape: src/data/track.ts, checked by test/tracks/track-schema.test.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CREDIT = '© OpenStreetMap contributors';

/** Per-track choices the map data does not hold. Every estimate is named in `estimates` (ADR-005). */
const TRACKS = {
  interlagos: {
    name: 'Interlagos',
    relation: 6781071, // type=circuit "Autódromo José Carlos Pace"; its unnamed-role members are the lap in order
    timingNode: 13826424126, // the relation's "finish" node (OSM name "Finish Line")
    width: 13,
    spawnBack: 20,
    surfaces: { asphalt: { grip: 1, drag: 0 }, kerb: { grip: 0.9, drag: 0 }, grass: { grip: 0.55, drag: 0.08 } },
    road: 'asphalt',
    verge: [{ surface: 'kerb', width: 1 }],
    outside: 'grass',
    estimates: {
      width: 'The width is 13 m everywhere because the map data has no width for this circuit; the real track is about 12 to 15 m wide.',
      sectors: 'The three sectors are equal thirds of the lap, because the official timing split points were not found in a source we can cite.',
      surfaces: 'A 1 m kerb runs along both edges all the way round with grass beyond; real kerbs sit at corners and some run-off is paved.',
      surfaceValues: 'Kerb drag 0 and grass drag 0.08 per m/s (about 0.45 g of slowing at 200 km/h), with the grips kept at 0.9 and 0.55, were chosen by Daniel on 2026-10-05 (option B, realistic).',
      startLine: 'The start line is the map data finish line, which is the timing line; the separate grid start line is not used.',
      spawn: 'The car starts 20 m behind the start line, on the centerline, facing the driving direction.',
      projection: 'Positions use a flat map centred on the start line with WGS84 local radii, which is accurate to a few centimetres over the circuit.',
    },
  },
};

const WGS84_A = 6378137, WGS84_E2 = 0.00669437999014;
const cm = (v) => Math.round(v * 100) / 100 || 0; // `|| 0` turns -0 into 0
const rad6 = (v) => Math.max(-Math.PI, Math.min(Math.PI, Math.round(v * 1e6) / 1e6));

/** Cumulative distance at each point plus the closed-loop length as the last entry. */
function distances(pts) {
  const out = [0];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    out.push(out[i] + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  return out;
}

/** Same rule as centerlineAt in src/data/track.ts: the piece that starts at or before s. */
function at(pts, cum, s) {
  let i = 0;
  while (i < pts.length - 1 && cum[i + 1] <= s) i++;
  const p = pts[i], q = pts[(i + 1) % pts.length], seg = cum[i + 1] - cum[i], t = (s - cum[i]) / seg;
  return { x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t, dx: (q[0] - p[0]) / seg, dy: (q[1] - p[1]) / seg, w: p[2] + (q[2] - p[2]) * t };
}

/** A line across the track at s: `a` on the driver's left, which is (dy, -dx) with y pointing south. */
function lineAt(pts, cum, s) {
  const c = at(pts, cum, s), lx = c.dy * (c.w / 2), ly = -c.dx * (c.w / 2);
  return { s: cm(s), a: [cm(c.x + lx), cm(c.y + ly)], b: [cm(c.x - lx), cm(c.y - ly)] };
}

/** Ordered node ids of the lap, starting at the timing node, closing node not repeated. */
function lapNodes(cfg, byId) {
  const rel = byId.get(`relation/${cfg.relation}`);
  if (!rel) throw new Error(`the extract has no circuit relation ${cfg.relation}`);
  const ids = [];
  for (const m of rel.members.filter((x) => x.type === 'way' && x.role === '')) {
    const way = byId.get(`way/${m.ref}`);
    if (!way) throw new Error(`the extract is missing way ${m.ref} of relation ${cfg.relation}`);
    if (ids.length > 0 && way.nodes[0] !== ids.at(-1)) throw new Error(`way ${m.ref} does not continue from the previous way`);
    ids.push(...(ids.length > 0 ? way.nodes.slice(1) : way.nodes));
  }
  if (ids.length < 4 || ids[0] !== ids.at(-1)) throw new Error(`relation ${cfg.relation} does not form a closed lap`);
  ids.pop();
  const start = ids.indexOf(cfg.timingNode);
  if (start < 0) throw new Error(`timing node ${cfg.timingNode} is not on the lap`);
  return [...ids.slice(start), ...ids.slice(0, start)];
}

/** Collapses arrays of plain numbers onto one line, so each point is one line of the file. */
const format = (obj) => `${JSON.stringify(obj, null, 2).replace(/\[\s+(-?[\d.e+-]+(?:,\s+-?[\d.e+-]+)*)\s+\]/g, (_, inner) => `[${inner.split(/,\s+/).join(', ')}]`)}\n`;

/** Builds the track file text for `id` from a parsed Overpass JSON extract. */
export function convertTrack(id, osm) {
  const cfg = Object.hasOwn(TRACKS, id) ? TRACKS[id] : undefined;
  if (!cfg) throw new Error(`unknown track "${id}" (known: ${Object.keys(TRACKS).join(', ')})`);
  const byId = new Map((osm?.elements ?? []).map((e) => [`${e.type}/${e.id}`, e]));
  const ids = lapNodes(cfg, byId);
  const nodes = ids.map((n) => {
    const node = byId.get(`node/${n}`);
    if (!node) throw new Error(`the extract is missing node ${n}`);
    return node;
  });

  // Local flat map around the timing node: x east, y south, metres.
  const lat0 = nodes[0].lat, lon0 = nodes[0].lon, phi = (lat0 * Math.PI) / 180;
  const q = 1 - WGS84_E2 * Math.sin(phi) ** 2;
  const north = (WGS84_A * (1 - WGS84_E2)) / q ** 1.5, east = (WGS84_A / Math.sqrt(q)) * Math.cos(phi);
  const k = Math.PI / 180;
  const pts = [];
  for (const n of nodes) {
    const p = [cm((n.lon - lon0) * k * east), cm(-(n.lat - lat0) * k * north), cfg.width];
    const last = pts.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p); // nodes closer than 1 cm merge
  }
  while (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();

  const cum = distances(pts), length = cum[pts.length];
  const sp = at(pts, cum, length - cfg.spawnBack);
  const track = {
    schema: 'track',
    v: 1,
    id,
    name: cfg.name,
    credit: CREDIT,
    source: { osm: `relation/${cfg.relation}`, timestamp: osm.osm3s?.timestamp_osm_base ?? 'unknown', license: 'ODbL-1.0' },
    estimates: cfg.estimates,
    length: cm(length),
    points: pts,
    startLine: lineAt(pts, cum, 0),
    sectorLines: [0, length / 3, (2 * length) / 3].map((s) => lineAt(pts, cum, s)),
    surfaces: cfg.surfaces,
    road: cfg.road,
    verge: cfg.verge,
    outside: cfg.outside,
    spawn: { x: cm(sp.x), y: cm(sp.y), h: rad6(Math.atan2(sp.dy, sp.dx)) },
  };
  return format(track);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [id, extract, out] = process.argv.slice(2);
  if (!id) {
    console.error('usage: node tools/tracks/convert-track.mjs <track id> [extract.osm.json] [out.json]');
    process.exit(2);
  }
  const src = extract ?? fileURLToPath(new URL(`./${id}.osm.json`, import.meta.url));
  const dst = out ?? fileURLToPath(new URL(`../../src/tracks/${id}.json`, import.meta.url));
  writeFileSync(dst, convertTrack(id, JSON.parse(readFileSync(src, 'utf8'))));
  console.log(`wrote ${dst}`);
}
