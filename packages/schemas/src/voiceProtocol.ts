// WebSocket protocol between apps/xr and services/voice-gateway (VOICE.md §2). Audio travels as binary frames.
import { z } from "zod";
import { fieldNote } from "./observation.js";

export const vec3 = z.object({ x: z.number(), y: z.number(), z: z.number() });

/** 30 Hz ray/head samples on the audio clock (VOICE.md §2). */
export const pointerSample = z.object({
  tMs: z.number(),
  rayFeatureId: z.string().optional(),
  rayPoint: vec3.optional(),
  onUi: z.boolean(),
  headPosition: vec3,
  headDirection: vec3,
});

/** A labelled feature in scene coordinates, sent by the headset for deictic resolution. */
export const candidateFeature = z.object({
  id: z.string().min(1),
  spokenLabel: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  position: vec3,
  size: z.number().min(0).max(1).optional(),
  albedo: z.number().min(0).max(1).optional(),
});

export const voiceClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth"), token: z.string().min(1), sessionId: z.string().min(1) }),
  z.object({
    type: z.literal("context"),
    siteId: z.string().min(1),
    sites: z.array(z.object({ siteId: z.string(), names: z.array(z.string()) })).default([]),
    selectedFindingId: z.string().optional(),
    candidates: z.array(candidateFeature).default([]),
    language: z.string().min(2).default("en"),
  }),
  z.object({ type: z.literal("ptt.start"), sampleRateHz: z.number().int().positive().default(16000) }),
  z.object({ type: z.literal("pointer"), samples: z.array(pointerSample).max(300) }),
  z.object({ type: z.literal("ptt.end") }),
  /** Hand path for a clarification: poke the highlighted candidate (INTERACTION.md parity table). */
  z.object({ type: z.literal("clarify.choose"), featureId: z.string().min(1) }),
]);
export type VoiceClientMessage = z.infer<typeof voiceClientMessage>;

export const speakMessage = z.object({
  type: z.literal("speak"),
  scriptId: z.string(),
  text: z.string(),
  speaker: z.string(),
  voice: z.string(),
  placement: z.string(),
  rate: z.number(),
  /** Exactly one of these: an SIE approval or a fixed system phrase (AGENTS.md rule 2). */
  sieDecisionId: z.string().optional(),
  systemPhraseId: z.string().optional(),
  audioBase64: z.string().optional(),
  mimeType: z.string().optional(),
});

export const voiceServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("transcript"), utteranceId: z.string(), text: z.string(), final: z.boolean() }),
  z.object({ type: z.literal("low_confidence"), utteranceId: z.string(), text: z.string() }),
  z.object({ type: z.literal("command"), utteranceId: z.string(), command: z.record(z.unknown()) }),
  z.object({ type: z.literal("intent"), utteranceId: z.string(), intent: z.string() }),
  z.object({
    type: z.literal("clarify"),
    utteranceId: z.string(),
    candidates: z.array(z.object({ featureId: z.string(), label: z.string(), score: z.number() })),
    prompt: z.string(),
  }),
  z.object({ type: z.literal("fieldnote.created"), fieldNote, observationId: z.string() }),
  z.object({ type: z.literal("reviewed"), findingId: z.string(), status: z.string() }),
  speakMessage,
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type VoiceServerMessage = z.infer<typeof voiceServerMessage>;
