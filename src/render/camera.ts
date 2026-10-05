// Follow camera (render only): centres ahead of the car along its travel direction and zooms out with
// speed (the zoom is smoothed in scene.ts). The look-ahead is capped so the car always stays on screen.
export const SCREEN_W = 640;
export const SCREEN_H = 420;
const CX = SCREEN_W / 2, CY = SCREEN_H / 2;

export const MAX_ZOOM = 1.25;
export const MIN_ZOOM = 0.7;
/** Screen px the car may sit from the centre; leaves a band round the edge for the car body. */
const MAX_LEAD = Math.min(CX, CY) - 60;
const LOOK_AHEAD = 0.35; // s of travel shown ahead of the car

/** What the camera needs from the car (m, rad, m/s). */
export interface CameraCar {
  readonly x: number;
  readonly y: number;
  readonly h: number;
  readonly beta: number;
  readonly v: number;
}

/** World px at the screen centre and the zoom. */
export interface Camera {
  readonly cx: number;
  readonly cy: number;
  readonly z: number;
}

/** Zoom the camera eases towards at speed v, m/s. */
export const targetZoom = (v: number): number => MAX_ZOOM - Math.min(MAX_ZOOM - MIN_ZOOM, v * 0.013);

export function followCamera(car: CameraCar, px: number, zoom: number): Camera {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const vd = car.h + car.beta, lead = Math.min(Math.max(0, car.v) * LOOK_AHEAD * px, MAX_LEAD / z);
  return { cx: car.x * px + Math.cos(vd) * lead, cy: car.y * px + Math.sin(vd) * lead, z };
}

/** World px to screen px. */
export function toScreen(cam: Camera, wx: number, wy: number): [number, number] {
  return [(wx - cam.cx) * cam.z + CX, (wy - cam.cy) * cam.z + CY];
}

export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The world px rectangle on screen, grown by `margin` world px on every side. */
export function viewRect(cam: Camera, margin: number): Rect {
  const hw = CX / cam.z + margin, hh = CY / cam.z + margin;
  return { x0: cam.cx - hw, y0: cam.cy - hh, x1: cam.cx + hw, y1: cam.cy + hh };
}
