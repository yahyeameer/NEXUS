// VR1 (reference) and VA1 (attribution) for field notes (SCIENTIFIC_INTEGRITY.md §2, VOICE.md §4).
import { DEICTIC_CONFIDENCE_THRESHOLD } from "@nexus/schemas";
import type { FieldNote, VoiceUtterance } from "@nexus/schemas";
import type { ValidationResult } from "./types.js";

/** VR1: never anchor a field note below the deictic confidence threshold. */
export function validateReference(note: Pick<FieldNote, "reference">): ValidationResult {
  if (note.reference.method === "manual") return { ok: true, value: true };
  if (note.reference.confidence >= DEICTIC_CONFIDENCE_THRESHOLD) return { ok: true, value: true };
  return {
    ok: false,
    error: [{ validator: "VR1", message: `reference confidence ${note.reference.confidence} below ${DEICTIC_CONFIDENCE_THRESHOLD}` }],
  };
}

/**
 * VA1: the scientist's words are stored verbatim and descriptors are only words they said
 * (catalog #51 may not add descriptors; #56 may not paraphrase).
 */
export function validateAttribution(
  note: Pick<FieldNote, "transcript" | "descriptors" | "utteranceId">,
  utterance: Pick<VoiceUtterance, "id" | "transcript" | "speaker">,
): ValidationResult {
  const issues: { validator: "VA1"; message: string }[] = [];
  if (utterance.speaker !== "scientist") issues.push({ validator: "VA1", message: "field note source is not the scientist" });
  if (note.utteranceId !== utterance.id) issues.push({ validator: "VA1", message: "field note cites a different utterance" });
  if (note.transcript !== utterance.transcript) issues.push({ validator: "VA1", message: "transcript is not verbatim" });
  const said = new Set(words(utterance.transcript));
  for (const d of note.descriptors) {
    if (!words(d).every((w) => said.has(w))) issues.push({ validator: "VA1", message: `descriptor "${d}" was not said` });
  }
  return issues.length === 0 ? { ok: true, value: true } : { ok: false, error: issues };
}

function words(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}\p{N}'-]+/gu) ?? [];
}
