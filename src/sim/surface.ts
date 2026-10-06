// Surface grip and drag per axle (S003-T6). The bicycle model has one tyre per axle, so the surface is
// read at each axle centre; per-wheel lookups would need a car track width the car files do not have,
// and would be averaged back to the axle anyway. Same meaning as the lot's offGrip/offDrag:
// grip multiplies the car's friction, drag is extra drag per m/s of speed (1/s).
import type { Track } from '../data/track.ts';
import type { CarParams, Lot } from './params.ts';

/** Name of the surface at a world point, a key of `track.surfaces` (Back End's lookup, S003-T5). */
export type SurfaceAt = (track: Track, x: number, y: number) => string;

/** Grip factor and extra drag (1/s) under the front and rear axle. */
export interface AxleSurface {
  gripF: number;
  gripR: number;
  dragF: number;
  dragR: number;
}

/** The test lot: both axles on or off the pavement together, as v24 did (car centre test). */
export function lotSurface(lot: Lot, off: boolean): AxleSurface {
  const g = off ? lot.offGrip : 1, d = off ? lot.offDrag : 0;
  return { gripF: g, gripR: g, dragF: d, dragR: d };
}

function surfaceNamed(track: Track, name: string): { grip: number; drag: number } {
  const sf = Object.hasOwn(track.surfaces, name) ? track.surfaces[name] : undefined;
  if (!sf) throw new Error(`Track ${track.id}: the surface lookup returned ${JSON.stringify(name)}, which is not in its surfaces (${Object.keys(track.surfaces).join(', ')})`);
  return sf;
}

/** Surfaces under the front axle (la ahead of the centre) and the rear axle (lb behind). */
export function trackSurface(track: Track, at: SurfaceAt, c: CarParams, s: { x: number; y: number; h: number }): AxleSurface {
  const ch = Math.cos(s.h), sh = Math.sin(s.h);
  const f = surfaceNamed(track, at(track, s.x + c.la * ch, s.y + c.la * sh));
  const r = surfaceNamed(track, at(track, s.x - c.lb * ch, s.y - c.lb * sh));
  return { gripF: f.grip, gripR: r.grip, dragF: f.drag, dragR: r.drag };
}
