// TerrainTileManager: the site's DEM as a grid of tiles, each drawn at its own level of detail. Tiles near the
// viewer, or magnified by zoom, get more vertices; the total never exceeds the Quest mesh budget of 256² surface
// vertices (AGENTS.md §6). Refinement is time-sliced, one tile per frame, so loading and zooming never stall a
// frame, and skirts (packages/terrain buildTileMesh) hide the cracks between tiles at different detail.
// Only the drawing changes with level of detail: every measurement reads the full-resolution grid.
import { buildTileMesh, MAX_MESH_VERTICES_PER_SIDE, sampleElevation, TILE_LOD_SIDES, tileRanges, tileVertexCount } from "@nexus/terrain";
import type { DemGrid, TileRange } from "@nexus/terrain";
import { BufferAttribute, BufferGeometry, Group, Mesh, Vector3 } from "three";
import type { Material } from "three";
import type { TileFrame } from "../scene/tabletop.js";
import { tileToScene } from "../scene/tabletop.js";

export const TERRAIN_VERTEX_BUDGET = MAX_MESH_VERTICES_PER_SIDE * MAX_MESH_VERTICES_PER_SIDE;
export const TILES_PER_SIDE = 4;
/** Vertices per radian of a tile's angular size: about one vertex every 0.2° of view at the finest level. */
export const VERTICES_PER_RADIAN = 290;
const RESELECT_MS = 250;

/** The finest LOD index (into TILE_LOD_SIDES) a tile spanning `angularSize` radians deserves on its own. */
export function desiredLod(angularSize: number): number {
  const want = angularSize * VERTICES_PER_RADIAN;
  for (let i = TILE_LOD_SIDES.length - 1; i >= 0; i--) {
    if ((TILE_LOD_SIDES[i] ?? 0) >= want) return i;
  }
  return 0;
}

/** Level every tile reaches (when it wants it) before any tile goes finer: no tile is left as a crude block. */
export const FLOOR_LOD = 2;

/**
 * Pick each tile's level of detail within `budget` vertices. Two passes, both nearest first: every tile rises to
 * FLOOR_LOD (or what it wants, if less), then the nearest tiles refine all the way to what they deserve while the
 * budget lasts. Pure. `cost(tile, lod)` is the tile's vertex count at that level; `wanted[tile]` its desired level;
 * `priority[tile]` smaller means nearer.
 */
export function chooseLods(tileCount: number, cost: (tile: number, lod: number) => number, wanted: number[], priority: number[], budget: number): number[] {
  const coarsest = TILE_LOD_SIDES.length - 1;
  const lods = new Array<number>(tileCount).fill(coarsest);
  let total = 0;
  for (let t = 0; t < tileCount; t++) total += cost(t, coarsest);
  const order = [...Array(tileCount).keys()].sort((a, b) => (priority[a] ?? 0) - (priority[b] ?? 0));
  const raise = (t: number, target: number) => {
    while ((lods[t] ?? coarsest) > target) {
      const cur = lods[t] ?? coarsest;
      const delta = cost(t, cur - 1) - cost(t, cur);
      if (total + delta > budget) return;
      lods[t] = cur - 1;
      total += delta;
    }
  };
  for (const t of order) raise(t, Math.max(wanted[t] ?? coarsest, FLOOR_LOD));
  for (const t of order) raise(t, wanted[t] ?? coarsest);
  return lods;
}

interface Tile {
  range: TileRange;
  mesh: Mesh;
  lod: number;
  want: number;
  /** Tile centre in layout coordinates, for distance checks. */
  center: Vector3;
  sizeM: number;
  cache: Map<number, BufferGeometry>;
}

const tmpWorld = new Vector3();

export class TerrainTileManager {
  readonly group = new Group();
  private readonly tiles: Tile[] = [];
  private checkedAt = 0;
  private readonly skirtM: number;

  constructor(
    private readonly grid: DemGrid,
    private readonly frame: TileFrame,
    material: Material,
    name: string,
  ) {
    this.group.name = name;
    // Skirts reach a little below the lowest post, in tile metres; at table scale that is a few millimetres.
    this.skirtM = Math.max(20, 0.004 / frame.scale);
    const coarsest = TILE_LOD_SIDES.length - 1;
    for (const range of tileRanges(grid, TILES_PER_SIDE)) {
      const cell = grid.header.cellSizeM;
      const cx = ((range.col0 + range.col1) / 2) * cell;
      const cz = ((range.row0 + range.row1) / 2) * cell;
      const elevation = sampleElevation(grid, { x: cx, z: cz }) ?? frame.baseElevationM;
      const c = tileToScene(frame, { x: cx, y: elevation, z: cz });
      const tile: Tile = {
        range,
        mesh: new Mesh(undefined, material),
        lod: coarsest,
        want: coarsest,
        center: new Vector3(c.x, c.y, c.z),
        sizeM: Math.max(range.col1 - range.col0, range.row1 - range.row0) * cell * frame.scale,
        cache: new Map(),
      };
      tile.mesh.geometry = this.geometry(tile, coarsest);
      tile.mesh.name = `${name}:tile`;
      this.tiles.push(tile);
      this.group.add(tile.mesh);
    }
  }

  /** Surface vertices drawn right now (the number the budget limits). */
  get vertexCount(): number {
    return this.tiles.reduce((n, t) => n + tileVertexCount(t.range, TILE_LOD_SIDES[t.lod] ?? 9), 0);
  }

  /** True while some tile is still on its way to the detail it was given. */
  get refining(): boolean {
    return this.tiles.some((t) => t.lod !== t.want);
  }

  /** Detail per tile (vertices per side), row-major: for tests and the debug panel. */
  lodSides(): number[] {
    return this.tiles.map((t) => TILE_LOD_SIDES[t.lod] ?? 0);
  }

  /**
   * Per frame. `viewer` is the eye in world space, `toWorld` maps layout points to world (the Diorama), `scale` its
   * zoom. Reselects every 250 ms and moves at most one tile one step toward its target per frame.
   */
  update(now: number, viewer: Vector3, toWorld: (layout: Vector3, out: Vector3) => Vector3, scale: number): void {
    if (now - this.checkedAt >= RESELECT_MS) {
      this.checkedAt = now;
      const distances = this.tiles.map((t) => Math.max(0.05, toWorld(t.center, tmpWorld).distanceTo(viewer)));
      const wanted = this.tiles.map((t, i) => desiredLod((t.sizeM * scale) / (distances[i] ?? 1)));
      const lods = chooseLods(this.tiles.length, (i, lod) => tileVertexCount(this.tiles[i]?.range ?? { col0: 0, row0: 0, col1: 1, row1: 1 }, TILE_LOD_SIDES[lod] ?? 9), wanted, distances, TERRAIN_VERTEX_BUDGET);
      this.tiles.forEach((t, i) => (t.want = lods[i] ?? t.want));
    }
    // Coarsen first anywhere (frees budget), then refine the nearest tile that wants it.
    const next = this.tiles.find((t) => t.want > t.lod) ?? this.tiles.find((t) => t.want < t.lod);
    if (!next) return;
    next.lod = next.want;
    next.mesh.geometry = this.geometry(next, next.lod);
  }

  /** Builds every tile at its target detail now (tests, and devices that would rather wait than refine). */
  settle(viewer: Vector3, toWorld: (layout: Vector3, out: Vector3) => Vector3, scale: number): void {
    this.checkedAt = -Infinity;
    this.update(0, viewer, toWorld, scale);
    while (this.refining) this.update(0, viewer, toWorld, scale);
  }

  dispose(): void {
    for (const t of this.tiles) for (const g of t.cache.values()) g.dispose();
  }

  private geometry(tile: Tile, lod: number): BufferGeometry {
    const cached = tile.cache.get(lod);
    if (cached) return cached;
    const m = buildTileMesh(this.grid, tile.range, TILE_LOD_SIDES[lod] ?? 9, this.skirtM);
    const positions = new Float32Array(m.positions.length);
    const normals = new Float32Array(m.positions.length);
    const cell = this.grid.header.cellSizeM;
    for (let i = 0; i < m.positions.length; i += 3) {
      const x = m.positions[i] ?? 0;
      const z = m.positions[i + 2] ?? 0;
      const p = tileToScene(this.frame, { x, y: m.positions[i + 1] ?? 0, z });
      positions[i] = p.x;
      positions[i + 1] = p.y;
      positions[i + 2] = p.z;
      // Normals from the full DEM, not from this tile's triangles, so lighting matches across tile seams and
      // levels of detail (no faceting when a neighbour is coarser).
      const h = (dx: number, dz: number) => sampleElevation(this.grid, { x: x + dx, z: z + dz });
      const hx = (h(cell, 0) ?? h(0, 0) ?? 0) - (h(-cell, 0) ?? h(0, 0) ?? 0);
      const hz = (h(0, cell) ?? h(0, 0) ?? 0) - (h(0, -cell) ?? h(0, 0) ?? 0);
      const nx = -hx;
      const ny = 2 * cell;
      const nz = -hz;
      const len = Math.hypot(nx, ny, nz) || 1;
      normals[i] = nx / len;
      normals[i + 1] = ny / len;
      normals[i + 2] = nz / len;
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(positions, 3));
    g.setAttribute("normal", new BufferAttribute(normals, 3));
    g.setAttribute("uv", new BufferAttribute(m.uvs, 2));
    g.setIndex(new BufferAttribute(m.indices, 1));
    g.computeBoundingSphere();
    // Keep the coarsest (instant fallback) and the two most recent levels; drop the rest.
    tile.cache.set(lod, g);
    const keep = new Set([TILE_LOD_SIDES.length - 1, lod, tile.lod]);
    for (const [k, old] of tile.cache) {
      if (keep.has(k) || old === tile.mesh.geometry) continue;
      old.dispose();
      tile.cache.delete(k);
    }
    return g;
  }
}
