// S003-AC-13 (camera half): as the car moves across Interlagos and the lot, the camera keeps it on screen,
// and only the track pieces near the car are drawn.
import { describe, expect, it } from 'vitest';
import { centerlineAt } from '../../src/data/track.ts';
import { TRACKS } from '../../src/tracks/index.ts';
import { followCamera, MAX_ZOOM, MIN_ZOOM, toScreen, viewRect } from '../../src/render/camera.ts';
import { SCREEN_H, SCREEN_W } from '../../src/render/scene.ts';
import { buildTrackArt, visibleSegments } from '../../src/render/track.ts';

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
});
