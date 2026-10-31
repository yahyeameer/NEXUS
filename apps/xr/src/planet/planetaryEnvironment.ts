// PlanetaryEnvironment: what sits on the placed surface. Two views of the same anchor:
//   globe  — NASA's Moon at table size, with the survey region marked;
//   region — one demo site's LROC terrain as a tabletop model on a thin base.
// Both live inside the Diorama pivot, so placement, turning, zoom and picking work the same way for each.
import { CanvasTexture, CircleGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, RingGeometry, CylinderGeometry, SphereGeometry, Quaternion, Vector3 } from "three";
import type { Object3D } from "three";
import { Diorama } from "../scene/diorama.js";
import { DEFAULT_TABLE } from "../scene/tabletop.js";
import { HEX } from "../ui/spatial/tokens.js";
import { MoonModel } from "./moonModel.js";

export type EnvironmentMode = "globe" | "region";

/** Globe diameter on the table: big enough to read the maria, small enough for a desk or a phone's view. */
export const GLOBE_DIAMETER_M = 0.32;
const REGION_SIZE_M = DEFAULT_TABLE.sizeM;
const BASE_THICKNESS_M = 0.012;

/** A soft dark pool under the placed object so it reads as resting on the real surface. */
function contactShadow(): Mesh<CircleGeometry, MeshBasicMaterial> {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(0.55, "rgba(0,0,0,0.25)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const m = new Mesh(new CircleGeometry(1, 48), new MeshBasicMaterial({ map: new CanvasTexture(c), transparent: true, depthWrite: false, side: DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

/** Ring, stem and bead marking a surveyed region on the globe, standing out of the surface along its normal. */
class GlobeRegionMarker {
  readonly group = new Group();
  private readonly ring: Mesh<RingGeometry, MeshBasicMaterial>;

  constructor() {
    this.group.name = "globe-region-marker";
    this.ring = new Mesh(new RingGeometry(0.009, 0.012, 40), new MeshBasicMaterial({ color: HEX.accent, transparent: true, opacity: 0.95, side: DoubleSide, depthWrite: false }));
    const stem = new Mesh(new CylinderGeometry(0.0007, 0.0007, 0.03, 8), new MeshBasicMaterial({ color: HEX.accent, transparent: true, opacity: 0.7 }));
    stem.position.y = 0.015;
    const bead = new Mesh(new SphereGeometry(0.0035, 16, 12), new MeshBasicMaterial({ color: HEX.selected }));
    bead.position.y = 0.03;
    // The marker's local +Y is the surface normal; the ring lies in the tangent plane.
    this.ring.rotation.x = -Math.PI / 2;
    this.group.add(this.ring, stem, bead);
  }

  /** Stand on the surface at `point` (spin coordinates), pointing out along `normal`. */
  setPose(point: Vector3, normal: Vector3): void {
    this.group.position.copy(point);
    this.group.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), normal));
  }

  update(now: number, hover: boolean): void {
    const k = 0.5 + 0.5 * Math.sin(now / 600);
    this.ring.material.opacity = hover ? 1 : 0.6 + 0.35 * k;
    this.ring.scale.setScalar(hover ? 1.25 : 1);
  }
}

export class PlanetaryEnvironment {
  readonly diorama = new Diorama();
  readonly moon = new MoonModel(GLOBE_DIAMETER_M / 2);
  private readonly globeRoot = new Group();
  private readonly regionBase = new Group();
  private readonly shadow = contactShadow();
  private readonly marker = new GlobeRegionMarker();
  private _mode: EnvironmentMode = "region";
  private site?: Object3D;
  private markerAt?: { lat: number; lon: number };

  constructor() {
    const c = DEFAULT_TABLE.center;
    // Globe resting on the surface: its centre one radius above the table point.
    this.globeRoot.name = "globe-root";
    this.globeRoot.position.set(c.x, c.y + GLOBE_DIAMETER_M / 2, c.z);
    this.globeRoot.add(this.moon.group);
    this.moon.spin.add(this.marker.group);
    this.marker.group.visible = false;
    // A thin graphite base under the terrain, like a physical relief model, with a hairline cyan edge.
    const slab = new BoxGeometry(REGION_SIZE_M, BASE_THICKNESS_M, REGION_SIZE_M);
    const base = new Mesh(slab, new MeshStandardMaterial({ color: 0x1a1f27, roughness: 0.6, metalness: 0.2 }));
    const edge = new LineSegments(new EdgesGeometry(slab), new LineBasicMaterial({ color: HEX.accentDim, transparent: true, opacity: 0.6 }));
    for (const o of [base, edge]) o.position.set(c.x, c.y - BASE_THICKNESS_M / 2 - 0.0005, c.z);
    this.regionBase.add(base, edge);
    this.shadow.position.set(c.x, c.y - BASE_THICKNESS_M - 0.001, c.z);
    this.diorama.setContent(this.shadow);
  }

  get mode(): EnvironmentMode {
    return this._mode;
  }

  /** What hand rays and taps pick in the current mode. */
  pickable(siteTerrain: Object3D | undefined): Object3D | undefined {
    return this._mode === "globe" ? this.moon.mesh : siteTerrain;
  }

  /** Diameter of the current view's footprint, for the placement reticle. */
  footprintM(mode: EnvironmentMode = this._mode): number {
    return mode === "globe" ? GLOBE_DIAMETER_M : REGION_SIZE_M * Math.SQRT2;
  }

  showGlobe(): void {
    this._mode = "globe";
    this.diorama.setContent(this.globeRoot, this.site);
    this.diorama.setContent(undefined, this.regionBase);
    this.shadow.scale.setScalar(GLOBE_DIAMETER_M * 0.62);
    this.shadow.position.y = DEFAULT_TABLE.center.y + 0.001;
  }

  /** Show a site's terrain group (scene/terrain.ts) and remember it for later swaps. */
  showRegion(site: Object3D | undefined): void {
    this._mode = "region";
    this.diorama.setContent(undefined, this.globeRoot);
    if (this.site && this.site !== site) this.diorama.setContent(undefined, this.site);
    this.site = site;
    this.diorama.setContent(this.regionBase);
    if (site) this.diorama.setContent(site);
    this.shadow.scale.setScalar(REGION_SIZE_M * 0.82);
    this.shadow.position.y = DEFAULT_TABLE.center.y - BASE_THICKNESS_M - 0.001;
  }

  /** Swap the site while in region mode, or just remember it while the globe shows. */
  setSite(site: Object3D, previous: Object3D | undefined): void {
    if (previous && previous !== site) this.diorama.setContent(undefined, previous);
    this.site = site;
    if (this._mode === "region") this.diorama.setContent(site);
  }

  /** Mark the surveyed region and turn the globe so it faces the viewer. */
  markRegion(at: { lat: number; lon: number }): void {
    this.markerAt = at;
    const p = this.moon.surfacePoint(at.lat, at.lon);
    const point = new Vector3(p.x, p.y, p.z);
    this.marker.setPose(point, point.clone().normalize());
    this.marker.group.visible = true;
    this.moon.focus(at.lon);
  }

  get regionMark(): { lat: number; lon: number } | undefined {
    return this.markerAt;
  }

  /** World position of the region marker's bead (targets for hands and tests). */
  markerWorld(out: Vector3): Vector3 | undefined {
    if (!this.markerAt || this._mode !== "globe" || !this.moon.loaded) return undefined;
    this.marker.group.updateWorldMatrix(true, false);
    return this.marker.group.localToWorld(out.set(0, 0, 0));
  }

  /** Lat/lon of a world point on the globe (a ray hit), in the model's frame. */
  globeLatLon(world: Vector3): Vector3 {
    this.moon.spin.updateWorldMatrix(true, false);
    return this.moon.spin.worldToLocal(world.clone());
  }

  update(now: number, hoverMarker: boolean): void {
    if (this._mode === "globe") this.marker.update(now, hoverMarker);
  }
}
