// Track drawing (S003-T7): road, kerbs and grass from the checked track file (ADR-005), plus the start line
// and sector marks; since S004-T6 also the distance boards and wider apex kerbs (boards.ts). The geometry is turned into world-px pieces once per track; each frame draws only the
// pieces inside the camera's view. Reads the track, never writes it.
import type { Track, TrackLine } from '../data/track.ts';
import type { Rect } from './camera.ts';
import { boardsFor, kerbsFor, type Board } from './boards.ts';
import { dotInBox, drawMiniDot, type MiniDot } from './lot.ts';

/** One centerline piece in world px: from point i to point i+1, with its width and distance from the start. */
export interface Segment {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly width: number; // road width, px
  readonly s: number; // distance along the lap at a, px
  readonly box: Rect; // bounds including kerbs and verge bands
}

export interface Band {
  readonly surface: string;
  /** Full stroke width across the track up to the outer edge of this band, px. */
  readonly reach: number;
}

export interface TrackArt {
  readonly track: Track;
  readonly px: number;
  readonly segments: readonly Segment[];
  /** Verge bands from the outermost inwards (drawn in that order, the road last). */
  readonly bands: readonly Band[];
  /** Minimap: scale (minimap px per m) and offset that fit the whole circuit in the minimap box. */
  readonly mini: { readonly k: number; readonly ox: number; readonly oy: number };
  /** Distance boards before each braking point, m (none when the track has no braking points). */
  readonly boards: readonly Board[];
  /** Wider apex kerbs: the middle of each band in world px, its width in px, lap distance in px, and bounds. */
  readonly kerbs: readonly { readonly pts: readonly (readonly [number, number])[]; readonly width: number; readonly s: number; readonly box: Rect }[];
}

/** Board size and number height, m: the number stays above 15 screen px at the widest zoom. */
export const BOARD = { w: 6, h: 3.6, text: 2.6 } as const;

/** Surface colours by name; an unknown name draws in a neutral grey instead of failing. */
const SURFACE_COLOR: Readonly<Record<string, string>> = { asphalt: '#4b4f55', kerb: '#e9e4d4', grass: '#3f7a3a', gravel: '#b9a77f' };
const UNKNOWN_SURFACE = '#8a8f96';
const KERB_STRIPE = '#d8473b';
const KERB_STRIPE_M = 3; // m of red, then m of white
export const surfaceColor = (name: string): string => (Object.hasOwn(SURFACE_COLOR, name) ? SURFACE_COLOR[name]! : UNKNOWN_SURFACE);

export const MINI = { x: 500, y: 10, w: 130, h: 100 } as const;

export function buildTrackArt(track: Track, px: number): TrackArt {
  const pts = track.points, n = pts.length;
  const vergeTotal = track.verge.reduce((sum, b) => sum + b.width, 0);
  const segments: Segment[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!, q = pts[(i + 1) % n]!;
    const width = Math.max(p[2], q[2]) * px, pad = width / 2 + vergeTotal * px;
    const ax = p[0] * px, ay = p[1] * px, bx = q[0] * px, by = q[1] * px;
    segments.push({
      ax, ay, bx, by, width, s,
      box: { x0: Math.min(ax, bx) - pad, y0: Math.min(ay, by) - pad, x1: Math.max(ax, bx) + pad, y1: Math.max(ay, by) + pad },
    });
    s += Math.hypot(bx - ax, by - ay);
  }
  const bands: Band[] = [];
  let reach = 0;
  for (const b of track.verge) {
    reach += 2 * b.width * px;
    bands.unshift({ surface: b.surface, reach });
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const k = Math.min((MINI.w - 8) / (x1 - x0), (MINI.h - 8) / (y1 - y0));
  const mini = { k, ox: MINI.x + (MINI.w - (x1 - x0) * k) / 2 - x0 * k, oy: MINI.y + (MINI.h - (y1 - y0) * k) / 2 - y0 * k };
  const kerbs = kerbsFor(track).map((k) => {
    const pts = k.pts.map(([x, y]) => [x * px, y * px] as const), pad = k.width * px;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { pts, width: k.width * px, s: k.s * px, box: { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad } };
  });
  return { track, px, segments, bands, mini, boards: boardsFor(track), kerbs };
}

const overlaps = (a: Rect, b: Rect): boolean => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

/** Indices of the pieces that touch the view rectangle (world px), in lap order. */
export function visibleSegments(art: TrackArt, view: Rect): number[] {
  const out: number[] = [];
  art.segments.forEach((g, i) => {
    if (overlaps(g.box, view)) out.push(i);
  });
  return out;
}

function strokeSegment(c: CanvasRenderingContext2D, g: Segment, width: number): void {
  c.lineWidth = width;
  c.beginPath();
  c.moveTo(g.ax, g.ay);
  c.lineTo(g.bx, g.by);
  c.stroke();
}

function lineVisible(l: TrackLine, px: number, view: Rect): boolean {
  const mx = ((l.a[0] + l.b[0]) / 2) * px, my = ((l.a[1] + l.b[1]) / 2) * px;
  return mx >= view.x0 && mx <= view.x1 && my >= view.y0 && my <= view.y1;
}

function strokeLine(c: CanvasRenderingContext2D, l: TrackLine, px: number): void {
  c.beginPath();
  c.moveTo(l.a[0] * px, l.a[1] * px);
  c.lineTo(l.b[0] * px, l.b[1] * px);
  c.stroke();
}

/**
 * Draws the visible part of the track in world px (the caller has set the camera transform).
 * The background (the `outside` surface) is the caller's screen fill. Returns the number of pieces drawn.
 */
export function drawTrack(c: CanvasRenderingContext2D, art: TrackArt, view: Rect, covered: readonly Rect[] = []): number {
  const vis = visibleSegments(art, view).map((i) => art.segments[i]!), px = art.px;
  c.save();
  c.lineJoin = 'round';
  for (const band of art.bands) {
    c.lineCap = 'round';
    c.strokeStyle = surfaceColor(band.surface);
    for (const g of vis) strokeSegment(c, g, g.width + band.reach);
    if (band.surface === 'kerb') {
      // Red and white kerb stripes; the dash offset follows the lap distance so stripes join between pieces.
      c.lineCap = 'butt';
      c.strokeStyle = KERB_STRIPE;
      c.setLineDash([KERB_STRIPE_M * px, KERB_STRIPE_M * px]);
      for (const g of vis) {
        c.lineDashOffset = g.s;
        strokeSegment(c, g, g.width + band.reach);
      }
      c.setLineDash([]);
      c.lineDashOffset = 0;
    }
  }
  // Wider apex kerbs: red and white stripes just outside the edge, over the 1 m verge kerb on that stretch.
  c.lineCap = 'butt';
  for (const k of art.kerbs) {
    if (!overlaps(k.box, view)) continue;
    c.lineWidth = k.width;
    c.beginPath();
    for (const [x, y] of k.pts) c.lineTo(x, y);
    c.strokeStyle = surfaceColor('kerb');
    c.stroke();
    c.strokeStyle = KERB_STRIPE;
    c.setLineDash([KERB_STRIPE_M * px, KERB_STRIPE_M * px]);
    c.lineDashOffset = k.s;
    c.stroke();
    c.setLineDash([]);
    c.lineDashOffset = 0;
  }
  c.lineCap = 'round';
  c.strokeStyle = surfaceColor(art.track.road);
  for (const g of vis) strokeSegment(c, g, g.width);
  // Start line: a white bar with black checks across the road.
  c.lineCap = 'butt';
  const start = art.track.startLine;
  if (lineVisible(start, px, view)) {
    c.strokeStyle = '#f4f1ea';
    c.lineWidth = 1.6 * px;
    strokeLine(c, start, px);
    c.strokeStyle = '#111';
    c.setLineDash([0.8 * px, 0.8 * px]);
    c.lineWidth = 0.8 * px;
    strokeLine(c, start, px);
    c.setLineDash([]);
  }
  // Sector marks: sector 1 begins on the start line; sectors 2 and 3 get a yellow line and a label.
  c.font = '500 ' + Math.round(2.2 * px) + 'px sans-serif';
  c.textAlign = 'center';
  art.track.sectorLines.forEach((l, i) => {
    if (i === 0 || !lineVisible(l, px, view)) return;
    c.strokeStyle = '#ffc83d';
    c.lineWidth = 0.5 * px;
    strokeLine(c, l, px);
    // Label just beyond the driver's left end of the line.
    const dx = l.a[0] - l.b[0], dy = l.a[1] - l.b[1], d = Math.hypot(dx, dy);
    c.fillStyle = '#ffc83d';
    c.fillText('S' + (i + 1), (l.a[0] + (dx / d) * 2.5) * px, (l.a[1] + (dy / d) * 2.5) * px);
  });
  drawBoards(c, art, view, covered);
  c.textAlign = 'left';
  c.restore();
  return vis.length;
}

/** Distance boards: white panels with the distance in black, upright on screen (the camera never rotates). */
function drawBoards(c: CanvasRenderingContext2D, art: TrackArt, view: Rect, covered: readonly Rect[]): void {
  const px = art.px, hw = (BOARD.w / 2) * px, hh = (BOARD.h / 2) * px, lw = 0.15 * px; // lw: half the outline width
  // Boards outside the view, or under a HUD panel (covered, world px; S005-T5), are not drawn.
  const under = (b: Board, r: Rect): boolean =>
    b.x * px - hw - lw < r.x1 && b.x * px + hw + lw > r.x0 && b.y * px - hh - lw < r.y1 && b.y * px + hh + lw > r.y0;
  const shown = art.boards.filter((b) => b.x * px + hw >= view.x0 && b.x * px - hw <= view.x1 && b.y * px + hh >= view.y0 && b.y * px - hh <= view.y1
    && !covered.some((r) => under(b, r)));
  if (shown.length === 0) return;
  c.font = '700 ' + Math.round(BOARD.text * px) + 'px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineWidth = 0.3 * px;
  for (const b of shown) {
    const x = b.x * px, y = b.y * px;
    c.fillStyle = '#f4f1ea';
    c.fillRect(x - hw, y - hh, 2 * hw, 2 * hh);
    c.strokeStyle = '#111';
    c.strokeRect(x - hw, y - hh, 2 * hw, 2 * hh);
    c.fillStyle = '#111';
    c.fillText(b.label, x, y + 0.1 * px);
  }
  c.textBaseline = 'alphabetic';
}

/** The car dot on the track minimap (screen px), held on the minimap's edge nearest the car when it is far off (S004-T10). */
export function trackMiniDot(art: TrackArt, carX: number, carY: number): MiniDot {
  const { k, ox, oy } = art.mini;
  return dotInBox(MINI, carX * k + ox, carY * k + oy);
}

/** Minimap of the whole circuit (screen px) with the car as a dot. */
export function drawTrackMinimap(c: CanvasRenderingContext2D, art: TrackArt, carX: number, carY: number, carColor: string): void {
  const { k, ox, oy } = art.mini, pts = art.track.points;
  c.save();
  c.strokeStyle = '#9aa3b0'; // lighter than the asphalt so the shape reads on the dark minimap panel
  c.lineWidth = 3;
  c.lineJoin = 'round';
  c.beginPath();
  for (const p of pts) c.lineTo(p[0] * k + ox, p[1] * k + oy);
  c.closePath();
  c.stroke();
  const st = art.track.startLine;
  c.strokeStyle = '#f4f1ea';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(st.a[0] * k + ox, st.a[1] * k + oy);
  c.lineTo(st.b[0] * k + ox, st.b[1] * k + oy);
  c.stroke();
  drawMiniDot(c, trackMiniDot(art, carX, carY), carColor);
  c.restore();
}
