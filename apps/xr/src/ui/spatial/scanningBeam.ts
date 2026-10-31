// ScanningBeam: while agents research a feature, a faint cyan cone shines down on it and a thin scan ring sweeps
// the ground. Purely visual: it shows work in progress and never stands for a result.
import { AdditiveBlending, CanvasTexture, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry } from "three";
import type { Vec3Like } from "./observationMarker.js";
import { HEX } from "./tokens.js";

const HEIGHT_M = 0.17;

/** Bright at the ground, fading to nothing at the top. */
function verticalFade(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(1, "rgba(255,255,255,1)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 128);
  }
  return new CanvasTexture(c);
}

export class ScanningBeam {
  readonly group = new Group();
  private readonly cone: Mesh<CylinderGeometry, MeshBasicMaterial>;
  private readonly sweep: Mesh<RingGeometry, MeshBasicMaterial>;
  private target = 0;
  private level = 0;
  private radius = 0.04;

  constructor() {
    this.cone = new Mesh(
      new CylinderGeometry(0.004, 1, HEIGHT_M, 40, 1, true),
      new MeshBasicMaterial({ color: HEX.accent, alphaMap: verticalFade(), transparent: true, opacity: 0, side: DoubleSide, depthWrite: false, blending: AdditiveBlending }),
    );
    this.cone.position.y = HEIGHT_M / 2;
    this.sweep = new Mesh(new RingGeometry(0.94, 1, 64), new MeshBasicMaterial({ color: HEX.accent, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: AdditiveBlending }));
    this.sweep.rotation.x = -Math.PI / 2;
    this.cone.renderOrder = this.sweep.renderOrder = 3;
    this.group.name = "scanning-beam";
    this.group.add(this.cone, this.sweep);
    this.group.visible = false;
  }

  /** Shines on `anchor` (layout coordinates) with a footprint of `radius` metres. */
  start(anchor: Vec3Like, radius: number): void {
    this.radius = Math.max(0.02, radius);
    this.group.position.set(anchor.x, anchor.y + 0.002, anchor.z);
    this.cone.scale.set(this.radius, 1, this.radius);
    this.target = 1;
    this.group.visible = true;
  }

  stop(): void {
    this.target = 0;
  }

  get active(): boolean {
    return this.target === 1;
  }

  update(now: number, dtMs: number): void {
    if (!this.group.visible) return;
    this.level += Math.sign(this.target - this.level) * Math.min(Math.abs(this.target - this.level), dtMs / 400);
    if (this.level <= 0 && this.target === 0) {
      this.group.visible = false;
      return;
    }
    const t = (now / 1800) % 1;
    this.cone.material.opacity = this.level * (0.16 + 0.05 * Math.sin(now / 300));
    // The scan ring grows from the centre to the footprint's edge, fading as it goes.
    this.sweep.scale.setScalar(this.radius * (0.15 + 0.85 * t));
    this.sweep.material.opacity = this.level * 0.7 * (1 - t);
  }
}
