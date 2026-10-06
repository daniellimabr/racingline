// Test-only driver: steers toward a point ahead on the centerline with the on/off keys and holds a
// target speed. It records the frames it pressed, so a test can replay them through the real run setup.
import type { InputFrame } from '../../src/core/input-frame.ts';
import { step } from '../../src/core/sim.ts';
import { centerlineAt, type Track } from '../../src/data/track.ts';
import type { Run } from '../../src/run.ts';
import { carStep } from '../../src/sim/index.ts';

const IDLE: InputFrame = { throttle: 0, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false };

/** Distance along the centerline of the point nearest (x, y). */
function progress(track: Track, x: number, y: number): number {
  const pts = track.points;
  let best = Infinity, s = 0, at = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    const ex = q[0] - p[0], ey = q[1] - p[1], len = Math.hypot(ex, ey);
    const t = Math.min(1, Math.max(0, ((x - p[0]) * ex + (y - p[1]) * ey) / (len * len)));
    const d = Math.hypot(x - p[0] - ex * t, y - p[1] - ey * t);
    if (d < best) {
      best = d;
      s = at + t * len;
    }
    at += len;
  }
  return s;
}

/** Drives `ticks` ticks from the run's start and returns the frames used. */
export function autopilot(run: Run, track: Track, ticks: number, speed = 14, look = 12): InputFrame[] {
  const frames: InputFrame[] = [];
  let state = run.state;
  for (let i = 0; i < ticks; i++) {
    const c = state.car;
    const s = progress(track, c.x, c.y);
    const ahead = centerlineAt(track, s + look), far = centerlineAt(track, s + 40);
    let e = Math.atan2(ahead.y - c.y, ahead.x - c.x) - c.h;
    e = Math.atan2(Math.sin(e), Math.cos(e));
    const bend = Math.abs(Math.atan2(ahead.dx * far.dy - ahead.dy * far.dx, ahead.dx * far.dx + ahead.dy * far.dy));
    const target = bend > 0.6 ? speed * 0.7 : speed;
    const want = Math.max(-1, Math.min(1, e * 2.5));
    const frame: InputFrame = {
      ...IDLE,
      throttle: c.v < target - 0.5 ? 1 : 0,
      brake: c.v > target + 1.5 ? 1 : 0,
      right: c.st < want ? 1 : 0,
      left: c.st > want ? 1 : 0,
    };
    frames.push(frame);
    state = step(state, frame, run.params, carStep);
  }
  return frames;
}
