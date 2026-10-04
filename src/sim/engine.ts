// v24 engine(), shift() and the gearbox key handlers (prototype lines 80-82 and 129-136).
import { ratio } from './physics.ts';
import type { CarParams } from './params.ts';
import type { CarState } from './state.ts';

const RPM2 = 60 / (2 * Math.PI); // rad/s to rpm

/** Changes gear by d if allowed (v24 shift): starts the no-drive time and the cooldown. */
export function shift(c: CarParams, s: CarState, d: number): void {
  const ng = s.gear + d;
  if (ng < 0 || ng > c.gears.length - 1 || s.shiftCd > 0) return;
  s.gear = ng;
  s.shiftT = c.shiftTime;
  s.shiftCd = c.shiftCooldown;
}

/** A manual gear press (v24 Period/Comma handler): switches to manual, then tries the shift. */
export function manualShift(c: CarParams, s: CarState, d: number): void {
  s.auto = false;
  shift(c, s, d);
}

/** Engine speed, rev limiter and automatic gearbox, once per tick (v24 engine). */
export function engine(c: CarParams, s: CarState, dt: number): void {
  s.shiftT = Math.max(0, s.shiftT - dt);
  s.shiftCd = Math.max(0, s.shiftCd - dt);
  const groundRpm = (Math.max(0, s.vx) / c.wheelRadius) * ratio(c, s.gear) * RPM2;
  const wheelRpm = s.rateR * ratio(c, s.gear) * RPM2;
  let target = Math.max(c.idleRpm, wheelRpm);
  if (s.vx < c.launchSpeed && s.gear === 0) target = Math.max(target, c.idleRpm + s.t * c.launchRpm);
  if (s.shiftT > 0) target = Math.max(c.idleRpm, groundRpm);
  s.rpm += (target - s.rpm) * Math.min(1, dt * c.rpmResponse);
  s.rpm = Math.min(s.rpm, c.cutRpm + c.rpmOvershoot);
  if (s.rpm >= c.cutRpm) s.cut = true;
  else if (s.rpm < c.cutResumeRpm) s.cut = false;
  if (s.auto && s.shiftCd <= 0) {
    if (groundRpm > c.autoUpRpm && s.gear < c.gears.length - 1) shift(c, s, 1);
    else if (
      groundRpm < c.autoDownRpm &&
      s.gear > 0 &&
      (Math.max(0, s.vx) / c.wheelRadius) * ratio(c, s.gear - 1) * RPM2 < c.autoDownMaxRpm
    )
      shift(c, s, -1);
  }
  s.groundRpm = groundRpm;
}
