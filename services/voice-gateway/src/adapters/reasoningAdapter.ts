// Voice agents 51, 53 and 54 run inside the gateway as direct model calls for latency (AGENTS.md §8).
// Their model output is untrusted: it is zod-parsed here and then checked by the SIE before anything is said.
import { z } from "zod";
import type { EvidenceItem, FieldNote, MeasurementRecord, Result, ScientificFinding } from "@nexus/schemas";
import type { ValidationIssue } from "@nexus/sie";

export const fieldNoteInterpretation = z.object({
  descriptors: z.array(z.string()),
  intentHint: z.literal("question").nullable().optional(),
});
export type FieldNoteInterpretation = z.infer<typeof fieldNoteInterpretation>;

export const spokenAnswer = z.object({
  script: z.string(),
  sentenceEvidence: z.array(z.array(z.string())),
  speakerAgentId: z.string().min(1).optional(),
  noEvidence: z.boolean().default(false),
});
export type SpokenAnswer = z.infer<typeof spokenAnswer>;

export interface GroundingContext {
  finding: ScientificFinding;
  evidence: EvidenceItem[];
  measurements: MeasurementRecord[];
  fieldNotes: FieldNote[];
}

export interface ReasoningAdapter {
  /** Field Note Interpreter #51. */
  interpretFieldNote(input: { transcript: string; language: string }): Promise<Result<FieldNoteInterpretation>>;
  /** Dialogue Grounding Agent #53. `issues` is set on the one rewrite attempt. */
  answerQuestion(input: { question: string; context: GroundingContext; issues?: readonly ValidationIssue[] }): Promise<Result<SpokenAnswer>>;
  /** Spoken Briefing Composer #54, used for the one briefing rewrite. */
  composeBriefing(input: { context: GroundingContext; previousScript: string; issues: readonly ValidationIssue[] }): Promise<Result<SpokenAnswer>>;
}

/** Scripted answers for tests and precomputed mode. */
export class FakeReasoning implements ReasoningAdapter {
  answers: SpokenAnswer[] = [];
  descriptors: string[] | undefined;

  async interpretFieldNote(): Promise<Result<FieldNoteInterpretation>> {
    return this.descriptors ? { ok: true, value: { descriptors: this.descriptors } } : { ok: false, error: "not configured" };
  }
  async answerQuestion(): Promise<Result<SpokenAnswer>> {
    const a = this.answers.shift();
    return a ? { ok: true, value: a } : { ok: false, error: "not configured" };
  }
  async composeBriefing(): Promise<Result<SpokenAnswer>> {
    return this.answerQuestion();
  }
}
