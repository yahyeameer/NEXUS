import { z } from "zod";
import { isoTimestamp } from "./common.js";

export const voiceIntent = z.enum(["command", "field_note", "question", "review", "debate", "clarification"]);
export type VoiceIntent = z.infer<typeof voiceIntent>;

export const voiceUtterance = z
  .object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    speaker: z.union([z.literal("scientist"), z.literal("narrator"), z.string().regex(/^agent:.+/)]),
    direction: z.enum(["in", "out"]),
    intent: voiceIntent.optional(),
    transcript: z.string(),
    words: z
      .array(z.object({ text: z.string(), startMs: z.number().nonnegative(), endMs: z.number().nonnegative() }))
      .optional(),
    sttConfidence: z.number().min(0).max(1).optional(),
    /** Opt-in only (AGENTS.md rule 9). */
    audioRef: z.string().optional(),
    language: z.string().min(2),
    sieDecisionId: z.string().optional(),
    systemPhraseId: z.string().optional(),
    createdAt: isoTimestamp,
  })
  // AGENTS.md rule 2: nothing is spoken without an SIE decision, except fixed system phrases.
  .refine((u) => u.direction === "in" || u.sieDecisionId !== undefined || u.systemPhraseId !== undefined, {
    message: "outgoing utterances need sieDecisionId unless they are a system phrase",
    path: ["sieDecisionId"],
  });
export type VoiceUtterance = z.infer<typeof voiceUtterance>;
