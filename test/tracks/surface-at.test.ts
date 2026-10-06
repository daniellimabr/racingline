// Surface lookup (S003-T5, for T6 per-wheel grip and drag): road between the edges, then the verge
// bands outward, then the outside surface (ADR-005). Pure and fast enough for every wheel every tick.
import { describe, expect, it } from 'vitest';
import { edgeDistance, onRoad, surfaceAt } from '../../src/tracks/surface-at.ts';
import { TRACKS } from '../../src/tracks/index.ts';
import { centerlineAt, type Track } from '../../src/data/track.ts';
import { BOX } from '../sim/box-track.ts';

const interlagos = TRACKS.find((t) => t.id === 'interlagos')!;

describe('surfaceAt', () => {
  it.each([
    [50, 0, 'asphalt'], // centerline
    [50, 5.99, 'asphalt'],
    [50, 6, 'asphalt'], // exactly on the edge is still the road
    [50, -6.5, 'kerb'],
    [50, 7, 'kerb'], // the 1 m kerb ends exactly here
    [50, 7.01, 'grass'],
    [0, 50, 'grass'], // inside the box, far from the road
    [500, 500, 'grass'],
    [100, 50, 'asphalt'], // right side, heading south
    [93.5, 50, 'kerb'],
  ])('(%d, %d) is %s on the box', (x, y, name) => {
    expect(surfaceAt(BOX, x, y)).toBe(name);
  });

  it('gives the distance past the road edge, negative on the road', () => {
    expect(edgeDistance(BOX, 50, 0)).toBeCloseTo(-6, 9);
    expect(edgeDistance(BOX, 50, 9)).toBeCloseTo(3, 9);
    expect(onRoad(BOX, 50, 6)).toBe(true);
    expect(onRoad(BOX, 50, 6.01)).toBe(false);
  });

  it('works on Interlagos: the spawn is on the road and 20 m sideways is grass', () => {
    const { x, y, h } = interlagos.spawn;
    expect(surfaceAt(interlagos, x, y)).toBe(interlagos.road);
    expect(surfaceAt(interlagos, x - Math.sin(h) * 12.9, y + Math.cos(h) * 12.9)).toBe(interlagos.road); // 26 m wide
    expect(surfaceAt(interlagos, x - Math.sin(h) * 13.9, y + Math.cos(h) * 13.9)).toBe('kerb');
    expect(surfaceAt(interlagos, x - Math.sin(h) * 20, y + Math.cos(h) * 20)).toBe(interlagos.outside);
  });

  it('treats an apex kerb stretch as kerb for its full width, only on its side and only along its stretch (S004-T4)', () => {
    // Top of the box heads east, so the driver's right is south (y grows). Kerb: s 20..60 m, right side, 3 m wide.
    const box: Track = { ...BOX, apexKerbs: [{ from: 20, to: 60, side: 'right', width: 3 }] };
    expect(surfaceAt(box, 40, 5)).toBe('asphalt'); // the road is unchanged
    expect(surfaceAt(box, 40, 6.5)).toBe('kerb');
    expect(surfaceAt(box, 40, 8.5)).toBe('kerb'); // beyond the normal 1 m kerb, inside the 3 m apex kerb
    expect(surfaceAt(box, 40, 9)).toBe('kerb'); // exactly at its outer edge
    expect(surfaceAt(box, 40, 9.01)).toBe('grass');
    expect(surfaceAt(box, 40, -8.5)).toBe('grass'); // the left side keeps its 1 m kerb
    expect(surfaceAt(box, 15, 8.5)).toBe('grass'); // before the stretch
    expect(surfaceAt(box, 65, 8.5)).toBe('grass'); // after the stretch
    expect(onRoad(box, 40, 6.5)).toBe(false); // a kerb is still off the track
    expect(surfaceAt(BOX, 40, 8.5)).toBe('grass'); // the plain box has no apex kerbs
  });

  it('finds the apex kerbs on Interlagos: 1.5 m past the inside edge at each kerb middle is kerb, the outside edge is not', () => {
    for (const k of interlagos.apexKerbs) {
      const c = centerlineAt(interlagos, (k.from + k.to) / 2);
      const left = k.side === 'left' ? 1 : -1, off = c.width / 2 + 1.5; // driver's left is (dy, -dx) with y south
      expect(surfaceAt(interlagos, c.x + c.dy * off * left, c.y - c.dx * off * left)).toBe('kerb');
      expect(surfaceAt(interlagos, c.x - c.dy * off * left, c.y + c.dx * off * left)).toBe('grass');
    }
  });

  it('every surface name it returns has grip and drag in the track file', () => {
    for (const [x, y] of [[0, 0], [0, 6.8], [0, 30]] as const) expect(interlagos.surfaces[surfaceAt(interlagos, x, y)]).toBeDefined();
  });

  it('is fast enough for every wheel and axle every tick on a ~300 point track', () => {
    // Per tick: 4 wheels for the off-track rule and 2 axles for surface grip (T6); 8 leaves headroom.
    expect(interlagos.points.length).toBeGreaterThan(250);
    const perTick = 8, n = perTick * 600; // 10 s of driving
    const t0 = performance.now();
    let road = 0;
    for (let i = 0; i < n; i++) if (onRoad(interlagos, (i % 1200) - 600, ((i * 7) % 1200) - 600)) road++;
    const msPerTick = ((performance.now() - t0) / n) * perTick;
    expect(road).toBeGreaterThan(0);
    expect(msPerTick).toBeLessThan(2); // of a 16.7 ms frame, even under coverage instrumentation
  });
});
