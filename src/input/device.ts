// Device-agnostic input (ADR-001): every device yields part or all of an InputFrame per tick.
import type { InputFrame } from '../core/input-frame.ts';

export interface InputDevice {
  /** Called once per sim tick. Missing fields mean "this device has no opinion" (0 / false). */
  sample(): Partial<InputFrame>;
  /** Detach from the event source and drop any held state. */
  dispose(): void;
}

export const idleFrame = (): InputFrame => ({
  throttle: 0, brake: 0, left: 0, right: 0, shiftUp: false, shiftDown: false, toggleAuto: false,
});

const ANALOG = ['throttle', 'brake', 'left', 'right'] as const;
const PRESSES = ['shiftUp', 'shiftDown', 'toggleAuto'] as const;
const unit = (v: number | undefined) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v!)) : 0);

/** Merge devices into one frame: max of analog values (clamped to 0..1), OR of presses. */
export function combine(devices: readonly InputDevice[]): InputFrame {
  const out = idleFrame();
  for (const d of devices) {
    const s = d.sample();
    for (const k of ANALOG) out[k] = Math.max(out[k], unit(s[k]));
    for (const k of PRESSES) out[k] ||= s[k] === true;
  }
  return out;
}
