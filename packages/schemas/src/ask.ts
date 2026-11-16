// Grounded Q&A over HTTP for the standalone (Cloudflare) build: the headset asks one of a fixed set of questions about
// the selected finding, and the edge function answers only with an SIE-approved script (AGENTS.md rule 2).
// The questions are fixed so the build is hands-complete (poke a chip, no keyboard in XR, AGENTS.md rule 1) and so
// the public endpoint cannot be used as a general chatbot on the project's model key.
import { z } from "zod";

export const ASK_QUESTIONS = {
  summary: "What does the evidence show about this feature?",
  measurements: "What do the terrain measurements say?",
  image: "What does the image show?",
  certainty: "How certain is this finding?",
} as const;

export const askQuestionId = z.enum(["summary", "measurements", "image", "certainty"]);
export type AskQuestionId = z.infer<typeof askQuestionId>;

export const askRequest = z.object({
  findingId: z.string().min(1).max(120),
  questionId: askQuestionId,
});
export type AskRequest = z.infer<typeof askRequest>;

export const askAnswer = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("approved"),
    script: z.string().min(1),
    sentenceEvidence: z.array(z.array(z.string())),
    /** SIE audit record id; the client speaks only with one (AGENTS.md rule 2). */
    sieDecisionId: z.string().min(1),
    speechRate: z.number().positive(),
    /** "live": Gemini answered now. "saved": a stored Gemini answer, used when the live call fails (AGENTS.md §6). */
    source: z.enum(["live", "saved"]),
  }),
  /** No answer passed the SIE, or the evidence does not cover the question: the client says the fixed phrase. */
  z.object({ kind: z.literal("no_evidence") }),
]);
export type AskAnswer = z.infer<typeof askAnswer>;

/** Stored answers for the demo sites (data/demo/answers.json, `pnpm demo:answers`). Re-checked by the SIE when served. */
export const savedAnswers = z.object({
  kind: z.literal("nexus-saved-answers"),
  note: z.string().min(1),
  answers: z.array(
    z.object({
      findingId: z.string().min(1),
      questionId: askQuestionId,
      script: z.string().min(1),
      sentenceEvidence: z.array(z.array(z.string())),
      model: z.string().min(1),
    }),
  ),
});
export type SavedAnswers = z.infer<typeof savedAnswers>;
