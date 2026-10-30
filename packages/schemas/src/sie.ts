import { z } from "zod";
import { claimType, isoTimestamp, uncertainty } from "./common.js";
import { findingDecisionOutcome, voiceDecision } from "./finding.js";

/** `findingDraft` from the Research Synthesis Specialist (#22). Decision and status are set by the SIE and the scientist. */
export const findingDraft = z.object({
  title: z.string().min(1),
  summary: z.string(),
  claimType,
  possibleInterpretations: z
    .array(
      z.object({
        explanation: z.string().min(1),
        supportingEvidenceIds: z.array(z.string()),
        contradictingEvidenceIds: z.array(z.string()),
      }),
    )
    .default([]),
  uncertainty,
});
export type FindingDraft = z.infer<typeof findingDraft>;

export const spokenBriefingDraft = z
  .object({
    script: z.string().min(1),
    /** Evidence IDs per sentence, not spoken. */
    sentenceEvidence: z.array(z.array(z.string())),
    speakerAgentId: z.string().min(1),
  })
  .strict();
export type SpokenBriefingDraft = z.infer<typeof spokenBriefingDraft>;

/** Output variant of the Research Synthesis Specialist (#22). */
export const synthesisOutput = z
  .object({ findingDraft, spokenBriefingDraft })
  // Like AgentOutput: extra keys (such as a status) fail parsing (SIE V9).
  .strict();
export type SynthesisOutput = z.infer<typeof synthesisOutput>;

export const sieValidatorId = z.enum([
  "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "VV1", "VV2", "VV3", "VR1", "VA1",
]);
export type SieValidatorId = z.infer<typeof sieValidatorId>;

/** One append-only row of `sie_decisions` (SCIENTIFIC_INTEGRITY.md §6). */
export const sieDecisionRecord = z.object({
  id: z.string().min(1),
  kind: z.enum(["finding", "voice", "reference", "debate_turn"]),
  /** sha256 of the canonical JSON input. */
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  subjectId: z.string().min(1),
  validatorResults: z.array(
    z.object({ validator: sieValidatorId, message: z.string(), index: z.number().int().optional() }),
  ),
  outcome: z.union([findingDecisionOutcome, voiceDecision, z.enum(["ACCEPT", "ASK_CLARIFICATION", "REMOVE"])]),
  reason: z.string(),
  source: z.enum(["jev", "fallback", "deterministic"]),
  jevRequestIds: z.array(z.string()).default([]),
  decidedAt: isoTimestamp,
});
export type SieDecisionRecord = z.infer<typeof sieDecisionRecord>;
