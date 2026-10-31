// ObservationMarker: what a scientist can pinch on the terrain. A thin glowing ring on the ground, a short stem and a
// bead above it, plus a ResearchStatusIndicator once research has started. Colour follows INTERACTION.md §4.
import { AdditiveBlending, CylinderGeometry, Group, Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry } from "three";
import type { Vector3 } from "three";
import type { RingState } from "../findingView.js";
import { ResearchStatusIndicator } from "./statusIndicator.js";
import { HEX } from "./tokens.js";

export type MarkerState = RingState | "idle" | "selected";

/** INTERACTION.md §4. "idle" glows so first-time users know what they can pinch. */
export const MARKER_COLORS: Record<MarkerState, number> = {
  idle: HEX.accent,
  selected: HEX.selected,
  observed: HEX.grey,
  researching: HEX.accent,
  ready: HEX.amber,
  needs_evidence: HEX.amber,
  reviewed: HEX.green,
  closed: HEX.grey,
};

const STEM_H = 0.022;
const STEM = new CylinderGeometry(0.0006, 0.0006, STEM_H, 6, 1, true);
const BEAD = new SphereGeometry(0.0032, 12, 8);

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export class ObservationMarker {
  readonly group = new Group();
  /** Kept as `ring` so picking, tests and colour checks have one mesh to look at. */
  readonly ring: Mesh<RingGeometry, MeshBasicMaterial>;
  private readonly halo: Mesh<RingGeometry, MeshBasicMaterial>;
  private readonly stem: Mesh<CylinderGeometry, MeshBasicMaterial>;
  private readonly bead: Mesh<SphereGeometry, MeshBasicMaterial>;
  readonly status: ResearchStatusIndicator;
  private state: MarkerState = "idle";
  private hovered = false;
  private readonly phase: number;

  constructor(
    readonly featureId: string,
    anchor: Vec3Like,
    radius: number,
  ) {
    this.phase = (featureId.length * 1.7) % 6.28;
    this.ring = new Mesh(new RingGeometry(radius * 0.9, radius, 64), new MeshBasicMaterial({ color: HEX.accent, transparent: true, opacity: 0.85, depthTest: false }));
    this.halo = new Mesh(new RingGeometry(radius, radius * 1.35, 64), new MeshBasicMaterial({ color: HEX.accent, transparent: true, opacity: 0.12, depthTest: false, blending: AdditiveBlending, depthWrite: false }));
    for (const r of [this.ring, this.halo]) {
      r.rotation.x = -Math.PI / 2;
      r.renderOrder = 2;
    }
    this.stem = new Mesh(STEM, new MeshBasicMaterial({ color: HEX.accent, transparent: true, opacity: 0.6, depthTest: false }));
    this.stem.position.y = STEM_H / 2;
    this.bead = new Mesh(BEAD, new MeshBasicMaterial({ color: HEX.accent, transparent: true, depthTest: false }));
    this.bead.position.y = STEM_H;
    this.stem.renderOrder = this.bead.renderOrder = 3;
    this.status = new ResearchStatusIndicator(featureId);
    this.status.mesh.position.y = STEM_H + 0.02;
    this.group.name = `marker:${featureId}`;
    this.ring.name = `marker:${featureId}`;
    this.group.position.set(anchor.x, anchor.y + 0.004, anchor.z);
    this.group.add(this.halo, this.ring, this.stem, this.bead, this.status.mesh);
  }

  setState(state: MarkerState): void {
    this.state = state;
    const c = MARKER_COLORS[state];
    for (const m of [this.ring.material, this.halo.material, this.stem.material, this.bead.material]) m.color.setHex(c);
    this.status.set(state === "idle" || state === "selected" ? undefined : state);
  }

  setHover(hovered: boolean): void {
    this.hovered = hovered;
  }

  /** Per frame: breathe when idle, pulse while researching, swell under the pointer; the pill faces the viewer. */
  update(now: number, viewer: Vector3, parentScale: number): void {
    const researching = this.state === "researching" || this.state === "needs_evidence";
    const emphasis = this.hovered || this.state === "selected";
    this.ring.material.opacity = researching ? 0.5 + 0.4 * Math.sin(now / 250) : emphasis ? 1 : 0.7 + 0.15 * Math.sin(now / 650 + this.phase);
    this.halo.material.opacity = emphasis ? 0.32 : researching ? 0.2 + 0.15 * Math.sin(now / 250) : 0.1;
    const k = this.hovered ? 1.3 : this.state === "selected" ? 1.12 : 1;
    this.ring.scale.setScalar(k);
    this.halo.scale.setScalar(k);
    this.bead.position.y = STEM_H + (researching ? 0.002 * Math.sin(now / 300) : 0);
    this.status.face(viewer, parentScale);
  }
}
