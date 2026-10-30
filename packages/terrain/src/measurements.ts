// Deterministic terrain measurements. Numbers come from code, not models (AGENTS.md rule 4, PRD §6).
// Every function is pure; methods are described in the `method` string stored with each record.
import type { MeasurementRecord, Result, TerrainFeature, TilePoint } from "@nexus/schemas";
import type { DemGrid } from "./dem.js";
import { postElevation, sampleElevation } from "./dem.js";

export interface ProfileSample {
  distanceM: number;
  elevationM: number;
}

/** Elevation profile from `a` to `b`, sampled every half cell. Fails if the line leaves the tile or crosses no-data. */
export function profile(grid: DemGrid, a: TilePoint, b: TilePoint): Result<ProfileSample[]> {
  const lengthM = planarDistance(a, b);
  const steps = Math.max(1, Math.ceil(lengthM / (grid.header.cellSizeM / 2)));
  const out: ProfileSample[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    const e = sampleElevation(grid, p);
    if (e === undefined) return { ok: false, error: `profile leaves valid data at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})` };
    out.push({ distanceM: lengthM * t, elevationM: e });
  }
  return { ok: true, value: out };
}

/**
 * Local slope in degrees at the post nearest `p`, using Horn's 3×3 finite difference.
 * Horn (1981) is the method most GIS tools use, so values are comparable with published slope maps.
 */
export function slopeAt(grid: DemGrid, p: TilePoint): Result<number> {
  const cs = grid.header.cellSizeM;
  const c = Math.round(p.x / cs);
  const r = Math.round(p.z / cs);
  const z = (dc: number, dr: number) => postElevation(grid, c + dc, r + dr);
  const n = [z(-1, -1), z(0, -1), z(1, -1), z(-1, 0), z(1, 0), z(-1, 1), z(0, 1), z(1, 1)];
  if (n.some((v) => v === undefined)) return { ok: false, error: "slope window touches the tile edge or no-data" };
  const [a, b, cc, d, f, g, h, i] = n as number[] as [number, number, number, number, number, number, number, number];
  const dzdx = (cc + 2 * f + i - (a + 2 * d + g)) / (8 * cs);
  const dzdz = (g + 2 * h + i - (a + 2 * b + cc)) / (8 * cs);
  return { ok: true, value: radToDeg(Math.atan(Math.hypot(dzdx, dzdz))) };
}

/** Mean Horn slope over every post within `radiusM` of `center`. */
export function meanSlope(grid: DemGrid, center: TilePoint, radiusM: number): Result<number> {
  const cs = grid.header.cellSizeM;
  let sum = 0;
  let count = 0;
  const span = Math.ceil(radiusM / cs);
  const c0 = Math.round(center.x / cs);
  const r0 = Math.round(center.z / cs);
  for (let r = r0 - span; r <= r0 + span; r++) {
    for (let c = c0 - span; c <= c0 + span; c++) {
      const p = { x: c * cs, z: r * cs };
      if (planarDistance(p, center) > radiusM) continue;
      const s = slopeAt(grid, p);
      if (!s.ok) return s;
      sum += s.value;
      count++;
    }
  }
  if (count === 0) return { ok: false, error: "slope region contains no posts" };
  return { ok: true, value: sum / count };
}

export interface CraterMetrics {
  depthM: number;
  diameterM: number;
  rimElevationM: number;
  floorElevationM: number;
}

/** Number of radial profiles used for crater rim detection. */
export const CRATER_RAYS = 16;

/**
 * Crater depth and diameter from radial DEM profiles.
 * Rim crest = highest point between 0.7 and 1.3 × the labelled rim radius on each ray.
 * Floor = lowest point within 0.5 × radius. Depth = mean rim crest − floor. Diameter = 2 × mean crest distance.
 */
export function craterMetrics(grid: DemGrid, center: TilePoint, rimRadiusM: number): Result<CraterMetrics> {
  let crestSum = 0;
  let crestDistSum = 0;
  let floor = Infinity;
  for (let k = 0; k < CRATER_RAYS; k++) {
    const angle = (2 * Math.PI * k) / CRATER_RAYS;
    const end = { x: center.x + Math.cos(angle) * 1.3 * rimRadiusM, z: center.z + Math.sin(angle) * 1.3 * rimRadiusM };
    const prof = profile(grid, center, end);
    if (!prof.ok) return prof;
    let crest: ProfileSample | undefined;
    for (const s of prof.value) {
      if (s.distanceM <= 0.5 * rimRadiusM) floor = Math.min(floor, s.elevationM);
      if (s.distanceM >= 0.7 * rimRadiusM && (crest === undefined || s.elevationM > crest.elevationM)) crest = s;
    }
    if (crest === undefined) return { ok: false, error: "no rim samples on ray" };
    crestSum += crest.elevationM;
    crestDistSum += crest.distanceM;
  }
  const rimElevationM = crestSum / CRATER_RAYS;
  return {
    ok: true,
    value: {
      depthM: rimElevationM - floor,
      diameterM: (2 * crestDistSum) / CRATER_RAYS,
      rimElevationM,
      floorElevationM: floor,
    },
  };
}

export interface CrossSectionMetrics {
  widthM: number;
  depthM: number;
}

/**
 * Width and depth of a channel from one rim-to-rim cross-section.
 * Floor = lowest sample; each rim = highest sample on its side of the floor.
 * Width = distance between the two rim crests. Depth = mean rim crest − floor.
 */
export function crossSectionMetrics(grid: DemGrid, a: TilePoint, b: TilePoint): Result<CrossSectionMetrics> {
  const prof = profile(grid, a, b);
  if (!prof.ok) return prof;
  const s = prof.value;
  let floorIdx = 0;
  s.forEach((p, i) => {
    if (p.elevationM < (s[floorIdx] as ProfileSample).elevationM) floorIdx = i;
  });
  const left = highest(s, 0, floorIdx);
  const right = highest(s, floorIdx, s.length - 1);
  const floor = s[floorIdx] as ProfileSample;
  if (left === floor || right === floor) return { ok: false, error: "cross-section does not span both rims" };
  return {
    ok: true,
    value: {
      widthM: right.distanceM - left.distanceM,
      depthM: (left.elevationM + right.elevationM) / 2 - floor.elevationM,
    },
  };
}

/** Planimetric polyline length in metres (relief ignored). */
export function polylineLengthM(path: readonly TilePoint[]): number {
  let sum = 0;
  for (let i = 1; i < path.length; i++) sum += planarDistance(path[i - 1] as TilePoint, path[i] as TilePoint);
  return sum;
}

/** Stable measurement id, so precomputed records and live recomputes match. */
export function measurementId(siteId: string, featureId: string, quantity: MeasurementRecord["quantity"]): string {
  return `MEAS-${siteId}-${featureId}-${quantity.toUpperCase()}`;
}

/** Compute every measurement a labelled feature supports. */
export function measureFeature(grid: DemGrid, feature: TerrainFeature, computedAt: string): Result<MeasurementRecord[]> {
  const rec = (quantity: MeasurementRecord["quantity"], value: number, unit: MeasurementRecord["unit"], method: string) => ({
    id: measurementId(feature.siteId, feature.id, quantity),
    siteId: feature.siteId,
    featureId: feature.id,
    quantity,
    value: round(value, unit === "km" ? 2 : 1),
    unit,
    method,
    sourceEvidenceId: grid.header.sourceEvidenceId,
    computedAt,
  });

  switch (feature.kind) {
    case "crater": {
      const m = craterMetrics(grid, feature.center, feature.rimRadiusM);
      if (!m.ok) return m;
      return {
        ok: true,
        value: [
          rec("depth", m.value.depthM, "m", `mean rim crest minus floor minimum on ${CRATER_RAYS} radial DEM profiles`),
          rec("diameter", m.value.diameterM, "m", `twice the mean rim crest distance on ${CRATER_RAYS} radial DEM profiles`),
        ],
      };
    }
    case "rille": {
      const sections: CrossSectionMetrics[] = [];
      for (const [a, b] of feature.crossSections) {
        const m = crossSectionMetrics(grid, a, b);
        if (!m.ok) return m;
        sections.push(m.value);
      }
      const n = sections.length;
      const meanWidth = sections.reduce((acc, s) => acc + s.widthM, 0) / n;
      const meanDepth = sections.reduce((acc, s) => acc + s.depthM, 0) / n;
      return {
        ok: true,
        value: [
          rec("width", meanWidth, "m", `mean rim-crest separation over ${n} DEM cross-section(s)`),
          rec("depth", meanDepth, "m", `mean rim crest minus floor over ${n} DEM cross-section(s)`),
          rec("length", polylineLengthM(feature.path) / 1000, "km", "planimetric length of the labelled centreline"),
        ],
      };
    }
    case "slope": {
      const m = meanSlope(grid, feature.center, feature.radiusM);
      if (!m.ok) return m;
      return {
        ok: true,
        value: [rec("slope", m.value, "deg", `mean Horn 3x3 slope over posts within ${feature.radiusM} m`)],
      };
    }
    case "point": {
      const e = sampleElevation(grid, feature.center);
      if (e === undefined) return { ok: false, error: `feature ${feature.id} is outside valid DEM data` };
      return { ok: true, value: [rec("elevation", e, "m", "bilinear DEM elevation at the labelled point")] };
    }
  }
}

function highest(s: ProfileSample[], from: number, to: number): ProfileSample {
  let best = s[from] as ProfileSample;
  for (let i = from; i <= to; i++) if ((s[i] as ProfileSample).elevationM > best.elevationM) best = s[i] as ProfileSample;
  return best;
}

function planarDistance(a: TilePoint, b: TilePoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
