// InputFrame v1: one tick of player input (docs/sprints/SPRINT-001/mailbox/main-dev-to-back-end-input-frame.md).
export interface InputFrame {
  throttle: number; // 0..1 (v24 key W)
  brake: number; // 0..1 (v24 key S)
  left: number; // 0..1 (v24 key A)
  right: number; // 0..1 (v24 key D)
  shiftUp: boolean; // one-tick press (v24 Period)
  shiftDown: boolean; // one-tick press (v24 Comma)
  toggleAuto: boolean; // one-tick press (v24 KeyM)
}
