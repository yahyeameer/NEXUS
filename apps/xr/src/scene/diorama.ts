// The tabletop diorama's pose: yaw and zoom about the table centre. Site geometry is baked in "layout" space
// (scene/tabletop.ts at rest); this group maps layout ↔ world so picking and anchors stay exact while it moves.
import { Group, Vector3 } from "three";
import type { Object3D } from "three";
import { clampScale } from "../input/manipulate.js";
import type { Vec3 } from "./tabletop.js";
import { DEFAULT_TABLE } from "./tabletop.js";

const ROTATE_STEP = Math.PI / 12;
const ZOOM_STEP = 1.25;

export class Diorama {
  readonly pivot = new Group();
  private readonly inner = new Group();
  private readonly center = DEFAULT_TABLE.center;

  constructor() {
    this.pivot.name = "diorama";
    this.pivot.position.set(this.center.x, this.center.y, this.center.z);
    this.inner.position.set(-this.center.x, -this.center.y, -this.center.z);
    this.pivot.add(this.inner);
  }

  get pivotPoint(): { x: number; z: number } {
    return { x: this.center.x, z: this.center.z };
  }

  get scale(): number {
    return this.pivot.scale.x;
  }

  get yaw(): number {
    return this.pivot.rotation.y;
  }

  setContent(obj: Object3D | undefined, previous?: Object3D): void {
    if (previous) this.inner.remove(previous);
    if (obj) this.inner.add(obj);
  }

  rotateBy(rad: number): void {
    this.pivot.rotation.y += rad;
  }

  setScale(s: number): void {
    this.pivot.scale.setScalar(clampScale(s));
  }

  /** Wrist-menu and voice steps (INTERACTION.md parity table: "Rotate left / right", "Zoom in / out"). */
  step(kind: "rotate_left" | "rotate_right" | "zoom_in" | "zoom_out"): void {
    if (kind === "rotate_left") this.rotateBy(ROTATE_STEP);
    else if (kind === "rotate_right") this.rotateBy(-ROTATE_STEP);
    else this.setScale(this.scale * (kind === "zoom_in" ? ZOOM_STEP : 1 / ZOOM_STEP));
  }

  reset(): void {
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.scale.setScalar(1);
  }

  /** World point → layout coordinates (what scene/tabletop.ts sceneToTile expects). */
  toLayout(world: Vector3): Vec3 {
    this.pivot.updateWorldMatrix(true, true);
    const p = this.inner.worldToLocal(world.clone());
    return { x: p.x, y: p.y, z: p.z };
  }

  toWorld(layout: Vec3): Vector3 {
    this.pivot.updateWorldMatrix(true, true);
    return this.inner.localToWorld(new Vector3(layout.x, layout.y, layout.z));
  }
}
