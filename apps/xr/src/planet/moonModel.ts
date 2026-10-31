// MoonModel: NASA's LRO colour Moon (SVS 14959, derived to a 2K texture: data/planets/moon/globe/provenance.json).
// The model's own units and CRS are not published, so the globe is only ever a display: it is scaled to a size that
// suits a table, and nothing on it is measured. Lat/lon placement uses the axis convention recorded in provenance.json.
import { Group, MeshStandardMaterial, SRGBColorSpace } from "three";
import type { Material, Mesh, Texture } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export const MOON_GLOBE_URL = `${import.meta.env.BASE_URL}planets/moon/globe/moon_globe_2k.glb`;
export const MOON_PROVENANCE_URL = `${import.meta.env.BASE_URL}planets/moon/globe/provenance.json`;
/** Shown wherever the globe is: the credit line NASA asks for, and what the globe is (and is not). */
export const MOON_CREDIT = "Moon: NASA's Goddard Space Flight Center (SVS 14959), LRO data. Colour globe, not to measure.";

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * Unit direction of planetocentric (lat, lon) in the model's frame: +Y north, the near side (0°, 0°) toward -Z,
 * +90° E toward -X (provenance.json "orientation").
 */
export function latLonToModel(latDeg: number, lonDeg: number): Vec3Like {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  return { x: -Math.cos(lat) * Math.sin(lon), y: Math.sin(lat), z: -Math.cos(lat) * Math.cos(lon) };
}

/** Inverse of latLonToModel for a direction (any length). */
export function modelToLatLon(p: Vec3Like): { lat: number; lon: number } {
  const r = Math.hypot(p.x, p.y, p.z) || 1;
  const lat = (Math.asin(Math.max(-1, Math.min(1, p.y / r))) * 180) / Math.PI;
  const lon = (Math.atan2(-p.x, -p.z) * 180) / Math.PI;
  return { lat, lon };
}

/** Yaw (about +Y) that turns longitude `lonDeg` to face +Z, toward the viewer in the stage's layout. */
export function yawToFace(lonDeg: number): number {
  return Math.PI - (lonDeg * Math.PI) / 180;
}

/** Great-circle angle between two lat/lon points, degrees. */
export function angularDistanceDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const pa = latLonToModel(a.lat, a.lon);
  const pb = latLonToModel(b.lat, b.lon);
  const dot = Math.max(-1, Math.min(1, pa.x * pb.x + pa.y * pb.y + pa.z * pb.z));
  return (Math.acos(dot) * 180) / Math.PI;
}

export class MoonModel {
  /** Centre of the globe; `spin` inside it holds the NASA mesh, turned so the focus longitude faces the viewer. */
  readonly group = new Group();
  readonly spin = new Group();
  private _mesh?: Mesh;
  private modelRadius = 1;

  constructor(readonly radiusM: number) {
    this.group.name = "moon-globe";
    this.group.add(this.spin);
  }

  get mesh(): Mesh | undefined {
    return this._mesh;
  }

  get loaded(): boolean {
    return this._mesh !== undefined;
  }

  async load(url: string = MOON_GLOBE_URL): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    let mesh: Mesh | undefined;
    gltf.scene.traverse((o) => {
      if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh;
    });
    if (!mesh) throw new Error("moon globe: no mesh in model");
    mesh.geometry.computeBoundingSphere();
    this.modelRadius = mesh.geometry.boundingSphere?.radius ?? 1;
    // NASA's material is physical (clearcoat, specular, IOR); a standard material with the same colour map looks the
    // same on a dusty Moon and keeps the Quest inside its 72 fps budget (AGENTS.md §6).
    const map = (mesh.material as Material & { map?: Texture | null }).map ?? null;
    if (map) map.colorSpace = SRGBColorSpace;
    mesh.material = new MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 });
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.setScalar(this.radiusM / this.modelRadius);
    mesh.name = "moon-globe-mesh";
    this.spin.add(mesh);
    this._mesh = mesh;
  }

  /** Turn the globe so (lat, lon) faces the viewer; north stays up. */
  focus(lonDeg: number): void {
    this.spin.rotation.set(0, yawToFace(lonDeg), 0);
  }

  /** A point on (or `liftM` above) the surface, in `spin` coordinates. */
  surfacePoint(latDeg: number, lonDeg: number, liftM = 0): Vec3Like {
    const d = latLonToModel(latDeg, lonDeg);
    const r = this.radiusM + liftM;
    return { x: d.x * r, y: d.y * r, z: d.z * r };
  }
}
