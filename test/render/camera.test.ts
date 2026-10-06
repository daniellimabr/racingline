// S003-AC-13 (camera half): as the car moves across Interlagos and the lot, the camera keeps it on screen,
// and only the track pieces near the car are drawn.
import { describe, expect, it } from 'vitest';
import { centerlineAt } from '../../src/data/track.ts';
import { TRACKS } from '../../src/tracks/index.ts';
import { followCamera, MAX_ZOOM, MIN_ZOOM, toScreen, viewRect } from '../../src/render/camera.ts';
import { SCREEN_H, SCREEN_W } from '../../src/render/scene.ts';
import { buildTrackArt, drawTrackMinimap, MINI, trackMiniDot, visibleSegments } from '../../src/render/track.ts';
import { buildLot, GRASS_TILE, grassTiles, LOT_MINI, lotMiniDot, WORLD_H, WORLD_W } from '../../src/render/lot.ts';
import { drawScene } from '../../src/render/scene.ts';
import { createView } from '../../src/render/view.ts';
import { createCar, createSimParams, loadCarParams, TEST_LOT } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import { factoryFor, recordingContext } from './canvas-stub.ts';

const PX = 9, MARGIN = 40;
const interlagos = TRACKS.find((t) => t.id === 'interlagos')!;

function onScreen(sx: number, sy: number): boolean {
  return sx >= MARGIN && sx <= SCREEN_W - MARGIN && sy >= MARGIN && sy <= SCREEN_H - MARGIN;
}

describe('follow camera', () => {
  it('keeps the car on screen at any speed, heading, slip and zoom', () => {
    for (const v of [0, 10, 40, 70, 95, 140]) {
      for (let h = -Math.PI; h <= Math.PI; h += Math.PI / 8) {
        for (const beta of [0, 0.6, -1.2]) {
          for (const zoom of [MIN_ZOOM, 1, MAX_ZOOM]) {
            const car = { x: 120, y: -40, h, beta, v };
            const cam = followCamera(car, PX, zoom);
            const [sx, sy] = toScreen(cam, car.x * PX, car.y * PX);
            expect(onScreen(sx, sy), `v ${v} h ${h.toFixed(2)} beta ${beta} zoom ${zoom}: ${sx}, ${sy}`).toBe(true);
          }
        }
      }
    }
  });

  it('looks ahead along the travel direction, so the car sits behind the screen centre', () => {
    const cam = followCamera({ x: 0, y: 0, h: 0, beta: 0, v: 30 }, PX, 1);
    const [sx, sy] = toScreen(cam, 0, 0);
    expect(sx).toBeLessThan(SCREEN_W / 2);
    expect(sy).toBeCloseTo(SCREEN_H / 2, 6);
  });

  it('view rectangle covers exactly the screen plus the margin, in world pixels', () => {
    const cam = followCamera({ x: 10, y: 20, h: 0, beta: 0, v: 0 }, PX, 0.5);
    const r = viewRect(cam, 0);
    const [ax, ay] = toScreen(cam, r.x0, r.y0), [bx, by] = toScreen(cam, r.x1, r.y1);
    expect([ax, ay, bx, by].map((n) => Math.round(n))).toEqual([0, 0, SCREEN_W, SCREEN_H]);
    const wide = viewRect(cam, 10);
    expect(wide.x0).toBeLessThan(r.x0);
    expect(wide.y1).toBeGreaterThan(r.y1);
  });
});

// S004-AC-10 (lot camera): the car can roll 200 to 360 m past the lot's pavement onto grass. The camera
// follows it there, the grass beyond the lot picture is textured so the motion shows, the lot picture is
// untouched on the pavement, and the minimap dot stays inside the minimap pointing back towards the lot.
describe('following the car on the lot', () => {
  const L = TEST_LOT, m = (px: number) => px / L.scale;
  const midX = m((L.x0 + L.x1) / 2), midY = m((L.y0 + L.y1) / 2);
  const far: [string, number, number][] = [
    ['west', m(L.x0) - 360, midY], ['east', m(L.x1) + 360, midY], ['north', midX, m(L.y0) - 360], ['south', midX, m(L.y1) + 360],
    ['north-east', m(L.x1) + 250, m(L.y0) - 250], ['south-west', m(L.x0) - 200, m(L.y1) + 200],
  ];
  const inside = (x: number, y: number, tiles: [number, number][]): boolean =>
    (x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H) || tiles.some(([tx, ty]) => x >= tx && x < tx + GRASS_TILE && y >= ty && y < ty + GRASS_TILE);

  it.each(far)('keeps the car on screen and the grass textured %s of the lot', (_, x, y) => {
    for (const v of [0, 20]) {
      for (const zoom of [MIN_ZOOM, MAX_ZOOM]) {
        const cam = followCamera({ x, y, h: 1, beta: 0, v }, PX, zoom);
        const [sx, sy] = toScreen(cam, x * PX, y * PX);
        expect(onScreen(sx, sy)).toBe(true);
        // Every spot on screen is either the lot picture or a grass tile.
        const r = viewRect(cam, 0), tiles = grassTiles(r);
        for (let i = 0; i <= 10; i++) {
          for (let j = 0; j <= 10; j++) {
            const wx = r.x0 + ((r.x1 - r.x0) * i) / 10, wy = r.y0 + ((r.y1 - r.y0) * j) / 10;
            expect(inside(wx, wy, tiles), `${wx}, ${wy}`).toBe(true);
          }
        }
        expect(tiles.length).toBeLessThan(40);
      }
    }
  });

  it('adds no grass tiles over the lot picture while the car is on the pavement', () => {
    const cam = followCamera({ x: m(L.startX), y: m(L.startY), h: 0, beta: 0, v: 0 }, PX, MAX_ZOOM);
    expect(grassTiles(viewRect(cam, 0))).toEqual([]);
    for (const [tx, ty] of grassTiles({ x0: -500, y0: -500, x1: WORLD_W + 500, y1: WORLD_H + 500 })) {
      const overlaps = tx < WORLD_W && tx + GRASS_TILE > 0 && ty < WORLD_H && ty + GRASS_TILE > 0;
      expect(overlaps, `${tx}, ${ty}`).toBe(false);
    }
  });

  it('keeps the minimap dot inside the minimap, at the edge towards the car', () => {
    const box = { x0: LOT_MINI.x, y0: LOT_MINI.y, x1: LOT_MINI.x + LOT_MINI.w, y1: LOT_MINI.y + LOT_MINI.h };
    for (const [name, x, y] of far) {
      const d = lotMiniDot(x * PX, y * PX);
      expect(d.inside, name).toBe(false);
      expect(d.x).toBeGreaterThanOrEqual(box.x0);
      expect(d.x).toBeLessThanOrEqual(box.x1);
      expect(d.y).toBeGreaterThanOrEqual(box.y0);
      expect(d.y).toBeLessThanOrEqual(box.y1);
    }
    const east = lotMiniDot((m(L.x1) + 360) * PX, midY * PX), west = lotMiniDot((m(L.x0) - 360) * PX, midY * PX);
    expect(east.x).toBeGreaterThan(west.x);
    const home = lotMiniDot(L.startX, L.startY);
    expect(home.inside).toBe(true);
    expect(home.x).toBeCloseTo(LOT_MINI.x + L.startX * (LOT_MINI.w / WORLD_W), 6);
  });

  it('draws the grass tiles and the lot picture when the car is far out on the grass', () => {
    const rec = recordingContext();
    const lot = buildLot(factoryFor(rec.ctx), L);
    rec.calls.length = 0;
    const params = createSimParams(loadCarParams(s15, 's15-drift.json'));
    const car = { ...createCar(params), x: m(L.x1) + 360, y: midY, v: 10 };
    drawScene(rec.ctx, { car, params, view: createView(1), lot, paused: false, dt: 1 / 60, track: null, lap: null });
    const images = rec.calls.filter(([k]) => k === 'drawImage').map(([, a]) => a[0]);
    expect(images.filter((im) => im === lot.grass).length).toBeGreaterThan(0);
  });
});

describe('driving across Interlagos', () => {
  const art = buildTrackArt(interlagos, PX);

  it('keeps the car on screen all the way round and draws only the pieces near it', () => {
    let maxDrawn = 0;
    for (let s = 0; s < interlagos.length; s += 20) {
      const at = centerlineAt(interlagos, s);
      const car = { x: at.x, y: at.y, h: Math.atan2(at.dy, at.dx), beta: 0, v: 75 };
      const cam = followCamera(car, PX, MIN_ZOOM);
      const [sx, sy] = toScreen(cam, car.x * PX, car.y * PX);
      expect(onScreen(sx, sy), `s ${s}`).toBe(true);
      const drawn = visibleSegments(art, viewRect(cam, 0));
      expect(drawn.length, `s ${s}: the piece under the car is drawn`).toBeGreaterThan(0);
      maxDrawn = Math.max(maxDrawn, drawn.length);
    }
    // 296 pieces in the lap; near the car only a small share is ever on screen.
    expect(art.segments.length).toBe(interlagos.points.length);
    expect(maxDrawn).toBeLessThan(art.segments.length / 3);
  });

  it('draws nothing of the track when the camera is far from it', () => {
    const cam = followCamera({ x: 50_000, y: 50_000, h: 0, beta: 0, v: 0 }, PX, 1);
    expect(visibleSegments(art, viewRect(cam, 0))).toEqual([]);
  });

  // S004-T10 (blind test): straight on at S do Senna for 18 to 30 s the dot left the minimap, about 85 px below it.
  const box = { x0: MINI.x, y0: MINI.y, x1: MINI.x + MINI.w, y1: MINI.y + MINI.h };
  const xs = interlagos.points.map((p) => p[0]), ys = interlagos.points.map((p) => p[1]);
  const lo = [Math.min(...xs), Math.min(...ys)], hi = [Math.max(...xs), Math.max(...ys)];
  const farOff: [string, number, number][] = [
    ['south, past S do Senna', 200, hi[1]! + 900], ['north', 0, lo[1]! - 900], ['east', hi[0]! + 900, 0], ['west', lo[0]! - 900, 0],
    ['south-east', hi[0]! + 700, hi[1]! + 700],
  ];

  it.each(farOff)('keeps the minimap dot on the minimap edge nearest the car when it is far off (%s)', (_, x, y) => {
    const d = trackMiniDot(art, x, y);
    expect(d.inside).toBe(false);
    expect(d.x).toBeGreaterThanOrEqual(box.x0);
    expect(d.x).toBeLessThanOrEqual(box.x1);
    expect(d.y).toBeGreaterThanOrEqual(box.y0);
    expect(d.y).toBeLessThanOrEqual(box.y1);
    // Nearest edge: the dot is pressed against the side the car went out of.
    const free = { x: x * art.mini.k + art.mini.ox, y: y * art.mini.k + art.mini.oy };
    if (free.y > box.y1) expect(d.y).toBeGreaterThan(box.y1 - 5);
    if (free.y < box.y0) expect(d.y).toBeLessThan(box.y0 + 5);
    if (free.x > box.x1) expect(d.x).toBeGreaterThan(box.x1 - 5);
    if (free.x < box.x0) expect(d.x).toBeLessThan(box.x0 + 5);
    // Drawn there with the same white ring as on the lot.
    const rec = recordingContext();
    drawTrackMinimap(rec.ctx, art, x, y, '#c00');
    const i = rec.calls.findIndex(([k, a]) => k === 'arc' && a[2] === 3.5);
    expect(rec.calls[i]![1].slice(0, 2)).toEqual([d.x, d.y]);
    expect(rec.calls.slice(i).some(([k]) => k === 'stroke')).toBe(true);
  });

  it('puts the dot where the car is, without a ring, everywhere on the track', () => {
    for (let s = 0; s < interlagos.length; s += 50) {
      const at = centerlineAt(interlagos, s), d = trackMiniDot(art, at.x, at.y);
      expect(d.inside, `s ${s}`).toBe(true);
      expect(d.x).toBeCloseTo(at.x * art.mini.k + art.mini.ox, 6);
      expect(d.y).toBeCloseTo(at.y * art.mini.k + art.mini.oy, 6);
    }
    const rec = recordingContext();
    drawTrackMinimap(rec.ctx, art, 0, 0, '#c00');
    const i = rec.calls.findIndex(([k, a]) => k === 'arc' && a[2] === 3.5);
    expect(rec.calls.slice(i).some(([k]) => k === 'stroke')).toBe(false);
  });

  it('covers the whole view with the lot grass tiles on Interlagos, so the motion shows far off the track', () => {
    for (const zoom of [MIN_ZOOM, MAX_ZOOM]) {
      const cam = followCamera({ x: 200, y: hi[1]! + 900, h: 1.5, beta: 0, v: 20 }, PX, zoom);
      const r = viewRect(cam, 0), tiles = grassTiles(r, false);
      for (let i = 0; i <= 10; i++) {
        for (let j = 0; j <= 10; j++) {
          const wx = r.x0 + ((r.x1 - r.x0) * i) / 10, wy = r.y0 + ((r.y1 - r.y0) * j) / 10;
          expect(tiles.some(([tx, ty]) => wx >= tx && wx < tx + GRASS_TILE && wy >= ty && wy < ty + GRASS_TILE), `${wx}, ${wy}`).toBe(true);
        }
      }
      expect(tiles.length).toBeLessThan(60);
    }
    const rec = recordingContext();
    const lot = buildLot(factoryFor(rec.ctx), TEST_LOT);
    rec.calls.length = 0;
    const params = createSimParams(loadCarParams(s15, 's15-drift.json'));
    const car = { ...createCar(params), x: 200, y: hi[1]! + 900, v: 10 };
    drawScene(rec.ctx, { car, params, view: createView(1), lot, paused: false, dt: 1 / 60, track: art, lap: null });
    const images = rec.calls.filter(([k]) => k === 'drawImage').map(([, a]) => a[0]);
    expect(images.filter((im) => im === lot.grass).length).toBeGreaterThan(0);
    expect(images).not.toContain(lot.image);
  });
});
