import { randomBytes } from "node:crypto";
import type { Observation, ScientificFinding, SynthesisOutput } from "@nexus/schemas";
import type { FindingEvaluation, VoiceEvaluation } from "@nexus/sie";
import type { EvidenceStore } from "./evidenceStore.js";

export function newId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

/** Assemble the stored finding from SIE results only; nothing from the draft bypasses evaluation. */
export function buildFinding(args: {
  id: string;
  observation: Observation;
  synthesis: SynthesisOutput;
  evaluation: FindingEvaluation;
  voice: VoiceEvaluation;
  evidence: EvidenceStore;
  now: string;
  createdAt?: string;
}): ScientificFinding {
  const { synthesis, evaluation, voice, evidence, observation, now } = args;
  return {
    id: args.id,
    observationId: observation.id,
    title: synthesis.findingDraft.title,
    summary: evaluation.summary,
    claimType: synthesis.findingDraft.claimType,
    claims: evaluation.claims,
    removedClaims: evaluation.removedClaims,
    possibleInterpretations: evaluation.possibleInterpretations,
    sources: sourcesFor(evaluation, evidence, observation),
    spatialAnchor: evaluation.spatialAnchor,
    uncertainty: synthesis.findingDraft.uncertainty,
    contested: evaluation.contested,
    decision: evaluation.decision,
    status: evaluation.status,
    spokenBriefing: {
      ...synthesis.spokenBriefingDraft,
      sentenceEvidence: synthesis.spokenBriefingDraft.sentenceEvidence.map((s) => [...s]),
      voiceDecision: voice.decision,
    },
    createdAt: args.createdAt ?? now,
    updatedAt: now,
  };
}

/** One source per cited evidence item; measurements credit the DEM they were computed from. */
function sourcesFor(e: FindingEvaluation, evidence: EvidenceStore, observation: Observation): ScientificFinding["sources"] {
  const byId = new Map(evidence.items.map((i) => [i.id, i]));
  const meas = new Map(evidence.measurements.map((m) => [m.id, m]));
  const ids = new Set<string>();
  for (const c of e.claims) for (const id of [...c.evidenceIds, ...(c.measurementIds ?? [])]) ids.add(meas.get(id)?.sourceEvidenceId ?? id);
  const out: ScientificFinding["sources"] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (item) out.push({ dataset: item.dataset ?? item.title, sourceUrl: item.sourceUrl, evidenceId: item.id, observationId: observation.id });
  }
  return out;
}

/** Findings the headset may render. REJECT never leaves the backend. */
export function renderable(f: ScientificFinding): boolean {
  return f.decision.outcome !== "REJECT";
}
