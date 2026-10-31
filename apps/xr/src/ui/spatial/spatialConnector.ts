// SpatialConnector: a soft cyan arc tying a panel to the rock or anchor it is about, with a light pulse travelling
// along it so the link reads as live. Endpoints are world space; geometry is updated in place (no per-frame allocation).
import { AdditiveBlending, BufferAttribute, BufferGeometry, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from "three";
import { HEX } from "./tokens.js";

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** Point `t` (0–1) on a quadratic arc from `a` to `b` whose midpoint is lifted by `lift` metres. Pure. */
export function arcPoint(a: P3, b: P3, lift: number, t: number, out: P3): P3 {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2 + lift;
  const cz = (a.z + b.z) / 2;
  const u = 1 - t;
  out.x = u * u * a.x + 2 * u * t * cx + t * t * b.x;
  out.y = u * u * a.y + 2 * u * t * cy + t * t * b.y;
  out.z = u * u * a.z + 2 * u * t * cz + t * t * b.z;
  return out;
}

const DOT = new SphereGeometry(0.0035, 12, 8);

export class SpatialConnector {
  readonly object = new Group();
  private readonly positions: Float32Array;
  private readonly geometry = new BufferGeometry();
  private readonly attribute: BufferAttribute;
  private readonly line: Line<BufferGeometry, LineBasicMaterial>;
  private readonly pulse: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly end: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly tmp: P3 = { x: 0, y: 0, z: 0 };
  private lift = 0.05;
  private target = 0;
  private level = 0;

  constructor(
    name: string,
    private readonly segments = 40,
    color: number = HEX.accent,
  ) {
    this.positions = new Float32Array((segments + 1) * 3);
    this.attribute = new BufferAttribute(this.positions, 3);
    this.geometry.setAttribute("position", this.attribute);
    this.line = new Line(this.geometry, new LineBasicMaterial({ color, transparent: true, opacity: 0, depthTest: false, blending: AdditiveBlending }));
    this.pulse = new Mesh(DOT, new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false }));
    this.end = new Mesh(DOT, new MeshBasicMaterial({ color, transparent: true, opacity: 0, depthTest: false }));
    for (const o of [this.line, this.pulse, this.end]) o.renderOrder = 4;
    this.line.frustumCulled = false;
    this.object.name = `connector:${name}`;
    this.object.add(this.line, this.pulse, this.end);
    this.object.visible = false;
  }

  /** Moves the endpoints (world space). Cheap enough to call every frame. */
  set(from: Vector3, to: Vector3, lift = 0.05): void {
    this.a.copy(from);
    this.b.copy(to);
    this.lift = lift;
    for (let i = 0; i <= this.segments; i++) {
      arcPoint(this.a, this.b, lift, i / this.segments, this.tmp);
      this.positions[i * 3] = this.tmp.x;
      this.positions[i * 3 + 1] = this.tmp.y;
      this.positions[i * 3 + 2] = this.tmp.z;
    }
    this.attribute.needsUpdate = true;
    this.end.position.copy(this.a);
  }

  show(): void {
    this.target = 1;
    this.object.visible = true;
  }

  hide(): void {
    this.target = 0;
  }

  get shown(): boolean {
    return this.target === 1;
  }

  update(now: number, dtMs: number): void {
    if (!this.object.visible) return;
    this.level += Math.sign(this.target - this.level) * Math.min(Math.abs(this.target - this.level), dtMs / 220);
    if (this.level <= 0 && this.target === 0) {
      this.object.visible = false;
      return;
    }
    const t = (now / 1600) % 1;
    arcPoint(this.a, this.b, this.lift, t, this.tmp);
    this.pulse.position.set(this.tmp.x, this.tmp.y, this.tmp.z);
    this.line.material.opacity = 0.55 * this.level;
    this.pulse.material.opacity = 0.9 * this.level * Math.sin(Math.PI * t);
    this.end.material.opacity = 0.9 * this.level;
  }
}
