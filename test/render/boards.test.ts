// S004-AC-10 (boards and kerbs half): distance boards sit 200, 150, 100 and 50 m before each braking point on
// the outside of the corner, the wider apex kerbs follow the given track edge, and a track without the new
// fields draws exactly as before. Fixture data in the shape agreed with Database
// (docs/sprints/SPRINT-004/mailbox/database-to-front-end-track-fields.md), so this does not wait for the file.
import { describe, expect, it } from 'vitest';
import { centerlineAt, nearestOnCenterline, type Track, type TrackPoint } from '../../src/data/track.ts';
import { TRACKS } from '../../src/tracks/index.ts';
import { BOARD_DISTANCES, boardsFor, kerbsFor, type ApexKerb, type BrakePoint } from '../../src/render/boards.ts';
import { buildTrackArt, drawTrack } from '../../src/render/track.ts';
import { recordingContext } from './canvas-stub.ts';

const PX = 9;
const interlagos = TRACKS.find((t) => t.id === 'interlagos')!;
type Marked = Track & { apexKerbs?: readonly ApexKerb[]; brakePoints?: readonly BrakePoint[] };

/**
 * A 1000 x 600 m rectangle, 26 m wide, points every 10 m, starting at (900, 0) heading east. Clockwise on
 * screen (y down), so every corner turns right; `mirror` flips y so every corner turns left. Lap 3200 m;
 * the first corner is at s = 100.
 */
function rectangle(mirror: boolean, marks: { apexKerbs?: ApexKerb[]; brakePoints?: BrakePoint[] }): Marked {
  const corners: [number, number][] = [[1000, 0], [1000, 600], [0, 600], [0, 0], [900, 0]];
  const pts: TrackPoint[] = [];
  let [x, y] = [900, 0];
  for (const [cx, cy] of corners) {
    while (x !== cx || y !== cy) {
      pts.push([x, mirror ? -y : y, 26]);
      x += Math.sign(cx - x) * 10;
      y += Math.sign(cy - y) * 10;
    }
  }
  return { ...interlagos, length: 3200, points: pts, ...marks };
}

const vergeTotal = interlagos.verge.reduce((sum, b) => sum + b.width, 0);

describe('distance boards', () => {
  it('stand 200, 150, 100 and 50 m before each braking point, in that order', () => {
    const t = rectangle(false, { brakePoints: [{ s: 900, name: 'Curva 2' }, { s: 1500, name: 'Curva 3' }] });
    const boards = boardsFor(t);
    expect(BOARD_DISTANCES).toEqual([200, 150, 100, 50]);
    expect(boards.map((b) => [b.s, b.label, b.corner])).toEqual([
      [700, '200', 'Curva 2'], [750, '150', 'Curva 2'], [800, '100', 'Curva 2'], [850, '50', 'Curva 2'],
      [1300, '200', 'Curva 3'], [1350, '150', 'Curva 3'], [1400, '100', 'Curva 3'], [1450, '50', 'Curva 3'],
    ]);
  });

  it('sit just beyond the verge on the outside of a right-hand corner (the driver\'s left)', () => {
    // s 700..1700 is the bottom side (y = 600, heading west); the corner at 1700 turns right (north).
    const t = rectangle(false, { brakePoints: [{ s: 1600, name: 'T' }] });
    const boards = boardsFor(t);
    expect(boards).toHaveLength(4);
    for (const b of boards) {
      const at = centerlineAt(t, b.s);
      expect(b.side).toBe('left');
      // Left of a westbound car is south: larger y, same x as the centreline point.
      expect(b.x).toBeCloseTo(at.x, 6);
      expect(b.y - at.y).toBeGreaterThan(13 + vergeTotal);
      expect(b.y - at.y).toBeLessThan(13 + vergeTotal + 8);
    }
  });

  it('switch to the driver\'s right before a left-hand corner', () => {
    // Mirrored: the bottom side is at y = -600 and the corner at 1700 turns left (south, larger y).
    const t = rectangle(true, { brakePoints: [{ s: 1600, name: 'T' }] });
    for (const b of boardsFor(t)) {
      const at = centerlineAt(t, b.s);
      expect(b.side).toBe('right');
      expect(at.y - b.y).toBeGreaterThan(13 + vergeTotal);
    }
  });

  it('wrap across the start line when the braking point is close after it', () => {
    // Braking point at 80 m: the 200, 150 and 100 boards are at the end of the previous lap.
    const t = rectangle(false, { brakePoints: [{ s: 80, name: 'Curva 1' }] });
    const boards = boardsFor(t);
    expect(boards.map((b) => b.s)).toEqual([3080, 3130, 3180, 30]);
    // All on the top straight (y = 0, heading east): the outside of the right turn at s = 100 is north.
    for (const b of boards) expect(b.y).toBeLessThan(-(13 + vergeTotal));
  });

  it('are none when the track has no braking points (the lot and older track files)', () => {
    expect(boardsFor(interlagos)).toEqual([]);
    expect(boardsFor(rectangle(false, {}))).toEqual([]);
  });

  it('stand off the road on Interlagos for braking points spread round the lap', () => {
    const brakePoints = Array.from({ length: 12 }, (_, i) => ({ s: 150 + i * 340, name: 'C' + i }));
    const boards = boardsFor({ ...interlagos, brakePoints });
    expect(boards).toHaveLength(48);
    for (const b of boards) {
      const near = nearestOnCenterline(interlagos, b.x, b.y);
      expect(near.distance, `board ${b.label} at s ${b.s}`).toBeGreaterThan(near.width / 2 + vergeTotal);
    }
  });
});

describe('apex kerbs', () => {
  it('follow the given edge, just outside the road, for the given stretch', () => {
    // s 120..160 runs south along x = 1000; the driver's right is west (smaller x).
    const t = rectangle(false, { apexKerbs: [{ from: 120, to: 160, side: 'right', width: 3 }] });
    const [k] = kerbsFor(t);
    expect(k).toBeDefined();
    expect(k!.width).toBe(3);
    for (const [x, y] of k!.pts) {
      expect(x).toBeCloseTo(1000 - 13 - 1.5, 6);
      expect(y).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(y).toBeLessThanOrEqual(60 + 1e-9);
    }
    expect(k!.pts[0]![1]).toBeCloseTo(20, 6);
    expect(k!.pts[k!.pts.length - 1]![1]).toBeCloseTo(60, 6);
  });

  it('may cross the start line', () => {
    const t = rectangle(false, { apexKerbs: [{ from: 3180, to: 20, side: 'left', width: 2 }] });
    const [k] = kerbsFor(t);
    const first = k!.pts[0]!, last = k!.pts[k!.pts.length - 1]!;
    expect(last[0] - first[0]).toBeCloseTo(40, 6); // 40 m east along the top straight
    for (const [, y] of k!.pts) expect(y).toBeCloseTo(-14, 6); // left of eastbound is north
  });

  it('are none when the track has no apex kerbs', () => {
    expect(kerbsFor(interlagos)).toEqual([]);
  });
});

describe('drawing boards and kerbs', () => {
  const view = { x0: 500 * PX, y0: -100 * PX, x1: 1100 * PX, y1: 100 * PX };

  it('writes each board number on the board, readable at speed', () => {
    const t = rectangle(false, { brakePoints: [{ s: 80, name: 'Curva 1' }] });
    const rec = recordingContext();
    drawTrack(rec.ctx, buildTrackArt(t, PX), view);
    const texts = rec.texts().map(([s]) => s);
    for (const label of ['200', '150', '100', '50']) expect(texts).toContain(label);
    const font = String(rec.ctx.font);
    // Board text is at least 2.4 m tall in world pixels, so it stays above 15 screen px at the widest zoom.
    expect(Number(/(\d+)px/.exec(font)?.[1])).toBeGreaterThanOrEqual(2.4 * PX - 1);
  });

  it('draws the apex kerb as a red and white stripe', () => {
    const t = rectangle(false, { apexKerbs: [{ from: 3150, to: 50, side: 'left', width: 3 }] });
    const rec = recordingContext();
    drawTrack(rec.ctx, buildTrackArt(t, PX), view);
    const dashes = rec.calls.filter(([k]) => k === 'setLineDash').map(([, a]) => a[0] as number[]);
    expect(dashes.filter((d) => d.length === 2)).toHaveLength(2); // the verge kerb and the apex kerb
  });

  it('draws exactly as before when the track has neither field', () => {
    const plain = recordingContext(), withEmpty = recordingContext();
    drawTrack(plain.ctx, buildTrackArt(rectangle(false, {}), PX), view);
    drawTrack(withEmpty.ctx, buildTrackArt(rectangle(false, { apexKerbs: [], brakePoints: [] }), PX), view);
    expect(withEmpty.calls).toEqual(plain.calls);
    expect(plain.texts().map(([s]) => s)).not.toContain('200');
  });

  it('skips boards and kerbs outside the view', () => {
    const t = rectangle(false, { brakePoints: [{ s: 1500, name: 'far' }], apexKerbs: [{ from: 1500, to: 1550, side: 'left', width: 3 }] });
    const plain = recordingContext(), marked = recordingContext();
    drawTrack(plain.ctx, buildTrackArt(rectangle(false, {}), PX), view);
    drawTrack(marked.ctx, buildTrackArt(t, PX), view);
    expect(marked.calls).toEqual(plain.calls);
  });
});
