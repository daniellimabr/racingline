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
    width: 26, // Daniel 2026-10-06 (S004): twice the Sprint 003 estimate of 13 m
    spawnBack: 20,
    // Lap ways (by OSM name) that the real circuit has dead straight: their end nodes stay, the nodes
    // in between move onto the line joining them (the map drawing wobbles by up to 2.9 m).
    straighten: ['Reta Oposta'],
    // Corners in driving order. Each apex window [from, to] (m along the lap, chosen by eye to bracket one
    // apex) gets one apex kerb found from the curvature; braking points come from the model below.
    // Names: the usual corner names; OSM names some ways differently (it calls Laranjinha "Esse" and this
    // "Café" bend part of Subida dos Boxes). Arquibancadas is left out: it bends less than 1/250 m here.
    corners: [
      { name: 'S do Senna', apexes: [[330, 430], [450, 520]] },
      { name: 'Curva do Sol', apexes: [[525, 800]] },
      { name: 'Descida do Lago', apexes: [[1395, 1495], [1560, 1710]] },
      { name: 'Ferradura', apexes: [[2010, 2120], [2140, 2230]] },
      { name: 'Laranjinha', apexes: [[2300, 2428]] },
      { name: 'Pinheirinho', apexes: [[2428, 2580]] },
      { name: 'Bico de Pato', apexes: [[2740, 2850]] },
      { name: 'Mergulho', apexes: [[2905, 3100]] },
      { name: 'Junção', apexes: [[3255, 3340]] },
      { name: 'Café', apexes: [[3395, 3450]] },
    ],
    // Apex kerb: curvature smoothed over +-15 m; the stretch where it is at least half its peak, kept to
    // 20..80 m around the peak, on the inside of the turn.
    apexKerb: { width: 2, smooth: 15, share: 0.5, minLength: 20, maxLength: 80 },
    // Braking model, a reference car like the GT3 without downforce (grip 1.54, ADR-004 top speed 284 km/h).
    brake: { grip: 1.54, accel: 4, topSpeed: 284 / 3.6, usableWidth: 24, turnInShare: 0.25, minDistance: 20 },
    surfaces: { asphalt: { grip: 1, drag: 0 }, kerb: { grip: 0.9, drag: 0 }, grass: { grip: 0.55, drag: 0.08 } },
    road: 'asphalt',
    verge: [{ surface: 'kerb', width: 1 }],
    outside: 'grass',
    estimates: {
      width: 'The width is 26 m everywhere, twice the Sprint 003 estimate of 13 m, by Daniel\'s choice of 2026-10-06; the map data has no width and the real track is about 12 to 15 m wide.',
      straightened: 'The Reta Oposta is drawn dead straight between the two ends of its map way, because the real straight is straight and the map drawing wobbled by up to 2.9 m.',
      sectors: 'The three sectors are equal thirds of the lap, because the official timing split points were not found in a source we can cite.',
      surfaces: 'A 1 m kerb runs along both edges all the way round with grass beyond, and a wider kerb sits at each apex; some real run-off is paved.',
      apexKerbs: 'Each apex kerb is 2 m wide on the inside of its corner, twice the 1 m edge kerb to match the doubled width; it covers the stretch where the centreline curvature, smoothed over 30 m, is at least half its peak in that corner, kept to 20 to 80 m.',
      brakePoints: 'Braking points come from a simple model of a GT3 without downforce: corner speed from 1.54 g on a racing line using 24 m of the width, 4 m/s2 of acceleration up to 284 km/h, 1.54 g of braking that ends at turn-in; corners needing under 20 m of braking get none.',
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

const wrapAngle = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const G = 9.81;

/** The lap ways of the circuit relation, in driving order. */
function lapWays(cfg, byId) {
  const rel = byId.get(`relation/${cfg.relation}`);
  if (!rel) throw new Error(`the extract has no circuit relation ${cfg.relation}`);
  return rel.members.filter((x) => x.type === 'way' && x.role === '').map((m) => {
    const way = byId.get(`way/${m.ref}`);
    if (!way) throw new Error(`the extract is missing way ${m.ref} of relation ${cfg.relation}`);
    return way;
  });
}

/** Moves the points strictly between the end nodes of each named lap way onto the line joining those ends. */
function straighten(cfg, byId, pts, pid) {
  for (const name of cfg.straighten ?? []) {
    const way = lapWays(cfg, byId).find((w) => w.tags?.name === name);
    if (!way) throw new Error(`no lap way is named "${name}" (straighten)`);
    const i = pid.indexOf(way.nodes[0]), j = pid.indexOf(way.nodes.at(-1));
    if (i < 0 || j < i + 2) throw new Error(`cannot straighten "${name}": its ends are not on the lap in driving order with points between them`);
    const [ax, ay] = pts[i], ex = pts[j][0] - ax, ey = pts[j][1] - ay, len2 = ex * ex + ey * ey;
    for (let k = i + 1; k < j; k++) {
      const t = ((pts[k][0] - ax) * ex + (pts[k][1] - ay) * ey) / len2;
      pts[k] = [cm(ax + ex * t), cm(ay + ey * t), pts[k][2]];
    }
  }
}

/** Signed centerline curvature at every whole metre of the lap, 1/m, from the heading change over +-smooth m. Negative turns left (y south). */
function curvature(pts, cum, smooth) {
  const lap = cum[pts.length];
  const heading = (s) => {
    const c = at(pts, cum, ((s % lap) + lap) % lap);
    return Math.atan2(c.dy, c.dx);
  };
  return Array.from({ length: Math.ceil(lap) }, (_, s) => wrapAngle(heading(s + smooth) - heading(s - smooth)) / (2 * smooth));
}

/**
 * Apex kerbs and braking points from the curvature (estimates, ADR-005). Per apex window: the peak curvature
 * is the apex and its sign the inside; the kerb covers the stretch at or above `share` of the peak. Corner
 * speed: the racing line through a turn of angle a with radius R and usable width w has radius about
 * R + w / (1 - cos(a / 2)), taken at `grip` g. Approach speed: the previous corner's exit speed plus `accel`
 * over the gap, up to `topSpeed`. Braking at `grip` g ends at turn-in (curvature at `turnInShare` of the peak).
 */
function corners(cfg, pts, cum) {
  const K = cfg.apexKerb, B = cfg.brake, lap = cum[pts.length];
  const k = curvature(pts, cum, K.smooth);
  const apexes = [];
  for (const corner of cfg.corners ?? []) {
    for (const [a, b] of corner.apexes) {
      if (!(a >= 0 && b > a && b < k.length)) throw new Error(`corner "${corner.name}": apex window ${a}..${b} m is not inside the lap`);
      let turn = 0, peak = a;
      for (let s = a; s <= b; s++) turn += k[s];
      const sign = Math.sign(turn);
      for (let s = a; s <= b; s++) if (k[s] * sign > k[peak] * sign) peak = s;
      const top = k[peak] * sign;
      const reach = (share) => {
        let f = peak, e = peak;
        while (f > a && k[f - 1] * sign >= share * top) f--;
        while (e < b && k[e + 1] * sign >= share * top) e++;
        return [f, e];
      };
      let [from, to] = reach(K.share);
      if (to - from > K.maxLength) {
        from = Math.max(from, Math.min(peak - K.maxLength / 2, to - K.maxLength));
        to = from + K.maxLength;
      } else if (to - from < K.minLength) {
        const grow = K.minLength - (to - from);
        from -= Math.floor(grow / 2);
        to += Math.ceil(grow / 2);
      }
      const [turnIn, exit] = reach(B.turnInShare);
      const line = 1 / top + B.usableWidth / (1 - Math.cos(Math.abs(turn) / 2));
      apexes.push({ name: corner.name, side: sign < 0 ? 'left' : 'right', from, to, turnIn, exit, vc: Math.min(B.topSpeed, Math.sqrt(B.grip * G * line)) });
    }
  }
  const n = apexes.length, exitSpeed = apexes.map((x) => x.vc), approach = new Array(n).fill(B.topSpeed);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n; i++) {
      const p = (i - 1 + n) % n, gap = (apexes[i].turnIn - apexes[p].exit + lap) % lap;
      approach[i] = Math.min(B.topSpeed, Math.sqrt(exitSpeed[p] ** 2 + 2 * B.accel * gap));
      exitSpeed[i] = Math.min(approach[i], apexes[i].vc);
    }
  }
  const brakePoints = [];
  apexes.forEach((x, i) => {
    const d = (approach[i] ** 2 - x.vc ** 2) / (2 * B.grip * G);
    if (d < B.minDistance) return;
    const name = brakePoints.some((bp) => bp.name === x.name) ? `${x.name} (second apex)` : x.name;
    brakePoints.push({ s: Math.round(((x.turnIn - d) % lap + lap) % lap), name });
  });
  return {
    apexKerbs: apexes.map(({ from, to, side }) => ({ from, to, side, width: K.width })).sort((p, q) => p.from - q.from),
    brakePoints: brakePoints.sort((p, q) => p.s - q.s),
  };
}

/** Ordered node ids of the lap, starting at the timing node, closing node not repeated. */
function lapNodes(cfg, byId) {
  const ids = [];
  for (const way of lapWays(cfg, byId)) {
    if (ids.length > 0 && way.nodes[0] !== ids.at(-1)) throw new Error(`way ${way.id} does not continue from the previous way`);
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
  const pts = [], pid = []; // pid: the OSM node id of each kept point
  nodes.forEach((n, i) => {
    const p = [cm((n.lon - lon0) * k * east), cm(-(n.lat - lat0) * k * north), cfg.width];
    const last = pts.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) { // nodes closer than 1 cm merge
      pts.push(p);
      pid.push(ids[i]);
    }
  });
  while (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) {
    pts.pop();
    pid.pop();
  }
  straighten(cfg, byId, pts, pid);

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
    ...corners(cfg, pts, cum),
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
