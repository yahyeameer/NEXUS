import { z } from "zod";
import { isoTimestamp } from "./common.js";
import { measurementRecord } from "./evidence.js";
import { fieldNote, observation } from "./observation.js";

/** `data/terrain/<SITE_ID>/features.json`: labelled features the scientist can select (DATASETS.md step 4). */
export const siteFeature = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  featureType: z.string().min(1),
  spokenLabel: z.string().min(1).optional(),
});
export type SiteFeature = z.infer<typeof siteFeature>;

export const siteFeatures = z.object({
  siteId: z.string().min(1),
  features: z.array(siteFeature),
});
export type SiteFeatures = z.infer<typeof siteFeatures>;

/** `data/terrain/<SITE_ID>/measurements.json`, written by packages/terrain. */
export const measurementFile = z.object({
  siteId: z.string().min(1),
  records: z.array(measurementRecord),
});
export type MeasurementFile = z.infer<typeof measurementFile>;

/** Written by services/orchestrator into NEXUS_RUN_DIR before a team run; read by the agent tools. */
export const agentRunContext = z.object({
  runId: z.string().min(1),
  observation,
  fieldNote: fieldNote.optional(),
  comparisonObservation: observation.optional(),
  allowedAgentIds: z.array(z.string()).optional(),
});
export type AgentRunContext = z.infer<typeof agentRunContext>;

/**
 * Team board note: how agents collaborate within one run. Notes are working context between
 * agents, never evidence, and are not shown to the scientist.
 */
export const teamNoteKind = z.enum(["preview", "question", "answer", "handoff", "caution"]);
export type TeamNoteKind = z.infer<typeof teamNoteKind>;

export const teamNote = z
  .object({
    id: z.string().min(1),
    runId: z.string().min(1),
    agentId: z.string().min(1),
    kind: teamNoteKind,
    text: z.string().min(1).max(600),
    toAgentId: z.string().min(1).optional(),
    replyTo: z.string().min(1).optional(),
    /** Only evidence or measurement IDs that exist in the store. */
    refs: z.array(z.string().min(1)),
    createdAt: isoTimestamp,
  })
  .strict();
export type TeamNote = z.infer<typeof teamNote>;

/** A web source an agent proposes for curation. Never citable until a curator adds it to a pack. */
export const evidenceCandidate = z
  .object({
    id: z.string().min(1),
    runId: z.string().min(1),
    agentId: z.string().min(1),
    siteId: z.string().min(1),
    url: z.string().url().startsWith("https://"),
    title: z.string().min(1).max(300),
    reason: z.string().min(1).max(600),
    status: z.literal("pending_curation"),
    createdAt: isoTimestamp,
  })
  .strict();
export type EvidenceCandidate = z.infer<typeof evidenceCandidate>;
