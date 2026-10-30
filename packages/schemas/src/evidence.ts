import { z } from "zod";
import { isoTimestamp } from "./common.js";

export const evidenceItem = z.object({
  /** EV-<SITE>-NNN */
  id: z.string().regex(/^EV-[A-Z0-9_]+-\d{3,}$/),
  siteId: z.string().min(1),
  type: z.enum(["image", "measurement", "text", "dataset"]),
  title: z.string().min(1),
  /** Short pronounceable label. */
  spokenLabel: z.string().min(1),
  dataset: z.string().optional(),
  /** Exact product identifier. Placeholders such as "<exact product id>" are rejected (DATASETS.md). */
  productId: z.string().regex(/^[^<>]+$/).optional(),
  sourceUrl: z.string().url().regex(/^[^<>]+$/),
  acquiredAt: z.string().optional(),
  /** Short excerpt for text sources (< 60 words). */
  excerpt: z
    .string()
    .refine((s) => s.trim().split(/\s+/).length < 60, { message: "excerpt must be under 60 words" })
    .optional(),
  region: z
    .object({
      featureId: z.string().optional(),
      bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
      crs: z.string().optional(),
    })
    .optional(),
  credit: z.string().min(1),
  license: z.string().min(1),
});
export type EvidenceItem = z.infer<typeof evidenceItem>;

export const evidencePack = z.object({
  siteId: z.string().min(1),
  version: z.number().int().positive(),
  items: z.array(evidenceItem),
});
export type EvidencePack = z.infer<typeof evidencePack>;

/** Computed by packages/terrain, never by models (AGENTS.md rule 4). */
export const measurementRecord = z.object({
  /** MEAS-xxxx, also usable as evidence ID. */
  id: z.string().regex(/^MEAS-/),
  siteId: z.string().min(1),
  featureId: z.string().min(1),
  quantity: z.enum(["depth", "width", "diameter", "slope", "elevation", "length"]),
  value: z.number().finite(),
  unit: z.enum(["m", "km", "deg"]),
  method: z.string().min(1),
  /** DEM evidence item. */
  sourceEvidenceId: z.string().min(1),
  computedAt: isoTimestamp,
});
export type MeasurementRecord = z.infer<typeof measurementRecord>;
