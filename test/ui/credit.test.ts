// S003-AC-14 (credit): whenever a track built from OpenStreetMap is shown, "© OpenStreetMap contributors"
// is drawn on screen as plain text (ODbL attribution, ADR-005). No link: the game never contacts the map service.
import { describe, expect, it } from 'vitest';
import { OSM_CREDIT } from '../../src/data/track.ts';
import { createCar, createSimParams, loadCarParams } from '../../src/sim/index.ts';
import s15json from '../../src/cars/s15-drift.json';
import { buildLot } from '../../src/render/lot.ts';
import { drawScene, SCREEN_H, SCREEN_W } from '../../src/render/scene.ts';
import { buildTrackArt } from '../../src/render/track.ts';
import { createView } from '../../src/render/view.ts';
import { TRACKS } from '../../src/tracks/index.ts';
import { factoryFor, recordingContext } from '../render/canvas-stub.ts';

const params = createSimParams(loadCarParams(s15json, 's15-drift.json'));

function draw(onTrack: boolean, at?: { x: number; y: number }) {
  const r = recordingContext();
  const track = TRACKS.find((t) => t.id === 'interlagos')!;
  const car = { ...createCar(params), ...(at ?? { x: track.spawn.x, y: track.spawn.y }) };
  drawScene(r.ctx, {
    car, params, view: createView(1), lot: buildLot(factoryFor(r.ctx), params.lot), paused: false, dt: 1 / 60,
    track: onTrack ? buildTrackArt(track, params.lot.scale) : null, lap: null,
  });
  return r;
}

describe('OpenStreetMap credit', () => {
  it('every shipped track carries the exact credit text', () => {
    for (const t of TRACKS) expect(t.credit).toContain(OSM_CREDIT);
  });

  it('is drawn on screen, inside the canvas, whenever the track is shown', () => {
    // At the start, and far from the circuit: the credit does not depend on track pieces being visible.
    for (const at of [undefined, { x: 5000, y: 5000 }]) {
      const r = draw(true, at);
      const hit = r.texts().filter(([t]) => t === OSM_CREDIT);
      expect(hit).toHaveLength(1);
      const [, x, y] = hit[0]!;
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(SCREEN_W);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThanOrEqual(SCREEN_H);
    }
  });

  it('is the last text drawn, so no HUD panel covers it', () => {
    const texts = draw(true).texts();
    expect(texts[texts.length - 1]![0]).toBe(OSM_CREDIT);
  });

  it('is plain text with no web address', () => {
    const texts = draw(true).texts().map(([t]) => t);
    for (const t of texts) expect(t).not.toMatch(/https?:|www\.|\.org/i);
  });

  it('is not drawn on the test lot, which has no map data', () => {
    expect(draw(false).texts().some(([t]) => t.includes('OpenStreetMap'))).toBe(false);
  });
});
