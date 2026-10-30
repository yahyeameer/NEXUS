import { z } from "zod";
import { claimType, isoTimestamp, uncertainty } from "./common.js";
import { claim } from "./agentOutput.js";
import { spatialAnchor } from "./spatialAnchor.js";

export const findingDecisionOutcome = z.enum([
  "ACCEPT_FOR_REVIEW",
  "REQUEST_MORE_EVIDENCE",
  "REJECT",
  "ESCALATE_TO_SCIENTIST",
]);
export type FindingDecisionOutcome = z.infer<typeof findingDecisionOutcome>;

export const voiceDecision = z.enum(["SPEAK_AS_APPROVED", "REWRITE_SCRIPT", "SILENT_CARD_ONLY"]);
export type VoiceDecision = z.infer<typeof voiceDecision>;

export const findingStatus = z.enum(["researching", "ready_for_review", "reviewed", "rejected", "inconclusive"]);
export type FindingStatus = z.infer<typeof findingStatus>;

export const reviewDecision = z.enum(["approved", "rejected", "inconclusive"]);
export type ReviewDecision = z.infer<typeof reviewDecision>;

export const scientificFinding = z.object({
  id: z.string().min(1),
  observationId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  claimType,
  claims: z.array(claim),
  /** Shown as "Removed: no evidence". */
  removedClaims: z.array(z.object({ text: z.string(), reason: z.string() })),
  possibleInterpretations: z.array(
    z.object({
      explanation: z.string(),
      supportingEvidenceIds: z.array(z.string()),
      contradictingEvidenceIds: z.array(z.string()),
    }),
  ),
  sources: z.array(
    z.object({
      dataset: z.string(),
      sourceUrl: z.string().url(),
      evidenceId: z.string(),
      observationId: z.string().optional(),
    }),
  ),
  spatialAnchor,
  uncertainty,
  contested: z.boolean(),
  decision: z.object({
    outcome: findingDecisionOutcome,
    reason: z.string(),
    source: z.enum(["jev", "fallback"]),
  }),
  status: findingStatus,
  spokenBriefing: z
    .object({
      script: z.string(),
      /** Evidence IDs per sentence. */
      sentenceEvidence: z.array(z.array(z.string())),
      voiceDecision,
      audioRef: z.string().optional(),
      speakerAgentId: z.string(),
    })
    .optional(),
  debateTranscriptId: z.string().optional(),
  review: z
    .object({
      decision: reviewDecision,
      /** Verbatim. */
      rationaleText: z.string().optional(),
      rationaleUtteranceId: z.string().optional(),
      reviewerId: z.string().min(1),
      reviewedAt: isoTimestamp,
    })
    .optional(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});
export type ScientificFinding = z.infer<typeof scientificFinding>;

/** Input to Jev / the fallback policy (SCIENTIFIC_INTEGRITY.md §5). */
export const scientificDecisionInput = z.object({
  observationId: z.string(),
  agentId: z.string(),
  agentScopeValid: z.boolean(),
  evidenceIds: z.array(z.string()),
  sourcesVerified: z.boolean(),
  contradictoryEvidence: z.boolean(),
  claimType,
  uncertaintyDeclared: z.boolean(),
  output: z.enum(["card", "speech"]),
  spokenScript: z.string().optional(),
  spokenNumbersMatchRecords: z.boolean().optional(),
  framingMatchesClaimType: z.boolean().optional(),
  deicticConfidence: z.number().min(0).max(1).optional(),
});
export type ScientificDecisionInput = z.infer<typeof scientificDecisionInput>;
