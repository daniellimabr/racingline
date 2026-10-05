// S003-AC-13 (HUD half): on a track the lap HUD shows the lap time, the three sector times, the best lap
// and an invalid-lap mark; on the test lot there is no lap panel. Lap state shape: mailbox
// docs/sprints/SPRINT-003/mailbox/back-end-to-front-end-track-api.md.
import { describe, expect, it } from 'vitest';
import { createCar, createSimParams, loadCarParams } from '../../src/sim/index.ts';
import s15json from '../../src/cars/s15-drift.json';
import { buildLot } from '../../src/render/lot.ts';
import { drawScene } from '../../src/render/scene.ts';
import { buildTrackArt } from '../../src/render/track.ts';
import { createView } from '../../src/render/view.ts';
import { TRACKS } from '../../src/tracks/index.ts';
import { fmtLapTime, lapHud, type LapProgress } from '../../src/ui/hud-lap.ts';
import { factoryFor, recordingContext } from '../render/canvas-stub.ts';

const best = { time: 101.25, sectors: [30, 36, 35.25] as const, valid: true };
const base: LapProgress = { lap: 2, sector: 2, time: 47.5, splits: [28.123], valid: true, last: null, best };

describe('lap time format', () => {
  it('shows minutes, seconds and thousandths with a decimal comma', () => {
    expect(fmtLapTime(83.456)).toBe('1:23,456');
    expect(fmtLapTime(5.2)).toBe('0:05,200');
    expect(fmtLapTime(0)).toBe('0:00,000');
    expect(fmtLapTime(59.9996)).toBe('1:00,000');
    expect(fmtLapTime(3725.5)).toBe('62:05,500');
  });

  it('shows a dash for a missing or broken time', () => {
    for (const t of [null, Number.NaN, Infinity, -1]) expect(fmtLapTime(t)).toBe('—');
  });
});

describe('lap HUD content', () => {
  it('has no panel on the test lot', () => {
    expect(lapHud(null)).toBeNull();
  });

  it('before the first start line crossing asks the driver to cross it', () => {
    const hud = lapHud({ ...base, lap: 0, time: 0, sector: 1, splits: [], best: null })!;
    expect(hud.title).toBe('Volta —');
    expect(hud.time).toBe('Cruze a largada');
    expect(hud.sectors.map((s) => s.time)).toEqual(['—', '—', '—']);
    expect(hud.best).toBe('Melhor —');
    expect(hud.invalid).toBeNull();
  });

  it('mid lap shows the lap time, done sectors, the running sector and the best lap', () => {
    const hud = lapHud(base)!;
    expect(hud.title).toBe('Volta 2');
    expect(hud.time).toBe('0:47,500');
    expect(hud.sectors.map((s) => s.label)).toEqual(['S1', 'S2', 'S3']);
    expect(hud.sectors.map((s) => s.time)).toEqual(['0:28,123', '0:19,377', '—']);
    expect(hud.sectors.map((s) => s.state)).toEqual(['done', 'running', 'todo']);
    expect(hud.best).toBe('Melhor 1:41,250');
    expect(hud.invalid).toBeNull();
  });

  it('marks an invalid lap with words, not only a colour', () => {
    const hud = lapHud({ ...base, valid: false })!;
    expect(hud.invalid).toBe('✕ Volta inválida');
  });

  it('shows the last lap, marked when it was invalid', () => {
    const last = { time: 99.5, sectors: [30, 35, 34.5] as const, valid: false };
    expect(lapHud({ ...base, last })!.last).toBe('Última 1:39,500 (inválida)');
    expect(lapHud({ ...base, last: { ...last, valid: true } })!.last).toBe('Última 1:39,500');
    expect(lapHud(base)!.last).toBeNull();
  });
});

describe('lap HUD on screen', () => {
  const params = createSimParams(loadCarParams(s15json, 's15-drift.json'));
  const track = TRACKS.find((t) => t.id === 'interlagos')!;

  function draw(lap: LapProgress | null, onTrack: boolean): string[] {
    const r = recordingContext();
    const lot = buildLot(factoryFor(r.ctx), params.lot);
    const car = { ...createCar(params), x: track.spawn.x, y: track.spawn.y, h: track.spawn.h };
    drawScene(r.ctx, {
      car, params, view: createView(1), lot, paused: false, dt: 1 / 60,
      track: onTrack ? buildTrackArt(track, params.lot.scale) : null, lap,
    });
    return r.texts().map(([t]) => t);
  }

  it('draws the lap time, the three sectors, the best lap and the invalid mark', () => {
    const texts = draw({ ...base, valid: false }, true);
    for (const t of ['Volta 2', '0:47,500', 'S1', '0:28,123', 'S2', '0:19,377', 'S3', 'Melhor 1:41,250', '✕ Volta inválida']) {
      expect(texts, t).toContain(t);
    }
  });

  it('draws no lap panel without lap state', () => {
    expect(draw(null, false).some((t) => t.startsWith('Volta'))).toBe(false);
  });
});
