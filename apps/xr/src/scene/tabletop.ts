// Tile-local metres ↔ scene metres for the tabletop diorama (INTERACTION.md §3, ARCHITECTURE.md "Coordinates").
// Pure so the mapping the deictic resolver and the SIE anchors rely on is unit-tested.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TableLayout {
  /** Scene position of the tile centre at its base elevation. */
  center: Vec3;
  /** Longest tile side, in scene metres. */
  sizeM: number;
}

/** Seated default: the diorama rests on a desk in front of the user, below the panels. */
export const DEFAULT_TABLE: TableLayout = { center: { x: 0, y: 0.74, z: -0.78 }, sizeM: 0.8 };

export interface TileFrame {
  widthM: number;
  depthM: number;
  /** Elevation placed at the table surface (the tile's lowest post). */
  baseElevationM: number;
  /** Scene metres per tile metre. Vertical scale is the same: no exaggeration, so heights read true. */
  scale: number;
  center: Vec3;
}

export function tileFrame(widthM: number, depthM: number, baseElevationM: number, layout: TableLayout = DEFAULT_TABLE): TileFrame {
  return { widthM, depthM, baseElevationM, scale: layout.sizeM / Math.max(widthM, depthM), center: layout.center };
}

/** Tile point (x east, z south, y = elevation) to scene coordinates (y up). */
export function tileToScene(f: TileFrame, p: Vec3): Vec3 {
  return {
    x: f.center.x + (p.x - f.widthM / 2) * f.scale,
    y: f.center.y + (p.y - f.baseElevationM) * f.scale,
    z: f.center.z + (p.z - f.depthM / 2) * f.scale,
  };
}

export function sceneToTile(f: TileFrame, p: Vec3): Vec3 {
  return {
    x: (p.x - f.center.x) / f.scale + f.widthM / 2,
    y: (p.y - f.center.y) / f.scale + f.baseElevationM,
    z: (p.z - f.center.z) / f.scale + f.depthM / 2,
  };
}
