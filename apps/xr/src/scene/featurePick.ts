// Which labelled feature a ray hit belongs to. Hands-only selection (INTERACTION.md "Ray + pinch feature").
import type { TerrainFeature, TilePoint } from "@nexus/schemas";

/** Distance in tile metres from a point to a feature's footprint; 0 inside it. */
export function distanceToFeature(f: TerrainFeature, p: TilePoint): number {
  switch (f.kind) {
    case "crater":
      return Math.max(0, Math.hypot(p.x - f.center.x, p.z - f.center.z) - f.rimRadiusM);
    case "slope":
      return Math.max(0, Math.hypot(p.x - f.center.x, p.z - f.center.z) - f.radiusM);
    case "point":
      return Math.hypot(p.x - f.center.x, p.z - f.center.z);
    case "rille": {
      let best = Infinity;
      for (let i = 1; i < f.path.length; i++) {
        const a = f.path[i - 1];
        const b = f.path[i];
        if (a && b) best = Math.min(best, segmentDistance(p, a, b));
      }
      return best;
    }
  }
}

/**
 * The feature nearest to `p`, if within `toleranceM`. Ties go to the first feature in features.json, so the
 * result is deterministic; the scientist confirms with Investigate before anything runs.
 */
export function pickFeature(features: readonly TerrainFeature[], p: TilePoint, toleranceM: number): TerrainFeature | undefined {
  let best: { f: TerrainFeature; d: number } | undefined;
  for (const f of features) {
    const d = distanceToFeature(f, p);
    if (d <= toleranceM && (!best || d < best.d)) best = { f, d };
  }
  return best?.f;
}

/** A representative point to anchor markers and cards: crater/slope/point centre, or the rille's middle vertex. */
export function featureCenter(f: TerrainFeature): TilePoint {
  if (f.kind !== "rille") return f.center;
  return f.path[Math.floor(f.path.length / 2)] ?? f.path[0] ?? { x: 0, z: 0 };
}

function segmentDistance(p: TilePoint, a: TilePoint, b: TilePoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}
