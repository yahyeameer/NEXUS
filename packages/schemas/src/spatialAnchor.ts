import { z } from "zod";

export const spatialAnchor = z
  .object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(360).optional(),
    altitude: z.number().optional(),
    coordinateReferenceSystem: z.string().min(1).optional(),
    terrainFeatureId: z.string().min(1).optional(),
    /** Tile-local metres. */
    sceneLocal: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
  })
  // DATA_MODELS.md: all coordinates carry a CRS.
  .refine(
    (a) => (a.latitude === undefined && a.longitude === undefined) || a.coordinateReferenceSystem !== undefined,
    { message: "coordinateReferenceSystem is required when latitude/longitude are present", path: ["coordinateReferenceSystem"] },
  );
export type SpatialAnchor = z.infer<typeof spatialAnchor>;
