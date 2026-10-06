// Render-owned history and effects (v24 step() lines 202-205 and emit()): trail, skid marks, smoke,
// telemetry samples. Fed once per sim tick; reads the car, never writes it. Smoke randomness comes
// from a render-only mulberry32 state here, never from the sim rng.
import { next } from '../core/rng.ts';
import { carLook } from './car-look.ts';
import { createCoachHold, type CoachHold } from './coaching.ts';
import { HALO_SPAN, HALO_THRESHOLD, type CarState, type SimParams } from '../sim/index.ts';

// Axle diagram layout (screen px), shared with the HUD.
export const DIAG = { x: 96, y: 92, wheelbase: 64, track: 46 } as const;
export const DIAG_FY = DIAG.y - DIAG.wheelbase / 2;
export const DIAG_RY = DIAG.y + DIAG.wheelbase / 2;
export const TEL_SECONDS = 12;
const TRAIL_MAX = 700, SKID_MAX = 6000, SMOKE_MAX = 160, DSM_MAX = 120;

export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; s: number }
export interface TelSample { tt: number; thr: number; lim: number; rpm: number; beta: number; p: number; dr: boolean }

export interface View {
  trail: [number, number, 0 | 1 | 2][]; // world px + grip level for color
  skids: [number, number][];
  smoke: Particle[]; // world px
  dsm: Particle[]; // axle-diagram smoke, screen px
  tel: TelSample[];
  rng: number; // render-only rng state
  zoom: number;
  coach: CoachHold; // shown coaching line and how long it has been up (S005-T9)
}

export const createView = (seed = 1): View => ({
  trail: [], skids: [], smoke: [], dsm: [], tel: [], rng: seed >>> 0, zoom: 1.25, coach: createCoachHold(),
});

/** px, wheel offset from the car axis for skids and smoke (6.5 px on the S15, wider cars further out). */
const halfTrack = (p: SimParams): number => carLook(p.car, p.lot.scale).halfWidth - 1.1;

function rand(view: View): number {
  const d = next(view.rng);
  view.rng = d.state;
  return d.value;
}

/** Call after each sim tick with that tick's car. */
export function recordTick(view: View, s: CarState, p: SimParams, dt: number): void {
  const PX = p.lot.scale, px = s.x * PX, py = s.y * PX;
  const risk = Math.max(s.riskR, s.riskF);
  view.tel.push({
    tt: s.tt, thr: s.t, lim: s.lim, rpm: s.rpm, beta: Math.abs(s.beta),
    p: Math.max(0, Math.min(1, (risk - HALO_THRESHOLD) / HALO_SPAN)), dr: s.cur !== null,
  });
  while (view.tel.length && view.tel[0]!.tt < s.tt - TEL_SECONDS) view.tel.shift();
  const sliding = s.u > 1 || s.mode === 'drift' || s.mode === 'rear' || s.mode === 'spin';
  view.trail.push([px, py, sliding ? 2 : s.u > 0.8 ? 1 : 0]);
  if (view.trail.length > TRAIL_MAX) view.trail.shift();
  if (s.v > 1.5 && !s.off && (s.mode || s.wspin || s.lockF)) {
    const ch = Math.cos(s.h), sh = Math.sin(s.h), ax = (s.mode === 'front' || s.lockF ? p.car.la : -p.car.lb) * PX;
    const tr = halfTrack(p);
    for (const l of [-tr, tr]) view.skids.push([px + ch * ax - sh * l, py + sh * ax + ch * l]);
    if (view.skids.length > SKID_MAX) view.skids.splice(0, 2);
  }
  emit(view, s, p, dt);
}

/** v24 emit(): tire smoke on the lot and in the axle diagram, strength from grip use above 100%. */
function emit(view: View, s: CarState, p: SimParams, dt: number): void {
  const PX = p.lot.scale, ch = Math.cos(s.h), sh = Math.sin(s.h), px = s.x * PX, py = s.y * PX;
  const axles: [number, number][] = [[s.useF, p.car.la * PX], [s.useR, -p.car.lb * PX]];
  for (const [use, ax] of axles) {
    const k = Math.min(1, Math.max(0, use - 1) * 1.6);
    if (k <= 0 || s.off || (s.v < 1 && s.spinR <= 0)) continue;
    if (rand(view) < k * dt * 18) {
      for (const l of [-halfTrack(p), halfTrack(p)]) {
        const wx = px + ch * ax - sh * l, wy = py + sh * ax + ch * l;
        view.smoke.push({
          x: wx - ch * 10, y: wy - sh * 10, vx: -ch * 8 + (rand(view) - 0.5) * 12, vy: -sh * 8 + (rand(view) - 0.5) * 12,
          life: 1.2, max: 1.2, s: 4 + k * 3,
        });
      }
    }
  }
  if (view.smoke.length > SMOKE_MAX) view.smoke.splice(0, view.smoke.length - SMOKE_MAX);
  for (const q of view.smoke) {
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.life -= dt;
    q.s += dt * 12;
  }
  view.smoke = view.smoke.filter((q) => q.life > 0);
  const diag: [number, number][] = [[s.useR, DIAG_RY], [s.useF, DIAG_FY]];
  for (const [use, wy] of diag) {
    const k = Math.min(1, Math.max(0, use - 1) * 1.6);
    if (k > 0 && rand(view) < k * dt * 40) {
      for (const sx of [-1, 1]) {
        view.dsm.push({
          x: DIAG.x + (sx * DIAG.track) / 2 + (rand(view) - 0.5) * 6, y: wy + 10,
          vx: sx * (6 + rand(view) * 10), vy: 12 + rand(view) * 16, life: 1, max: 1, s: 2.5 + k * 3,
        });
      }
    }
  }
  for (const q of view.dsm) {
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.life -= dt * 1.2;
    q.s += dt * 9;
  }
  view.dsm = view.dsm.filter((q) => q.life > 0 && q.y < 158);
  if (view.dsm.length > DSM_MAX) view.dsm.splice(0, view.dsm.length - DSM_MAX);
}
