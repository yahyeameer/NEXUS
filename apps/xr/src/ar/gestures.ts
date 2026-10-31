// Touch gesture maths for phone AR (brief: "gesture manipulation"). Pure so thresholds are unit-tested; the DOM
// side lives in gestureController.ts.

export interface Touch2 {
  x: number;
  y: number;
}

/** Pixels a single finger must travel before a touch counts as a drag rather than a tap. */
export const DRAG_START_PX = 10;
/** Radians of yaw per pixel of horizontal one-finger drag. */
export const YAW_PER_PX = 0.008;

/** Two-finger pinch and twist between frames: scale factor and rotation in radians (counter-clockwise positive). */
export function twoFinger(prevA: Touch2, prevB: Touch2, nextA: Touch2, nextB: Touch2): { scale: number; rotation: number } {
  const d0 = Math.hypot(prevB.x - prevA.x, prevB.y - prevA.y);
  const d1 = Math.hypot(nextB.x - nextA.x, nextB.y - nextA.y);
  const a0 = Math.atan2(prevB.y - prevA.y, prevB.x - prevA.x);
  const a1 = Math.atan2(nextB.y - nextA.y, nextB.x - nextA.x);
  let rotation = a1 - a0;
  if (rotation > Math.PI) rotation -= 2 * Math.PI;
  if (rotation < -Math.PI) rotation += 2 * Math.PI;
  // Screen y points down, so a clockwise twist on screen is a negative angle in world terms.
  return { scale: d0 < 1 ? 1 : d1 / d0, rotation: -rotation };
}

export function isDrag(dxPx: number, dyPx: number): boolean {
  return Math.hypot(dxPx, dyPx) >= DRAG_START_PX;
}
