// Terrain manipulation by hand (INTERACTION.md §1–§2): pinch + drag rotates, two-hand pinch zooms, a short
// still pinch selects. Pure so the gesture thresholds are unit-tested.

export interface Point2 {
  x: number;
  z: number;
}

/**
 * A pinch whose hand moves less than this is a select, not a drag. Distance only: a slow, still pinch is still a
 * select, and frame timing (the emulator's software GL, a busy headset) never turns a select into a drag.
 */
export const TAP_MAX_MOVE_M = 0.02;
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3;

export function isTap(moveM: number): boolean {
  return moveM < TAP_MAX_MOVE_M;
}

/** Signed yaw change (radians, counter-clockwise seen from above) of a hand circling the pivot. */
export function yawDelta(pivot: Point2, from: Point2, to: Point2): number {
  const a = Math.atan2(-(from.z - pivot.z), from.x - pivot.x);
  const b = Math.atan2(-(to.z - pivot.z), to.x - pivot.x);
  let d = b - a;
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Two-hand zoom: the scale follows the ratio of hand separation, clamped so the diorama stays usable. */
export function zoomedScale(scale: number, fromDistM: number, toDistM: number): number {
  if (fromDistM <= 0.01) return scale;
  return clampScale(scale * (toDistM / fromDistM));
}

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}
