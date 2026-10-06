// S005-AC-10 (layout half): no HUD panel covers a drawn distance board. Sprint 004 blind test: on Interlagos the
// car panel and the axle diagram hid boards. A board that would sit under a panel is not drawn on that frame.
import { describe, expect, it } from 'vitest';
import { centerlineAt } from '../../src/data/track.ts';
import { createCarRegistry } from '../../src/core/car-registry.ts';
import { loadCarParams, type CarState } from '../../src/sim/index.ts';
import s15 from '../../src/cars/s15-drift.json';
import gt3 from '../../src/cars/gt3.json';
import { startRun } from '../../src/run.ts';
import { targetZoom, type Rect } from '../../src/render/camera.ts';
import { buildLot } from '../../src/render/lot.ts';
import { drawScene, hudPanels } from '../../src/render/scene.ts';
import { BOARD, buildTrackArt } from '../../src/render/track.ts';
import { createView } from '../../src/render/view.ts';
import type { LapProgress } from '../../src/ui/hud-lap.ts';
import { deepFreeze } from '../core/helpers.ts';
import { factoryFor, recordingContext, type Recording } from './canvas-stub.ts';

const cars = createCarRegistry([loadCarParams(s15, 's15-drift.json'), loadCarParams(gt3, 'gt3.json')]);
const run = startRun({ seed: 1, car: 'gt3', track: 'interlagos' }, cars);
const params = deepFreeze(run.params);
const track = params.track!, PX = params.lot.scale;
const art = deepFreeze(buildTrackArt(track, PX));
const lap: LapProgress = deepFreeze({ lap: 2, sector: 1, time: 12.3, splits: [], valid: true, last: null, best: null });

const overlaps = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** Screen rectangles of the boards drawn: the stroked board outlines while the camera transform is set. */
function drawnBoards(rec: Recording): Rect[] {
  let z = 1, e = 0, f = 0;
  const out: Rect[] = [];
  for (const [k, a] of rec.calls) {
    if (k === 'setTransform') [z, , , , e, f] = a as [number, number, number, number, number, number];
    if (k === 'strokeRect' && z !== 1) {
      const [x, y, w, h] = a as number[];
      out.push({ x0: x! * z + e, y0: y! * z + f, x1: (x! + w!) * z + e, y1: (y! + h!) * z + f });
    }
  }
  return out;
}

/** Car on the centreline at lap distance s, driving along it at v m/s. */
function carAt(s: number, v: number): CarState {
  const at = centerlineAt(track, s), h = Math.atan2(at.dy, at.dx);
  return deepFreeze({ ...run.state.car, x: at.x, y: at.y, h, v, vx: v });
}

function frame(car: CarState) {
  const rec = recordingContext(), view = createView(1);
  view.zoom = targetZoom(car.v);
  drawScene(rec.ctx, { car, params, view, lot: buildLot(factoryFor(rec.ctx), params.lot), paused: false, dt: 1 / 60, track: art, lap });
  return rec;
}

describe('HUD panels and distance boards', () => {
  it('lists every panel the HUD fills, as drawn', () => {
    const rec = frame(carAt(100, 40));
    const panels = hudPanels(rec.ctx, art, lap);
    expect(panels.length).toBeGreaterThanOrEqual(6); // diagram, car panel, minimap, car name, lap panel, map credit
    const fills = rec.calls.filter(([k]) => k === 'fillRect').map(([, a]) => (a as number[]).join());
    for (const p of panels) expect(fills, JSON.stringify(p)).toContain([p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0].join());
  });

  it('never draws a board under a panel, all round Interlagos at several speeds', () => {
    expect(BOARD.w).toBeGreaterThan(0);
    let drawn = 0;
    const hidden: string[] = [];
    for (const v of [10, 40, 70]) {
      for (let s = 0; s < track.length; s += 10) {
        const rec = frame(carAt(s, v));
        const panels = hudPanels(rec.ctx, art, lap);
        for (const b of drawnBoards(rec)) {
          drawn++;
          if (panels.some((p) => overlaps(p, b))) hidden.push(`v ${v} s ${s}`);
        }
      }
    }
    expect(drawn).toBeGreaterThan(100); // the boards really are drawn round the lap
    expect(hidden).toEqual([]);
  }, 20_000); // about 1300 full frames: 3 s in a full run, 7 s once under load (S005-T11)
});
