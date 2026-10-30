// VOICE.md §10: fixed strings that may be spoken without an SIE decision.
// They must contain no scientific claims. Any change requires review.
export const systemPhrases = {
  welcome: "Welcome to NEXUS.",
  onboardingHint: "Pinch to select. Palm up for the menu.",
  listening: "Listening.",
  didNotCatch: "I didn't catch that.",
  paused: "Paused.",
  resumed: "Resumed.",
  noEvidence: "I don't have evidence for that in this investigation.",
  audioUnavailable: "Audio is unavailable. Showing captions only.",
  error: "Something went wrong. Please try again.",
  thinking: "One moment.",
  noted: "Noted.",
  whichFeature: "Which feature do you mean?",
} as const;

export type SystemPhraseId = keyof typeof systemPhrases;

/**
 * VOICE.md §4 clarification question. The only templated system phrase: it may only insert
 * curated feature labels from features.json, never model text, so it carries no claim.
 */
export function clarificationPhrase(labelA: string, labelB: string): string {
  return `Do you mean ${labelA} or ${labelB}?`;
}

export function isSystemPhrase(text: string): boolean {
  return (Object.values(systemPhrases) as string[]).includes(text);
}
