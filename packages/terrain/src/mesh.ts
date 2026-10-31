import type { DemGrid } from "./dem.js";
import { extentM, postElevation, sampleElevation } from "./dem.js";
import { MAX_MESH_VERTICES_PER_SIDE } from "./limits.js";

/** Render-ready grid mesh. Plain typed arrays so the XR client can hand them to Three.js without copying. */
export interface TerrainMesh {
  cols: number;
  rows: number;
  /** xyz per vertex, tile-local metres, y up. */
  positions: Float32Array;
  /** uv per vertex, (0,0) at the north-west corner. */
  uvs: Float32Array;
  indices: Uint32Array;
}

/**
 * Resample the full-resolution DEM to at most `maxSide` vertices per side (AGENTS.md §6 Quest budget).
 * Measurements always use the full-resolution grid, never this mesh.
 */
export function buildMesh(grid: DemGrid, maxSide = MAX_MESH_VERTICES_PER_SIDE, verticalExaggeration = 1): TerrainMesh {
  const cols = Math.min(grid.header.width, maxSide);
  const rows = Math.min(grid.header.height, maxSide);
  const { widthM, depthM } = extentM(grid);
  const fill = lowestValidElevation(grid);

  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const v = r / (rows - 1);
      const x = u * widthM;
      const z = v * depthM;
      // No-data holes are filled with the lowest valid elevation so they read as gaps, not spikes.
      const y = sampleElevation(grid, { x, z }) ?? fill;
      const i = r * cols + c;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y * verticalExaggeration;
      positions[i * 3 + 2] = z;
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
    }
  }

  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      // Counter-clockwise seen from above (+y), so faces point up.
      indices[k++] = a;
      indices[k++] = d;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = e;
    }
  }
  return { cols, rows, positions, uvs, indices };
}

function lowestValidElevation(grid: DemGrid): number {
  let min = Infinity;
  for (let row = 0; row < grid.header.height; row++) {
    for (let col = 0; col < grid.header.width; col++) {
      const v = postElevation(grid, col, row);
      if (v !== undefined && v < min) min = v;
    }
  }
  return Number.isFinite(min) ? min : 0;
}

/** Vertices per side a tile may use at each level of detail, finest first. */
export const TILE_LOD_SIDES = [129, 65, 33, 17, 9] as const;

/** Post range of one tile: inclusive, so neighbouring tiles share their edge posts and line up exactly. */
export interface TileRange {
  col0: number;
  row0: number;
  col1: number;
  row1: number;
}

/** Split the DEM into `tilesPerSide`² tiles along post boundaries. Row-major, north-west first. */
export function tileRanges(grid: DemGrid, tilesPerSide: number): TileRange[] {
  const { width, height } = grid.header;
  const n = Math.max(1, Math.floor(tilesPerSide));
  const out: TileRange[] = [];
  const cut = (i: number, posts: number) => Math.round((i * (posts - 1)) / n);
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) out.push({ col0: cut(tx, width), row0: cut(ty, height), col1: cut(tx + 1, width), row1: cut(ty + 1, height) });
  }
  return out;
}

/**
 * One tile of the DEM at `side` vertices per side (clamped to the posts it covers), with a skirt hanging `skirtM`
 * below every edge so tiles at different levels of detail never show cracks between them. Same coordinates and uv
 * convention as buildMesh, so all tiles share one texture. Measurements never use this mesh.
 */
export function buildTileMesh(grid: DemGrid, range: TileRange, side: number, skirtM: number): TerrainMesh {
  const { cellSizeM } = grid.header;
  const { widthM, depthM } = extentM(grid);
  const cols = Math.max(2, Math.min(side, range.col1 - range.col0 + 1));
  const rows = Math.max(2, Math.min(side, range.row1 - range.row0 + 1));
  const fill = lowestValidElevation(grid);
  const x0 = range.col0 * cellSizeM;
  const z0 = range.row0 * cellSizeM;
  const spanX = (range.col1 - range.col0) * cellSizeM;
  const spanZ = (range.row1 - range.row0) * cellSizeM;

  // Perimeter in order (north edge west→east, east edge, south edge east→west, west edge), for the skirt.
  const ring: number[] = [];
  for (let c = 0; c < cols - 1; c++) ring.push(c);
  for (let r = 0; r < rows - 1; r++) ring.push(r * cols + cols - 1);
  for (let c = cols - 1; c > 0; c--) ring.push((rows - 1) * cols + c);
  for (let r = rows - 1; r > 0; r--) ring.push(r * cols);

  const surface = cols * rows;
  const positions = new Float32Array((surface + ring.length) * 3);
  const uvs = new Float32Array((surface + ring.length) * 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = x0 + (c / (cols - 1)) * spanX;
      const z = z0 + (r / (rows - 1)) * spanZ;
      const i = r * cols + c;
      positions[i * 3] = x;
      positions[i * 3 + 1] = sampleElevation(grid, { x, z }) ?? fill;
      positions[i * 3 + 2] = z;
      uvs[i * 2] = widthM > 0 ? x / widthM : 0;
      uvs[i * 2 + 1] = depthM > 0 ? z / depthM : 0;
    }
  }
  ring.forEach((src, k) => {
    const i = surface + k;
    positions[i * 3] = positions[src * 3] ?? 0;
    positions[i * 3 + 1] = (positions[src * 3 + 1] ?? 0) - skirtM;
    positions[i * 3 + 2] = positions[src * 3 + 2] ?? 0;
    uvs[i * 2] = uvs[src * 2] ?? 0;
    uvs[i * 2 + 1] = uvs[src * 2 + 1] ?? 0;
  });

  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6 + ring.length * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      // Counter-clockwise seen from above (+y), as in buildMesh.
      indices[k++] = a;
      indices[k++] = d;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = e;
    }
  }
  const cx = x0 + spanX / 2;
  const cz = z0 + spanZ / 2;
  const p = (i: number) => ({ x: positions[i * 3] ?? 0, y: positions[i * 3 + 1] ?? 0, z: positions[i * 3 + 2] ?? 0 });
  for (let s = 0; s < ring.length; s++) {
    const top0 = ring[s] ?? 0;
    const top1 = ring[(s + 1) % ring.length] ?? 0;
    const low0 = surface + s;
    const low1 = surface + ((s + 1) % ring.length);
    // Wind each skirt quad so it faces away from the tile centre.
    const a = p(top0);
    const b = p(low0);
    const c = p(top1);
    const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
    const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const outward = nx * ((a.x + c.x) / 2 - cx) + nz * ((a.z + c.z) / 2 - cz) > 0;
    const tri = outward ? [top0, low0, top1, top1, low0, low1] : [top0, top1, low0, top1, low1, low0];
    for (const v of tri) indices[k++] = v;
  }
  return { cols, rows, positions, uvs, indices };
}

/** Surface vertex count of a tile at a level of detail (skirts excluded): what the vertex budget counts. */
export function tileVertexCount(range: TileRange, side: number): number {
  const cols = Math.max(2, Math.min(side, range.col1 - range.col0 + 1));
  const rows = Math.max(2, Math.min(side, range.row1 - range.row0 + 1));
  return cols * rows;
}
