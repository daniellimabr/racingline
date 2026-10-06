// Test-lot artwork (v24 lines 59-72), drawn once into an offscreen canvas. Positions are v24 world pixels.
// S004-T6: the car can roll 200 to 360 m past the pavement, beyond the picture; there the grass is a small
// repeating tile, so the follow camera shows the motion, and the minimap keeps the car dot on its edge.
import type { Lot } from '../sim/index.ts';
import type { Rect } from './camera.ts';

export const WORLD_W = 2400;
export const WORLD_H = 1800;

/** What the lot needs from a canvas; `document.createElement('canvas')` satisfies it. */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(kind: '2d'): CanvasRenderingContext2D | null;
}
export type CanvasFactory = (width: number, height: number) => CanvasLike;

/** Grass tile size, world px; WORLD_W and WORLD_H are whole multiples, so a tile never overlaps the picture. */
export const GRASS_TILE = 300;
/** Lot minimap box on screen (the whole lot picture, scaled). */
export const LOT_MINI = { x: 500, y: 10, w: 130, h: (WORLD_H * 130) / WORLD_W } as const;
const MINI_DOT = 3.5;

export interface LotArt {
  image: CanvasImageSource;
  /** One grass tile, drawn round the picture where the view goes past it. */
  grass: CanvasImageSource;
  cones: [number, number][];
  lot: Lot;
}

export function buildLot(make: CanvasFactory, lot: Lot): LotArt {
  const oc = make(WORLD_W, WORLD_H);
  const o = oc.getContext('2d');
  if (!o) throw new Error('2D canvas is not available');
  const PX = lot.scale, { x0, y0, x1, y1 } = lot;
  o.fillStyle = '#3f7a3a';
  o.fillRect(0, 0, WORLD_W, WORLD_H);
  o.fillStyle = '#4a8a44';
  for (let i = 0; i < 90; i++) {
    o.beginPath();
    o.arc((i * 397) % WORLD_W, (i * 613) % WORLD_H, 20 + ((i * 7) % 40), 0, 7);
    o.fill();
  }
  o.fillStyle = '#e9e4d4';
  o.fillRect(x0 - 8, y0 - 8, x1 - x0 + 16, y1 - y0 + 16);
  o.fillStyle = '#4b4f55';
  o.fillRect(x0, y0, x1 - x0, y1 - y0);
  o.fillStyle = 'rgba(0,0,0,0.06)';
  for (let i = 0; i < 500; i++) o.fillRect(x0 + ((i * 733) % (x1 - x0)), y0 + ((i * 419) % (y1 - y0)), 12 + (i % 5) * 6, 2);
  // Parking stalls at real scale: 2.5 m wide, 5 m deep.
  const SW = 2.5 * PX, SD = 5 * PX;
  o.strokeStyle = 'rgba(255,255,255,0.8)';
  o.lineWidth = 1.5;
  const rows: [number, number][] = [[y0 + 8, 1], [y1 - 8, -1], [560, 1], [560, -1], [1240, 1], [1240, -1]];
  for (const [ry, dirn] of rows) {
    for (let x = 180; x <= 2220; x += SW) {
      o.beginPath();
      o.moveTo(x, ry);
      o.lineTo(x, ry + dirn * SD);
      o.stroke();
    }
  }
  o.beginPath();
  o.moveTo(180, 560);
  o.lineTo(2220, 560);
  o.moveTo(180, 1240);
  o.lineTo(2220, 1240);
  o.stroke();
  // Figure-8 circles, start line, cones.
  const P1: [number, number] = [1000, 900], P2: [number, number] = [1405, 900], GRAD = 12 * PX;
  o.strokeStyle = 'rgba(255,255,255,0.22)';
  o.lineWidth = 2;
  o.setLineDash([10, 10]);
  for (const p of [P1, P2]) {
    o.beginPath();
    o.arc(p[0], p[1], GRAD, 0, 7);
    o.stroke();
  }
  o.setLineDash([24, 24]);
  o.strokeStyle = 'rgba(255,200,61,0.55)';
  o.beginPath();
  o.moveTo(220, 900);
  o.lineTo(700, 900);
  o.stroke();
  o.setLineDash([]);
  const cones: [number, number][] = [];
  for (const p of [P1, P2]) {
    cones.push(p);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      cones.push([p[0] + Math.cos(a) * 1.6 * PX, p[1] + Math.sin(a) * 1.6 * PX]);
    }
  }
  for (let x = 400; x <= 2050; x += 18 * PX) cones.push([x, 1450]);
  for (const p of cones) {
    o.fillStyle = 'rgba(0,0,0,0.25)';
    o.beginPath();
    o.arc(p[0] + 1.5, p[1] + 1.5, 3.6, 0, 7);
    o.fill();
    o.fillStyle = '#ff7a1a';
    o.beginPath();
    o.arc(p[0], p[1], 3.6, 0, 7);
    o.fill();
    o.fillStyle = '#fff';
    o.beginPath();
    o.arc(p[0], p[1], 1.4, 0, 7);
    o.fill();
  }
  return { image: oc as unknown as CanvasImageSource, grass: grassTile(make), cones, lot };
}

/** The lot's grass with lighter patches, wrapped at the edges so tiles join without a seam. */
function grassTile(make: CanvasFactory): CanvasImageSource {
  const T = GRASS_TILE, tc = make(T, T), g = tc.getContext('2d');
  if (!g) throw new Error('2D canvas is not available');
  g.fillStyle = '#3f7a3a';
  g.fillRect(0, 0, T, T);
  g.fillStyle = '#4a8a44';
  for (let i = 0; i < 4; i++) {
    const x = (i * 131 + 40) % T, y = (i * 197 + 70) % T, r = 20 + ((i * 7) % 40);
    for (const ox of [-T, 0, T]) {
      for (const oy of [-T, 0, T]) {
        g.beginPath();
        g.arc(x + ox, y + oy, r, 0, 7);
        g.fill();
      }
    }
  }
  return tc as unknown as CanvasImageSource;
}

/**
 * Top-left corners of the grass tiles that cover `view` (world px), leaving out the lot picture; with
 * `aroundLot` false (a track's grass, S004-T10) the tiles cover the whole view.
 */
export function grassTiles(view: Rect, aroundLot = true): [number, number][] {
  const T = GRASS_TILE, out: [number, number][] = [];
  for (let ty = Math.floor(view.y0 / T) * T; ty <= view.y1; ty += T) {
    for (let tx = Math.floor(view.x0 / T) * T; tx <= view.x1; tx += T) {
      if (aroundLot && tx >= 0 && tx < WORLD_W && ty >= 0 && ty < WORLD_H) continue; // the picture covers it
      out.push([tx, ty]);
    }
  }
  return out;
}

/** Car dot on the lot minimap (screen px), held on the minimap's edge towards the car when it is off the picture. */
export function lotMiniDot(wx: number, wy: number): MiniDot {
  const m = LOT_MINI.w / WORLD_W, inside = wx >= 0 && wx <= WORLD_W && wy >= 0 && wy <= WORLD_H;
  return { ...dotInBox(LOT_MINI, LOT_MINI.x + wx * m, LOT_MINI.y + wy * m), inside };
}

/** A minimap car dot in screen px; `inside` false means it is held on the edge and drawn with a ring. */
export interface MiniDot {
  x: number;
  y: number;
  inside: boolean;
}

/** Holds a dot at (x, y) screen px inside `box`, on the edge nearest to it; `inside` tells whether it fitted. */
export function dotInBox(box: { x: number; y: number; w: number; h: number }, x: number, y: number): MiniDot {
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi - MINI_DOT, Math.max(lo + MINI_DOT, v));
  const cx = clamp(x, box.x, box.x + box.w), cy = clamp(y, box.y, box.y + box.h);
  return { x: cx, y: cy, inside: cx === x && cy === y };
}

/** Draws the car dot; off the map it waits on the edge with a white ring (S004-T6 lot, S004-T10 tracks). */
export function drawMiniDot(c: CanvasRenderingContext2D, dot: MiniDot, color: string): void {
  c.fillStyle = color;
  c.beginPath();
  c.arc(dot.x, dot.y, MINI_DOT, 0, 7);
  c.fill();
  if (dot.inside) return;
  c.strokeStyle = '#f4f1ea';
  c.lineWidth = 1.5;
  c.stroke();
}
