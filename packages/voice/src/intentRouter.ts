// Intent routing (VOICE.md §3). Fixed grammar first; an LLM classifier is only a fallback for "unknown".
import { normalize } from "./normalize.js";

export interface SiteName {
  siteId: string;
  /** Spoken names, e.g. ["hadley rille", "the rille"]. */
  names: readonly string[];
}

export type Command =
  | { kind: "investigate"; target: "this" | "that" | { siteId: string } }
  | { kind: "zoom"; direction: "in" | "out" }
  | { kind: "rotate"; direction: "left" | "right" }
  | { kind: "show"; what: "evidence" | "sources" }
  | { kind: "hide_panel" }
  | { kind: "next_site" }
  | { kind: "previous_site" }
  | { kind: "go_to"; siteId: string }
  | { kind: "read_it" }
  | { kind: "stop" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "reset"; what: "position" | "view" }
  | { kind: "provenance" }
  | { kind: "mark" }
  | { kind: "whisper"; on: boolean }
  | { kind: "mode"; mode: "tabletop" | "immersive" }
  | { kind: "onboarding"; action: "start" | "skip" };

export type RoutedIntent =
  | { intent: "command"; command: Command }
  | { intent: "review"; decision: "approved" | "rejected" | "inconclusive"; /** Verbatim from the transcript (SIE VA1). */ rationaleText?: string }
  | { intent: "debate" }
  | { intent: "field_note"; /** Verbatim note text. */ text: string }
  | { intent: "question"; text: string }
  | { intent: "clarification"; answer: string }
  | { intent: "unknown"; text: string };

export interface RouteContext {
  sites: readonly SiteName[];
  /** A clarification chip set is open: the next utterance answers it. */
  pendingClarification?: boolean;
  /** The hand ray was on terrain while speaking. */
  pointing?: boolean;
}

type Rule = [RegExp, (m: RegExpMatchArray) => Command];

const FIXED: readonly Rule[] = [
  [/^zoom (in|out)$/, (m) => ({ kind: "zoom", direction: m[1] as "in" | "out" })],
  [/^rotate (left|right)$/, (m) => ({ kind: "rotate", direction: m[1] as "left" | "right" })],
  [/^show (?:me )?(?:the )?(evidence|sources)$/, (m) => ({ kind: "show", what: m[1] as "evidence" | "sources" })],
  [/^hide (?:the )?panel$/, () => ({ kind: "hide_panel" })],
  [/^next site$/, () => ({ kind: "next_site" })],
  [/^previous site$/, () => ({ kind: "previous_site" })],
  [/^read (?:it|this|that)(?: to me)?(?: out)?$/, () => ({ kind: "read_it" })],
  [/^(?:stop|quiet|be quiet)$/, () => ({ kind: "stop" })],
  [/^pause$/, () => ({ kind: "pause" })],
  [/^resume$/, () => ({ kind: "resume" })],
  [/^reset (position|view)$/, (m) => ({ kind: "reset", what: m[1] as "position" | "view" })],
  [/^where (?:does|did) (?:that|this|it) come from$/, () => ({ kind: "provenance" })],
  [/^mark (?:this|that|here)$/, () => ({ kind: "mark" })],
  [/^whisper mode (on|off)$/, (m) => ({ kind: "whisper", on: m[1] === "on" })],
  [/^(tabletop|immersive) mode$/, (m) => ({ kind: "mode", mode: m[1] as "tabletop" | "immersive" })],
  [/^(start|skip)$/, (m) => ({ kind: "onboarding", action: m[1] as "start" | "skip" })],
];

const REVIEW = /^(approve|approved|reject|rejected|inconclusive|mark (?:it )?inconclusive)\b/;
const QUESTION_START = /^(why|what|which|where|how|when|who|is|are|does|do|did|can|could|would|should|has|have)\b/;
const NOTE_START = /^(?:note|mark)\b[\s:,-]*/i;

export function routeIntent(transcript: string, ctx: RouteContext): RoutedIntent {
  const text = normalize(transcript);
  if (text.length === 0) return { intent: "unknown", text };

  for (const [re, make] of FIXED) {
    const m = text.match(re);
    if (m) return { intent: "command", command: make(m) };
  }

  const investigate = text.match(/^investigate (.+)$/);
  if (investigate?.[1]) {
    const target = investigate[1];
    if (target === "this" || target === "that") return { intent: "command", command: { kind: "investigate", target } };
    const siteId = findSite(target, ctx.sites);
    if (siteId) return { intent: "command", command: { kind: "investigate", target: { siteId } } };
  }
  const goTo = text.match(/^go to (.+)$/);
  if (goTo?.[1]) {
    const siteId = findSite(goTo[1], ctx.sites);
    if (siteId) return { intent: "command", command: { kind: "go_to", siteId } };
  }

  if (/^(?:debate this|argue both sides)$/.test(text)) return { intent: "debate" };

  const review = text.match(REVIEW);
  if (review?.[1]) {
    const word = review[1];
    const decision = word.startsWith("approve") ? "approved" : word.startsWith("reject") ? "rejected" : "inconclusive";
    return { intent: "review", decision, rationaleText: verbatimReason(transcript) };
  }

  if (ctx.pendingClarification) return { intent: "clarification", answer: transcript.trim() };

  if (NOTE_START.test(transcript.trim())) {
    return { intent: "field_note", text: transcript.trim().replace(NOTE_START, "").trim() };
  }
  if (transcript.trim().endsWith("?") || QUESTION_START.test(text)) return { intent: "question", text: transcript.trim() };
  // VOICE.md §3: a descriptive sentence while pointing is a field note.
  if (ctx.pointing && text.split(" ").length >= 2) return { intent: "field_note", text: transcript.trim() };
  return { intent: "unknown", text: transcript.trim() };
}

/** The scientist's reason after "because", exactly as said (catalog #56 may not paraphrase). */
function verbatimReason(transcript: string): string | undefined {
  const m = transcript.match(/\bbecause\b\s*(.+)$/i);
  const reason = m?.[1]?.trim();
  return reason ? reason : undefined;
}

function findSite(spoken: string, sites: readonly SiteName[]): string | undefined {
  const s = spoken.replace(/^the /, "");
  return sites.find((site) => site.names.some((n) => normalize(n).replace(/^the /, "") === s))?.siteId;
}
