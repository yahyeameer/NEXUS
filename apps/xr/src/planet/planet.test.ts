import { TILE_LOD_SIDES } from "@nexus/terrain";
import type { DemGrid } from "@nexus/terrain";
import { MeshBasicMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { tileFrame } from "../scene/tabletop.js";
import { chooseLods, desiredLod, TERRAIN_VERTEX_BUDGET, TerrainTileManager } from "./terrainTileManager.js";

const coarsest = TILE_LOD_SIDES.length - 1;

function grid(size: number, cellSizeM: number, f: (x: number, z: number) => number): DemGrid {
  const elevations = new Float32Array(size * size);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) elevations[r * size + c] = f(c * cellSizeM, r * cellSizeM);
  return { header: { siteId: "TEST", width: size, height: size, cellSizeM, coordinateReferenceSystem: "TEST_LOCAL", sourceEvidenceId: "EV-TEST-001" }, elevations };
}

describe("terrain level of detail", () => {
  it("asks for more vertices the larger a tile looks", () => {
    expect(desiredLod(0.001)).toBe(coarsest);
    expect(desiredLod(0.2)).toBeLessThan(desiredLod(0.05));
    expect(desiredLod(10)).toBe(0);
  });

  it("refines the nearest tiles first and never exceeds the budget", () => {
    const cost = (_t: number, lod: number) => (TILE_LOD_SIDES[lod] ?? 0) ** 2;
    const lods = chooseLods(4, cost, [0, 0, 0, 0], [3, 1, 2, 0], 129 * 129 + 3 * 65 * 65);
    // Tile 3 is nearest and gets the finest level; the rest refine as far as the budget allows.
    expect(lods[3]).toBe(0);
    const total = lods.reduce((n, l, t) => n + cost(t, l), 0);
    expect(total).toBeLessThanOrEqual(129 * 129 + 3 * 65 * 65);
    expect(lods[0]).toBeGreaterThanOrEqual(lods[1] ?? 0);
  });

  it("does not refine past what a tile deserves", () => {
    const lods = chooseLods(2, (_t, lod) => (TILE_LOD_SIDES[lod] ?? 0) ** 2, [coarsest, 2], [0, 1], 1e9);
    expect(lods).toEqual([coarsest, 2]);
  });

  it("keeps a real-sized site inside the 256² vertex budget when viewed up close", () => {
    const g = grid(701, 4, (x, z) => Math.sin(x / 300) * 20 + z * 0.01);
    const frame = tileFrame(2800, 2800, -20);
    const tiles = new TerrainTileManager(g, frame, new MeshBasicMaterial(), "test");
    const identity = (p: Vector3, out: Vector3) => out.copy(p);
    // Eye 30 cm above the middle of the model, zoomed in 3×: everything wants the finest level.
    tiles.settle(new Vector3(0, 1.0, -0.78), identity, 3);
    expect(tiles.vertexCount).toBeLessThanOrEqual(TERRAIN_VERTEX_BUDGET);
    expect(Math.max(...tiles.lodSides())).toBe(129);
    expect(tiles.refining).toBe(false);
  });
});

describe("scientific tools", () => {
  it("writes a measurement as plain lines with signs and units, from the record only", async () => {
    const { measurementLines } = await import("../interaction/measurementTool.js");
    const lines = measurementLines({ horizontalM: 1234.4, elevationAM: -1800, elevationBM: -1856.2, heightDifferenceM: -56.2, gradientDeg: -2.6, minElevationM: -1870.1, maxElevationM: -1799.9, method: "m", sourceEvidenceId: "EV-X-001" });
    expect(lines[0]).toBe("Distance: 1,234 m (horizontal)");
    expect(lines[1]).toBe("Height difference: -56.2 m (second point lower)");
    expect(lines[2]).toBe("Mean gradient: -2.6°");
    expect(lines.join(" ")).not.toMatch(/confirmed|discovered|proven/i);
  });

  it("eases focus moves to a stop", async () => {
    const { easeOut } = await import("../interaction/spatialFocus.js");
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(2)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});
