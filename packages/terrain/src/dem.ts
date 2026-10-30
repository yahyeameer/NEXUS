import { demHeader } from "@nexus/schemas";
import type { DemHeader, Result, TilePoint } from "@nexus/schemas";

/** A DEM tile held at full resolution for measurements (DATASETS.md, "Terrain processing" step 3). */
export interface DemGrid {
  header: DemHeader;
  /** Row-major, north-up, metres. */
  elevations: Float32Array;
}

/** Parse a `dem.json` header plus its `dem.bin` payload (float32 little-endian). */
export function parseDem(header: unknown, bytes: Uint8Array): Result<DemGrid> {
  const parsed = demHeader.safeParse(header);
  if (!parsed.success) return { ok: false, error: `invalid DEM header: ${parsed.error.message}` };
  const h = parsed.data;
  const expected = h.width * h.height * 4;
  if (bytes.byteLength !== expected) {
    return { ok: false, error: `DEM payload is ${bytes.byteLength} bytes, expected ${expected}` };
  }
  // Read explicitly as little-endian so the result does not depend on host byte order.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const elevations = new Float32Array(h.width * h.height);
  for (let i = 0; i < elevations.length; i++) elevations[i] = view.getFloat32(i * 4, true);
  return { ok: true, value: { header: h, elevations } };
}

/** Planar extent of the tile in metres. */
export function extentM(grid: DemGrid): { widthM: number; depthM: number } {
  const { width, height, cellSizeM } = grid.header;
  return { widthM: (width - 1) * cellSizeM, depthM: (height - 1) * cellSizeM };
}

/** Elevation at a grid post, or undefined for no-data posts and out-of-range indices. */
export function postElevation(grid: DemGrid, col: number, row: number): number | undefined {
  const { width, height, noData } = grid.header;
  if (col < 0 || row < 0 || col >= width || row >= height) return undefined;
  const v = grid.elevations[row * width + col];
  if (v === undefined || Number.isNaN(v) || (noData !== undefined && v === noData)) return undefined;
  return v;
}

/** Bilinear elevation at a tile-local point. Undefined outside the tile or next to no-data posts. */
export function sampleElevation(grid: DemGrid, p: TilePoint): number | undefined {
  const { cellSizeM, width, height } = grid.header;
  const fx = p.x / cellSizeM;
  const fz = p.z / cellSizeM;
  if (fx < 0 || fz < 0 || fx > width - 1 || fz > height - 1) return undefined;
  // Clamp so points on the far edge use the last cell instead of reading past it.
  const c0 = Math.min(Math.floor(fx), width - 2);
  const r0 = Math.min(Math.floor(fz), height - 2);
  const tx = fx - c0;
  const tz = fz - r0;
  const a = postElevation(grid, c0, r0);
  const b = postElevation(grid, c0 + 1, r0);
  const c = postElevation(grid, c0, r0 + 1);
  const d = postElevation(grid, c0 + 1, r0 + 1);
  if (a === undefined || b === undefined || c === undefined || d === undefined) return undefined;
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
