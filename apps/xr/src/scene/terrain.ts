// Loads one demo site (data/terrain/<SITE_ID>) into a tabletop diorama. Geometry comes from packages/terrain's
// buildMesh (≤ 256² vertices, AGENTS.md §6); the client never computes a measurement it would show.
import { featureCollection } from "@nexus/schemas";
import type { TerrainFeature } from "@nexus/schemas";
import { buildMesh, parseDem, sampleElevation } from "@nexus/terrain";
import type { DemGrid } from "@nexus/terrain";
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, SRGBColorSpace, TextureLoader } from "three";
import { ObservationMarker } from "../ui/spatial/observationMarker.js";
import { featureCenter } from "./featurePick.js";
import type { TileFrame, Vec3 } from "./tabletop.js";
import { tileFrame, tileToScene } from "./tabletop.js";

export interface LoadedSite {
  siteId: string;
  group: Group;
  terrain: Mesh;
  frame: TileFrame;
  grid: DemGrid;
  features: TerrainFeature[];
  markers: Map<string, ObservationMarker>;
  /** Scene position of each feature's anchor point. */
  anchors: Map<string, Vec3>;
  /** Footprint radius of each feature in scene metres (marker and scanning beam size). */
  radii: Map<string, number>;
  /** Lowest elevation in the tile, where the diorama meets the table. */
  minElevation: number;
}

const TERRAIN_BASE = `${import.meta.env.BASE_URL}terrain`;

export async function loadSite(siteId: string): Promise<LoadedSite> {
  const base = `${TERRAIN_BASE}/${siteId}`;
  const [header, bytes, featuresJson, texture] = await Promise.all([
    fetch(`${base}/dem.json`).then((r) => r.json() as Promise<unknown>),
    fetch(`${base}/dem.bin`).then((r) => r.arrayBuffer()),
    fetch(`${base}/features.json`).then((r) => r.json() as Promise<unknown>),
    new TextureLoader().loadAsync(`${base}/texture.png`),
  ]);
  const grid = parseDem(header, new Uint8Array(bytes));
  if (!grid.ok) throw new Error(`${siteId}: ${grid.error}`);
  const features = featureCollection.parse(featuresJson).features;

  const mesh = buildMesh(grid.value);
  let minY = Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) minY = Math.min(minY, mesh.positions[i] ?? Infinity);
  const widthM = (grid.value.header.width - 1) * grid.value.header.cellSizeM;
  const depthM = (grid.value.header.height - 1) * grid.value.header.cellSizeM;
  const frame = tileFrame(widthM, depthM, minY);

  // Bake the tile → scene transform into the vertices so raycasts return scene points directly.
  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const p = tileToScene(frame, { x: mesh.positions[i] ?? 0, y: mesh.positions[i + 1] ?? 0, z: mesh.positions[i + 2] ?? 0 });
    positions[i] = p.x;
    positions[i + 1] = p.y;
    positions[i + 2] = p.z;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  geometry.computeVertexNormals();
  texture.colorSpace = SRGBColorSpace;
  // uv (0,0) is the north-west corner, which is the image's first row.
  texture.flipY = false;
  const terrain = new Mesh(geometry, new MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0, emissive: 0x1a2438, emissiveMap: texture }));
  terrain.name = `terrain:${siteId}`;

  const group = new Group();
  group.name = `site:${siteId}`;
  group.add(terrain);
  const markers = new Map<string, ObservationMarker>();
  const anchors = new Map<string, Vec3>();
  const radii = new Map<string, number>();
  for (const f of features) {
    const c = featureCenter(f);
    const elevation = sampleElevation(grid.value, c) ?? minY;
    const anchor = tileToScene(frame, { x: c.x, y: elevation, z: c.z });
    anchors.set(f.id, anchor);
    const radius = Math.max(0.025, footprintM(f) * frame.scale);
    radii.set(f.id, radius);
    const marker = new ObservationMarker(f.id, anchor, radius);
    markers.set(f.id, marker);
    group.add(marker.group);
  }
  return { siteId, group, terrain, frame, grid: grid.value, features, markers, anchors, radii, minElevation: minY };
}

function footprintM(f: TerrainFeature): number {
  switch (f.kind) {
    case "crater":
      return f.rimRadiusM;
    case "slope":
      return f.radiusM;
    case "point":
      return 40;
    case "rille":
      return 160;
  }
}
