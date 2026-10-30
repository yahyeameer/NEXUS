import { z } from "zod";
import { claimType, uncertainty } from "./common.js";

export const claim = z.object({
  text: z.string().min(1),
  claimType,
  /** Must exist in the evidence store (SIE V2). */
  evidenceIds: z.array(z.string().min(1)),
  contradictingEvidenceIds: z.array(z.string().min(1)).optional(),
  /** Required for any number in text (SIE V3). */
  measurementIds: z.array(z.string().min(1)).optional(),
});
export type Claim = z.infer<typeof claim>;

/** Every Docker Agent team member returns this (AGENTS.md §8). */
export const agentOutput = z
  .object({
    /** Catalog id, e.g. "26_lola_elevation_researcher". */
    agentId: z.string().min(1),
    observationId: z.string().min(1),
    claims: z.array(claim),
    openQuestions: z.array(z.string()).optional(),
    uncertainty: uncertainty.optional(),
    /** Not shown to users. */
    notes: z.string().optional(),
  })
  // Unknown keys (e.g. an agent trying to set `status`) fail parsing instead of being dropped (SIE V9).
  .strict();
export type AgentOutput = z.infer<typeof agentOutput>;
