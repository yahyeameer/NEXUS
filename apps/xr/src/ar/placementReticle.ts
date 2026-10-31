// PlacementReticle: a quiet ring lying on the detected surface, with the footprint of what will be placed, so the
// scientist sees where and how big before they tap. Restrained cyan, no labels; it hides while searching.
import { DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, CircleGeometry } from "three";
import type { Vector3 } from "three";
import { HEX } from "../ui/spatial/tokens.js";

export class PlacementReticle {
  readonly group = new Group();
  private readonly ring: Mesh<RingGeometry, MeshBasicMaterial>;
  private readonly footprint: Mesh<CircleGeometry, MeshBasicMaterial>;
  private readonly dot: Mesh<CircleGeometry, MeshBasicMaterial>;
  private footprintM = 0.32;

  constructor() {
    this.group.name = "placement-reticle";
    this.ring = new Mesh(new RingGeometry(0.94, 1, 72), new MeshBasicMaterial({ color: HEX.accent, transparent: true, opacity: 0.8, side: DoubleSide, depthWrite: false }));
    this.footprint = new Mesh(new CircleGeometry(1, 72), new MeshBasicMaterial({ color: HEX.accent, transparent: true, opacity: 0.08, side: DoubleSide, depthWrite: false }));
    this.dot = new Mesh(new CircleGeometry(0.008, 24), new MeshBasicMaterial({ color: HEX.selected, transparent: true, opacity: 0.9, side: DoubleSide, depthWrite: false }));
    for (const m of [this.ring, this.footprint, this.dot]) {
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 2;
    }
    this.group.add(this.footprint, this.ring, this.dot);
    this.group.visible = false;
    this.setFootprint(this.footprintM);
  }

  /** Diameter, in metres, of what a tap would place. */
  setFootprint(diameterM: number): void {
    this.footprintM = diameterM;
    const r = diameterM / 2;
    this.ring.scale.setScalar(r);
    this.footprint.scale.setScalar(r);
  }

  show(position: Vector3): void {
    // A millimetre above the surface so it never z-fights with a real table seen in passthrough depth.
    this.group.position.set(position.x, position.y + 0.001, position.z);
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  /** Slow breathing so a found surface reads as live, without flashing. */
  update(now: number): void {
    if (!this.group.visible) return;
    const k = 0.5 + 0.5 * Math.sin(now / 520);
    this.ring.material.opacity = 0.55 + 0.3 * k;
    this.footprint.material.opacity = 0.05 + 0.05 * k;
  }
}
