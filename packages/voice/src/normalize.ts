/** Lower-case, drop punctuation and the optional wake word / fillers so grammar matching is stable. */
export function normalize(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[“”"]/g, "")
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:(?:hey|ok|okay|so|um|uh|nexus|please)\s+)+/, "")
    .replace(/\s+please$/, "")
    .trim();
}
