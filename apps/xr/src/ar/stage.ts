// The stage: where the explorer was placed in the room (PRD §6.1, AR placement). Everything NEXUS shows is laid out
// once for a seated user at the origin looking at DEFAULT_TABLE (scene/tabletop.ts); the stage maps that layout onto
// the surface the scientist tapped. Two frames, because people read panels at head height whatever the surface:
//   - surface frame: terrain, globe and anything resting on the table follow the tapped point;
//   - view frame:    panels keep their distance and height relative to the viewer at placement, turned to face
//                    the placed object, so a Moon set on the floor two metres away still has readable panels.
// Pure so placement maths is unit-tested; the default stage is the identity, so the emulator layout is unchanged.
import type { Vec3 } from "../scene/tabletop.js";
import { DEFAULT_TABLE } from "../scene/tabletop.js";

/** The seated viewer the default layout was designed around (scene/world.ts camera). */
export const DEFAULT_HEAD: Vec3 = { x: 0, y: 1.2, z: 0 };

export interface StagePose {
  /** The tapped surface point; the placed object's base sits here. */
  surface: Vec3;
  /** Radians about +Y. 0 means the layout's front (+Z) faces +Z, as in the default seated layout. */
  yaw: number;
  /** Viewer position when the object was placed. */
  head: Vec3;
}

export const DEFAULT_STAGE: StagePose = { surface: { ...DEFAULT_TABLE.center }, yaw: 0, head: { ...DEFAULT_HEAD } };

/** Yaw that turns the layout's front (+Z) from the surface point toward the viewer. */
export function yawFacing(surface: Vec3, head: Vec3): number {
  const dx = head.x - surface.x;
  const dz = head.z - surface.z;
  if (Math.hypot(dx, dz) < 1e-6) return 0;
  return Math.atan2(dx, dz);
}

export function stageFromPlacement(surface: Vec3, head: Vec3): StagePose {
  return { surface: { ...surface }, yaw: yawFacing(surface, head), head: { ...head } };
}

function rotateY(x: number, z: number, yaw: number): { x: number; z: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: c * x + s * z, z: -s * x + c * z };
}

/** A default-layout point resting on the table, moved onto the placed surface. */
export function surfaceToWorld(stage: StagePose, p: Vec3): Vec3 {
  const t = DEFAULT_TABLE.center;
  const r = rotateY(p.x - t.x, p.z - t.z, stage.yaw);
  return { x: stage.surface.x + r.x, y: stage.surface.y + (p.y - t.y), z: stage.surface.z + r.z };
}

/**
 * A default-layout point positioned for the viewer (panels, menus), moved into the viewer frame. The panels keep
 * their offset from the head; the frame turns so "in front" means toward the placed object.
 */
export function viewToWorld(stage: StagePose, p: Vec3): Vec3 {
  const h = DEFAULT_HEAD;
  const r = rotateY(p.x - h.x, p.z - h.z, viewYaw(stage));
  return { x: stage.head.x + r.x, y: stage.head.y + (p.y - h.y), z: stage.head.z + r.z };
}

/**
 * The view frame's yaw. In the default layout the viewer looks along -Z at the table, and the object's front faces
 * +Z back at them, so both frames share the same yaw.
 */
export function viewYaw(stage: StagePose): number {
  return stage.yaw;
}
