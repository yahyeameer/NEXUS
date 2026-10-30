// Synthetic DEMs with hand-checked geometry, for unit tests only. Not lunar data.
import type { DemGrid } from "./dem.js";

export function syntheticGrid(width: number, height: number, cellSizeM: number, f: (x: number, z: number) => number): DemGrid {
  const elevations = new Float32Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) elevations[r * width + c] = f(c * cellSizeM, r * cellSizeM);
  return {
    header: {
      siteId: "TEST_SITE",
      width,
      height,
      cellSizeM,
      noData: -32768,
      coordinateReferenceSystem: "TEST_LOCAL",
      sourceEvidenceId: "EV-TEST-001",
    },
    elevations,
  };
}

/** Bowl crater: rim crest 20 m at r = 500 m, floor −80 m at the centre → depth 100 m, diameter 1000 m. */
export function bowlCrater(): DemGrid {
  const R = 500;
  return syntheticGrid(201, 201, 10, (x, z) => {
    const r = Math.hypot(x - 1000, z - 1000);
    return r <= R ? 100 * ((r / R) ** 2 - 1) + 20 : 20 * Math.exp(-(r - R) / 100);
  });
}

/** V-shaped trough along z at x = 500: rims 10 m at x = 300 and 700, floor −50 m → width 400 m, depth 60 m. */
export function vTrough(): DemGrid {
  return syntheticGrid(101, 101, 10, (x) => {
    const dx = Math.abs(x - 500);
    return dx <= 200 ? 10 - 60 * (1 - dx / 200) : 10 * Math.exp(-(dx - 200) / 50);
  });
}

/** Plane tilted 10° up toward the east. */
export function tiltedPlane(deg = 10): DemGrid {
  const t = Math.tan((deg * Math.PI) / 180);
  return syntheticGrid(50, 50, 5, (x) => x * t);
}
