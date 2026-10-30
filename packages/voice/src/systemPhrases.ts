// VOICE.md §10: fixed strings that may be spoken without an SIE decision.
// They must contain no scientific claims. Any change requires review.
export const systemPhrases = {
  welcome: "Welcome to NEXUS.",
  listening: "Listening.",
  didNotCatch: "I didn't catch that.",
  paused: "Paused.",
  resumed: "Resumed.",
  noEvidence: "I don't have evidence for that in this investigation.",
  audioUnavailable: "Audio is unavailable. Showing captions only.",
  error: "Something went wrong. Please try again.",
} as const;

export type SystemPhraseId = keyof typeof systemPhrases;
