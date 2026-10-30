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
