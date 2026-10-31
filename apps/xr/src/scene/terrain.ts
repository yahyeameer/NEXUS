// TerrainRenderer: loads one demo site (data/terrain/<SITE_ID>) as a tabletop terrain model. Geometry is tiled with
// per-tile level of detail (planet/terrainTileManager.ts, ≤ 256² vertices in total, AGENTS.md §6) and loads
// progressively: coarse tiles as soon as the DEM arrives, the orthophoto when it lands, finer tiles frame by frame.
// The client never computes a measurement it would show.
import { featureCollection } from "@nexus/schemas";
import type { DemHeader, TerrainFeature } from "@nexus/schemas";
import { parseDem, sampleElevation } from "@nexus/terrain";
import type { DemGrid } from "@nexus/terrain";
import { Color, Group, MeshStandardMaterial, SRGBColorSpace, TextureLoader } from "three";
import type { Object3D } from "three";
import { TerrainTileManager } from "../planet/terrainTileManager.js";
import { ObservationMarker } from "../ui/spatial/observationMarker.js";
import { featureCenter } from "./featurePick.js";
import type { TileFrame, Vec3 } from "./tabletop.js";
import { tileFrame, tileToScene } from "./tabletop.js";

export interface LoadedSite {
  siteId: string;
  group: Group;
  /** What rays pick: the tile group. */
  terrain: Object3D;
  tiles: TerrainTileManager;
  /** Grid size, post spacing, CRS and source evidence, shown with the terrain (dem.json). */
  header: DemHeader;
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
  // The orthophoto is not awaited: the terrain shows in neutral grey first and takes its image when it lands.
  const texture = new TextureLoader().loadAsync(`${base}/texture.png`);
  const [header, bytes, featuresJson] = await Promise.all([
    fetch(`${base}/dem.json`).then((r) => r.json() as Promise<unknown>),
    fetch(`${base}/dem.bin`).then((r) => r.arrayBuffer()),
    fetch(`${base}/features.json`).then((r) => r.json() as Promise<unknown>),
  ]);
  const grid = parseDem(header, new Uint8Array(bytes));
  if (!grid.ok) throw new Error(`${siteId}: ${grid.error}`);
  const features = featureCollection.parse(featuresJson).features;

  // The lowest valid post rests on the table.
  let minY = Infinity;
  for (const v of grid.value.elevations) if (Number.isFinite(v) && v !== grid.value.header.noData && v < minY) minY = v;
  if (!Number.isFinite(minY)) minY = 0;
  const widthM = (grid.value.header.width - 1) * grid.value.header.cellSizeM;
  const depthM = (grid.value.header.height - 1) * grid.value.header.cellSizeM;
  const frame = tileFrame(widthM, depthM, minY);

  const material = new MeshStandardMaterial({ color: 0x8a8f96, roughness: 1, metalness: 0, emissive: 0x1a2438 });
  void texture
    .then((t) => {
      t.colorSpace = SRGBColorSpace;
      // uv (0,0) is the north-west corner, which is the image's first row.
      t.flipY = false;
      material.map = t;
      material.emissiveMap = t;
      material.color = new Color(0xffffff);
      material.needsUpdate = true;
    })
    .catch(() => undefined);
  const tiles = new TerrainTileManager(grid.value, frame, material, `terrain:${siteId}`);
  const terrain = tiles.group;

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
  return { siteId, group, terrain, tiles, header: grid.value.header, frame, grid: grid.value, features, markers, anchors, radii, minElevation: minY };
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
