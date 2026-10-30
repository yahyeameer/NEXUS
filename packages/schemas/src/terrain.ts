import { z } from "zod";

/**
 * Tile-local planar point in metres. Origin is the DEM's north-west corner, x grows east, z grows south.
 * Matches the XR scene where y is up, so `sceneLocal = { x, y: elevation, z }`.
 */
export const tilePoint = z.object({ x: z.number().finite(), z: z.number().finite() });
export type TilePoint = z.infer<typeof tilePoint>;

/** Sidecar header for a DEM tile: `data/terrain/<site>/dem.json` next to `dem.bin` (float32 LE, row-major, north-up). */
export const demHeader = z.object({
  siteId: z.string().min(1),
  width: z.number().int().min(2),
  height: z.number().int().min(2),
  /** Ground distance between adjacent posts, metres. */
  cellSizeM: z.number().positive(),
  /** Value used for missing posts. */
  noData: z.number().optional(),
  /** CRS of the source product, copied from the export (DATASETS.md, "Terrain processing" step 2). */
  coordinateReferenceSystem: z.string().min(1),
  /** The dataset EvidenceItem this tile came from; every measurement cites it. */
  sourceEvidenceId: z.string().min(1),
});
export type DemHeader = z.infer<typeof demHeader>;

const featureBase = {
  /** e.g. "ELBOW_CRATER" */
  id: z.string().regex(/^[A-Z0-9_]+$/),
  siteId: z.string().min(1),
  label: z.string().min(1),
  /** Short pronounceable label used by the deictic resolver and voices. */
  spokenLabel: z.string().min(1),
  /** Extra words a scientist may use for this feature ("the bend", "the crater"). */
  aliases: z.array(z.string()).default([]),
};

/** Labelled terrain features (`data/terrain/<site>/features.json`). Geometry is hand-labelled, values are computed. */
export const terrainFeature = z.discriminatedUnion("kind", [
  z.object({ ...featureBase, kind: z.literal("crater"), center: tilePoint, rimRadiusM: z.number().positive() }),
  z.object({
    ...featureBase,
    kind: z.literal("rille"),
    /** Centreline, for length. */
    path: z.array(tilePoint).min(2),
    /** Cross-section lines, each spanning both rims, for width and depth. */
    crossSections: z.array(z.tuple([tilePoint, tilePoint])).min(1),
  }),
  z.object({ ...featureBase, kind: z.literal("slope"), center: tilePoint, radiusM: z.number().positive() }),
  z.object({ ...featureBase, kind: z.literal("point"), center: tilePoint }),
]);
export type TerrainFeature = z.infer<typeof terrainFeature>;

export const featureCollection = z.object({
  siteId: z.string().min(1),
  features: z.array(terrainFeature),
});
export type FeatureCollection = z.infer<typeof featureCollection>;
