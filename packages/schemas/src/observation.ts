import { z } from "zod";
import { isoTimestamp } from "./common.js";
import { spatialAnchor } from "./spatialAnchor.js";

export const observation = z.object({
  id: z.string().regex(/^OBS-/),
  siteId: z.string().min(1),
  source: z.enum(["hand_select", "field_note", "video_mark"]),
  featureId: z.string().min(1).optional(),
  spatialAnchor,
  frameRef: z
    .object({ videoId: z.string(), timestampMs: z.number().int().nonnegative(), imageUrl: z.string().url() })
    .optional(),
  // AGENTS.md rule 7: simulated data must say so.
  telemetry: z.object({ simulated: z.literal(true), label: z.string().min(1) }).optional(),
  description: z.string().optional(),
  createdBy: z.string().min(1),
  createdAt: isoTimestamp,
});
export type Observation = z.infer<typeof observation>;

/** Minimum deictic confidence before a FieldNote may be anchored (SIE VR1). */
export const DEICTIC_CONFIDENCE_THRESHOLD = 0.75;

export const fieldNote = z.object({
  id: z.string().min(1),
  observationId: z.string().min(1),
  utteranceId: z.string().min(1),
  /** Verbatim. */
  transcript: z.string(),
  /** BCP-47. */
  language: z.string().min(2),
  /** Only words the user said. */
  descriptors: z.array(z.string()),
  reference: z.object({
    method: z.enum(["ray", "ray+gaze", "ray+gaze+qualifier", "manual"]),
    confidence: z.number().min(0).max(1),
    clarificationAsked: z.boolean(),
    targetFeatureId: z.string().optional(),
  }),
  spatialAnchor,
  createdAt: isoTimestamp,
});
export type FieldNote = z.infer<typeof fieldNote>;
