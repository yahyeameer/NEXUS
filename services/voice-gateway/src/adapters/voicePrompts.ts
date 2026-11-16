// Canonical instruction specs for the voice agents live in agents/prompts. Node services read them at start-up so code
// and spec cannot drift; the Cloudflare function gets the same text from a generated module (scripts/genPrompts.mjs).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GeminiReasoning } from "./geminiReasoningAdapter.js";
import type { GeminiReasoningOptions } from "./geminiReasoningAdapter.js";

export interface VoicePrompts {
  teamRules: string;
  fieldNoteInterpreter: string;
  dialogueGrounding: string;
  briefingComposer: string;
}

/** Prompt file stem per field, shared with the generator. */
export const VOICE_PROMPT_FILES: Record<keyof VoicePrompts, string> = {
  teamRules: "_team_rules",
  fieldNoteInterpreter: "field_note_interpreter",
  dialogueGrounding: "dialogue_grounding_agent",
  briefingComposer: "spoken_briefing_composer",
};

export function loadVoicePrompts(repoRoot: string): VoicePrompts {
  const read = (key: keyof VoicePrompts) => readFileSync(join(repoRoot, "agents/prompts", `${VOICE_PROMPT_FILES[key]}.md`), "utf8");
  return {
    teamRules: read("teamRules"),
    fieldNoteInterpreter: read("fieldNoteInterpreter"),
    dialogueGrounding: read("dialogueGrounding"),
    briefingComposer: read("briefingComposer"),
  };
}

/** Gemini is on only when the backend has a key; without one the gateway keeps its deterministic paths. */
export function geminiFromEnv(env: Record<string, string | undefined>, repoRoot: string, log?: GeminiReasoningOptions["log"]): GeminiReasoning | undefined {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return undefined;
  return new GeminiReasoning({
    prompts: loadVoicePrompts(repoRoot),
    apiKey,
    model: env.GEMINI_MODEL || undefined,
    fastModel: env.GEMINI_FAST_MODEL || undefined,
    log,
  });
}
