import { describe, expect, it } from "vitest";
import { measurementRecord } from "@nexus/schemas";
import type { TerrainFeature } from "@nexus/schemas";
import {
  buildMesh,
  buildTileMesh,
  tileRanges,
  tileVertexCount,
  craterMetrics,
  lineMeasurement,
  crossSectionMetrics,
  measureFeature,
  parseDem,
  polylineLengthM,
  sampleElevation,
  slopeAt,
} from "./index.js";
import { bowlCrater, syntheticGrid, tiltedPlane, vTrough } from "./fixtures.js";

const NOW = "2026-10-30T12:00:00Z";
const header = {
  siteId: "TEST_SITE",
  width: 2,
  height: 2,
  cellSizeM: 10,
  coordinateReferenceSystem: "TEST_LOCAL",
  sourceEvidenceId: "EV-TEST-001",
};

describe("parseDem", () => {
  it("reads float32 little-endian posts", () => {
    const bytes = new Uint8Array(16);
    const view = new DataView(bytes.buffer);
    [1, 2, 3, 4].forEach((v, i) => view.setFloat32(i * 4, v, true));
    const dem = parseDem(header, bytes);
    expect(dem.ok && Array.from(dem.value.elevations)).toEqual([1, 2, 3, 4]);
  });

  it("rejects a payload of the wrong size", () => {
    expect(parseDem(header, new Uint8Array(12)).ok).toBe(false);
  });

  it("rejects a header without a source evidence id", () => {
    expect(parseDem({ ...header, sourceEvidenceId: "" }, new Uint8Array(16)).ok).toBe(false);
  });
});

describe("sampleElevation", () => {
  it("interpolates bilinearly and returns undefined at no-data", () => {
    const g = syntheticGrid(3, 3, 10, (x, z) => x + z);
    expect(sampleElevation(g, { x: 5, z: 5 })).toBeCloseTo(10);
    expect(sampleElevation(g, { x: 20, z: 20 })).toBeCloseTo(40);
    expect(sampleElevation(g, { x: 25, z: 0 })).toBeUndefined();
    g.elevations[0] = -32768;
    expect(sampleElevation(g, { x: 5, z: 5 })).toBeUndefined();
  });
});

describe("slopeAt", () => {
  it("measures a 10° plane as 10°", () => {
    const s = slopeAt(tiltedPlane(10), { x: 100, z: 100 });
    expect(s.ok && s.value).toBeCloseTo(10, 3);
  });

  it("fails at the tile edge instead of guessing", () => {
    expect(slopeAt(tiltedPlane(10), { x: 0, z: 0 }).ok).toBe(false);
  });
});

describe("craterMetrics", () => {
  it("recovers the hand-checked bowl: depth 100 m, diameter 1000 m", () => {
    const m = craterMetrics(bowlCrater(), { x: 1000, z: 1000 }, 500);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.value.depthM).toBeGreaterThan(98);
    expect(m.value.depthM).toBeLessThan(101);
    expect(m.value.diameterM).toBeGreaterThan(990);
    expect(m.value.diameterM).toBeLessThan(1010);
  });
});

describe("crossSectionMetrics", () => {
  it("recovers the hand-checked trough: width 400 m, depth 60 m", () => {
    const m = crossSectionMetrics(vTrough(), { x: 100, z: 500 }, { x: 900, z: 500 });
    expect(m.ok && m.value).toEqual({ widthM: 400, depthM: 60 });
  });

  it("fails when the line does not span both rims", () => {
    expect(crossSectionMetrics(vTrough(), { x: 500, z: 500 }, { x: 900, z: 500 }).ok).toBe(false);
  });
});

describe("polylineLengthM", () => {
  it("sums segment lengths", () => {
    expect(polylineLengthM([{ x: 0, z: 0 }, { x: 300, z: 400 }, { x: 300, z: 1400 }])).toBe(1500);
  });
});

describe("measureFeature", () => {
  it("emits valid MeasurementRecords citing the DEM evidence item", () => {
    const rille: TerrainFeature = {
      id: "TEST_RILLE",
      siteId: "TEST_SITE",
      kind: "rille",
      label: "Test trough",
      spokenLabel: "the trough",
      aliases: [],
      path: [{ x: 500, z: 100 }, { x: 500, z: 900 }],
      crossSections: [[{ x: 100, z: 300 }, { x: 900, z: 300 }], [{ x: 100, z: 700 }, { x: 900, z: 700 }]],
    };
    const out = measureFeature(vTrough(), rille, NOW);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    for (const r of out.value) {
      expect(measurementRecord.safeParse(r).success).toBe(true);
      expect(r.sourceEvidenceId).toBe("EV-TEST-001");
    }
    expect(out.value.map((r) => [r.id, r.value, r.unit])).toEqual([
      ["MEAS-TEST_SITE-TEST_RILLE-WIDTH", 400, "m"],
      ["MEAS-TEST_SITE-TEST_RILLE-DEPTH", 60, "m"],
      ["MEAS-TEST_SITE-TEST_RILLE-LENGTH", 0.8, "km"],
    ]);
  });

  it("is deterministic", () => {
    const crater: TerrainFeature = {
      id: "TEST_CRATER",
      siteId: "TEST_SITE",
      kind: "crater",
      label: "Test crater",
      spokenLabel: "the crater",
      aliases: [],
      center: { x: 1000, z: 1000 },
      rimRadiusM: 500,
    };
    expect(measureFeature(bowlCrater(), crater, NOW)).toEqual(measureFeature(bowlCrater(), crater, NOW));
  });
});

describe("buildMesh", () => {
  it("caps vertices at 256 per side and faces up", () => {
    const g = syntheticGrid(300, 300, 1, () => 0);
    const m = buildMesh(g);
    expect([m.cols, m.rows]).toEqual([256, 256]);
    expect(m.positions.length).toBe(256 * 256 * 3);
    expect(m.indices.length).toBe(255 * 255 * 6);
    // First triangle normal must point +y.
    const at = (k: number) => {
      const i = m.indices[k] ?? 0;
      return [m.positions[i * 3] ?? 0, m.positions[i * 3 + 1] ?? 0, m.positions[i * 3 + 2] ?? 0] as const;
    };
    const [a, b, c] = [at(0), at(1), at(2)];
    const normalY = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    expect(normalY).toBeGreaterThan(0);
  });

  it("keeps the full extent when downsampling", () => {
    const m = buildMesh(syntheticGrid(300, 300, 2, () => 0));
    expect(m.positions[(m.cols - 1) * 3]).toBeCloseTo(598);
  });
});

describe("tiled terrain", () => {
  const g = syntheticGrid(101, 101, 2, (x, z) => x * 0.1 + z * 0.05);

  it("splits posts into tiles that share edges and cover the whole DEM", () => {
    const tiles = tileRanges(g, 4);
    expect(tiles).toHaveLength(16);
    expect(tiles[0]).toEqual({ col0: 0, row0: 0, col1: 25, row1: 25 });
    expect(tiles[1]?.col0).toBe(tiles[0]?.col1);
    expect(tiles[15]).toEqual({ col0: 75, row0: 75, col1: 100, row1: 100 });
  });

  it("matches the full mesh on shared edges whatever the level of detail", () => {
    const [a, b] = tileRanges(g, 4);
    if (!a || !b) throw new Error("tiles");
    const fine = buildTileMesh(g, a, 26, 5);
    const coarse = buildTileMesh(g, b, 9, 5);
    // East edge of tile a at its north-east corner equals the west edge of tile b at its north-west corner.
    const ne = (fine.cols - 1) * 3;
    expect(fine.positions[ne]).toBeCloseTo(coarse.positions[0] ?? NaN);
    expect(fine.positions[ne + 1]).toBeCloseTo(coarse.positions[1] ?? NaN);
    // Same global uv convention as buildMesh: the texture is shared by every tile.
    expect(coarse.uvs[0]).toBeCloseTo(25 / 100);
  });

  it("hangs an outward-facing skirt below every edge", () => {
    const t = tileRanges(g, 2)[0];
    if (!t) throw new Error("tile");
    const m = buildTileMesh(g, t, 9, 5);
    const surface = m.cols * m.rows;
    const ringLength = 2 * (m.cols - 1) + 2 * (m.rows - 1);
    expect(m.positions.length / 3).toBe(surface + ringLength);
    // Skirt vertices sit 5 m under the edge vertex they copy.
    expect(m.positions[surface * 3 + 1]).toBeCloseTo((m.positions[1] ?? 0) - 5);
    const cx = ((t.col0 + t.col1) / 2) * 2;
    const cz = ((t.row0 + t.row1) / 2) * 2;
    const firstSkirt = (m.cols - 1) * (m.rows - 1) * 6;
    for (let k = firstSkirt; k < m.indices.length; k += 3) {
      const v = [0, 1, 2].map((j) => {
        const i = m.indices[k + j] ?? 0;
        return { x: m.positions[i * 3] ?? 0, y: m.positions[i * 3 + 1] ?? 0, z: m.positions[i * 3 + 2] ?? 0 };
      });
      const [a, b, c] = v as [{ x: number; y: number; z: number }, { x: number; y: number; z: number }, { x: number; y: number; z: number }];
      const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
      const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const mx = (a.x + b.x + c.x) / 3 - cx;
      const mz = (a.z + b.z + c.z) / 3 - cz;
      expect(nx * mx + nz * mz).toBeGreaterThan(0);
    }
  });

  it("counts surface vertices for the budget, clamped to the posts a tile has", () => {
    const t = tileRanges(g, 4)[0];
    if (!t) throw new Error("tile");
    expect(tileVertexCount(t, 9)).toBe(81);
    expect(tileVertexCount(t, 129)).toBe(26 * 26);
  });
});

describe("lineMeasurement", () => {
  it("measures distance, height difference and gradient on a tilted plane", () => {
    // Rises 1 m per 10 m eastward: a 5.71° slope.
    const g = syntheticGrid(51, 51, 2, (x) => x * 0.1);
    const m = lineMeasurement(g, { x: 10, z: 20 }, { x: 90, z: 20 });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.value.horizontalM).toBeCloseTo(80);
    expect(m.value.heightDifferenceM).toBeCloseTo(8);
    expect(m.value.gradientDeg).toBeCloseTo(5.7, 1);
    expect([m.value.minElevationM, m.value.maxElevationM]).toEqual([1, 9]);
    expect(m.value.sourceEvidenceId).toBe(g.header.sourceEvidenceId);
  });

  it("refuses points closer than a cell or outside the tile instead of guessing", () => {
    const g = syntheticGrid(11, 11, 10, () => 0);
    expect(lineMeasurement(g, { x: 10, z: 10 }, { x: 12, z: 10 }).ok).toBe(false);
    expect(lineMeasurement(g, { x: 10, z: 10 }, { x: 500, z: 10 }).ok).toBe(false);
  });
});
