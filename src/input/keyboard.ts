// Keyboard device, mirrors prototype-v24.html lines 79-85.
// Pedal/steer ramps live in the sim; this only reports 0/1 while held plus one-tick presses.
import type { InputFrame } from '../core/input-frame.ts';
import { idleFrame, type InputDevice } from './device.ts';

/** Minimal event source (a canvas, window or test fake); keeps DOM coupling out of the device. */
export interface KeyTarget {
  addEventListener(type: string, listener: (e: KeyEventLike) => void): void;
  removeEventListener(type: string, listener: (e: KeyEventLike) => void): void;
}
/** The part of a DOM KeyboardEvent the device reads. */
export interface KeyEventLike {
  code: string;
  repeat?: boolean;
  preventDefault(): void;
}
export interface KeyboardOptions {
  /** P key. Pause is not an input (a paused game does not tick); the app owns it. */
  onPause?: () => void;
}

type Held = 'throttle' | 'brake' | 'left' | 'right';
type Press = 'shiftUp' | 'shiftDown' | 'toggleAuto';

const HELD: Readonly<Record<string, Held>> = {
  KeyW: 'throttle', ArrowUp: 'throttle', KeyS: 'brake', ArrowDown: 'brake',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};
const PRESS: Readonly<Record<string, Press>> = {
  Period: 'shiftUp', NumpadDecimal: 'shiftUp', Comma: 'shiftDown', KeyM: 'toggleAuto',
};

export class KeyboardDevice implements InputDevice {
  // State is per action, not per key, as in v24 (W and ArrowUp share 'w').
  private held = new Set<Held>();
  private pending = new Set<Press>();

  private readonly onKeyDown = (e: KeyEventLike) => {
    if (e.code === 'KeyP') {
      if (!e.repeat) this.opts.onPause?.();
      e.preventDefault();
      return;
    }
    const press = Object.hasOwn(PRESS, e.code) ? PRESS[e.code] : undefined;
    if (press && !e.repeat) {
      this.pending.add(press);
      e.preventDefault();
      return;
    }
    const held = Object.hasOwn(HELD, e.code) ? HELD[e.code] : undefined;
    if (held) {
      this.held.add(held);
      e.preventDefault();
    }
  };
  private readonly onKeyUp = (e: KeyEventLike) => {
    const held = Object.hasOwn(HELD, e.code) ? HELD[e.code] : undefined;
    if (held) this.held.delete(held);
  };
  // Focus loss releases all held keys (v24 line 85). Pending presses already happened, so they stay.
  private readonly onBlur = () => this.held.clear();

  constructor(
    private readonly target: KeyTarget,
    private readonly opts: KeyboardOptions = {},
  ) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  sample(): InputFrame {
    const f = idleFrame();
    for (const k of this.held) f[k] = 1;
    for (const k of this.pending) f[k] = true;
    this.pending.clear();
    return f;
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.held.clear();
    this.pending.clear();
  }
}
