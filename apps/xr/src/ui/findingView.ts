// What a finding card shows (PRD §6.6, INTERACTION.md §4). Pure: the panel only draws these lines.
import type { ClaimType, FindingDecisionOutcome, ScientificFinding, Uncertainty } from "@nexus/schemas";
import type { BadgeTone } from "./spatial/tokens.js";

export type RingState = "observed" | "researching" | "ready" | "needs_evidence" | "reviewed" | "closed";

export const CLAIM_LABEL: Record<ClaimType, string> = {
  observation: "Observation",
  measurement: "Measurement",
  interpretation: "Interpretation",
  hypothesis: "Hypothesis",
};

/** Fixed reason chips for a hands-only review; the chosen text is stored verbatim as the rationale. */
export const REASON_CHIPS = ["Insufficient evidence", "Measurement method doubtful", "Wrong feature selected", "Needs another dataset"] as const;

export interface CardLine {
  text: string;
  tone: "title" | "body" | "muted" | "warn";
  /** Claim type badge, shown before the text. */
  badge?: string;
  badgeTone?: BadgeTone;
}

export interface CardModel {
  findingId: string;
  lines: CardLine[];
  sources: { evidenceId: string; label: string }[];
  /** Review buttons only while awaiting the scientist (AGENTS.md rule 8). */
  reviewable: boolean;
  /** The speaker icon only when the SIE approved the briefing for speech. */
  speakable: boolean;
  /** A Compare button only when the finding carries an interpretation or hypothesis. */
  comparable: boolean;
  ring: RingState;
}

export function ringFor(f: Pick<ScientificFinding, "status" | "decision" | "review">): RingState {
  switch (f.status) {
    case "researching":
      return f.decision.outcome === "REQUEST_MORE_EVIDENCE" ? "needs_evidence" : "researching";
    case "ready_for_review":
      return "ready";
    case "reviewed":
      return "reviewed";
    case "rejected":
    case "inconclusive":
      return "closed";
  }
}

const STATUS_LABEL: Record<ScientificFinding["status"], string> = {
  researching: "Researching",
  ready_for_review: "Ready for your review",
  reviewed: "Approved by you",
  rejected: "Rejected by you",
  inconclusive: "Marked inconclusive by you",
};

/** What the Scientific Integrity Engine decided, in the scientist's words (SCIENTIFIC_INTEGRITY.md §4). */
export const OUTCOME_LABEL: Record<FindingDecisionOutcome, string> = {
  ACCEPT_FOR_REVIEW: "Passed for your review",
  REQUEST_MORE_EVIDENCE: "More evidence requested",
  REJECT: "Held back by the integrity check",
  ESCALATE_TO_SCIENTIST: "Escalated to you",
};

/**
 * PRD §6.6: an interpretation or hypothesis is the AI's reading, never an established result. The card says so in
 * plain words whenever the finding or any of its claims is one.
 */
export const SPECULATIVE_NOTE: Partial<Record<ClaimType, string>> = {
  interpretation: "AI interpretation: a possible reading for you to judge, not an established result.",
  hypothesis: "AI hypothesis: untested, for you to judge. Not an established result.",
};

/** UncertaintyIndicator: a three-step meter plus the level, coloured neutral, amber or red. */
export function uncertaintyBadge(level: Uncertainty["level"]): { badge: string; badgeTone: BadgeTone } {
  const filled = { low: 1, medium: 2, high: 3 }[level];
  return { badge: `Uncertainty ${"●".repeat(filled)}${"○".repeat(3 - filled)}`, badgeTone: `uncertainty-${level}` };
}

/** Evidence the finding leans on and evidence against it, from claims and interpretations, without repeats. */
export function evidenceSides(f: ScientificFinding): { supporting: string[]; contradicting: string[] } {
  const supporting = [
    ...f.claims.flatMap((c) => [...(c.measurementIds ?? []), ...c.evidenceIds]),
    ...f.possibleInterpretations.flatMap((i) => i.supportingEvidenceIds),
  ];
  const contradicting = [...f.claims.flatMap((c) => c.contradictingEvidenceIds ?? []), ...f.possibleInterpretations.flatMap((i) => i.contradictingEvidenceIds)];
  return { supporting: [...new Set(supporting)], contradicting: [...new Set(contradicting)] };
}

function ids(list: string[]): string {
  return list.length ? list.join(", ") : "none recorded";
}

export function cardModel(f: ScientificFinding): CardModel {
  const decisionHeld = f.decision.outcome === "REJECT" || f.decision.outcome === "REQUEST_MORE_EVIDENCE";
  const lines: CardLine[] = [
    { text: f.title, tone: "title" },
    { text: `Research status: ${STATUS_LABEL[f.status]} · AI-generated`, tone: "muted" },
    { text: `Observation ${f.observationId}`, tone: "muted", badge: CLAIM_LABEL[f.claimType], badgeTone: f.claimType },
    {
      text: `${OUTCOME_LABEL[f.decision.outcome]}: ${f.decision.reason} (${f.decision.source === "jev" ? "Jev decision" : "rule-based fallback"})`,
      tone: decisionHeld ? "warn" : "muted",
      badge: "Integrity check",
    },
    // Uncertainty sits with the integrity check on the first page: how sure to be matters before what is claimed.
    { text: `${f.uncertainty.level}: ${f.uncertainty.explanation}`, tone: f.uncertainty.level === "high" ? "warn" : "muted", ...uncertaintyBadge(f.uncertainty.level) },
  ];
  const speculative = new Set<ClaimType>([f.claimType, ...f.claims.map((c) => c.claimType)]);
  if (f.possibleInterpretations.length) speculative.add("interpretation");
  for (const t of ["hypothesis", "interpretation"] as const) {
    const note = SPECULATIVE_NOTE[t];
    if (note && speculative.has(t)) {
      lines.push({ text: note, tone: "muted" });
      break;
    }
  }
  if (f.contested) lines.push({ text: "Contested: the evidence points both ways", tone: "warn" });
  lines.push({ text: f.summary, tone: "body" });
  for (const c of f.claims) lines.push({ text: c.text, tone: "body", badge: CLAIM_LABEL[c.claimType], badgeTone: c.claimType });
  for (const i of f.possibleInterpretations) {
    lines.push({ text: `One possible reading: ${i.explanation}`, tone: "body", badge: CLAIM_LABEL.interpretation, badgeTone: "interpretation" });
  }
  const sides = evidenceSides(f);
  lines.push({ text: `Supporting evidence: ${ids(sides.supporting)}`, tone: "muted" });
  lines.push({ text: `Contradicting evidence: ${ids(sides.contradicting)}`, tone: sides.contradicting.length ? "body" : "muted" });
  const datasets = [...new Set(f.sources.map((s) => s.dataset))];
  lines.push({ text: `Source datasets: ${datasets.length ? datasets.join("; ") : "none listed"}`, tone: "muted" });
  // SCIENTIFIC_INTEGRITY.md: removed claims stay visible so the scientist sees what the SIE took out.
  for (const r of f.removedClaims) lines.push({ text: `Removed: no evidence. ${r.text}`, tone: "muted" });
  if (f.review?.rationaleText) lines.push({ text: `Your reason: ${f.review.rationaleText}`, tone: "muted" });
  return {
    findingId: f.id,
    lines,
    sources: f.sources.map((s) => ({ evidenceId: s.evidenceId, label: s.dataset })),
    reviewable: f.status === "ready_for_review",
    speakable: f.spokenBriefing?.voiceDecision === "SPEAK_AS_APPROVED",
    comparable: comparisonEntries(f).length > 0,
    ring: ringFor(f),
  };
}

export interface ComparisonEntry {
  claimType: ClaimType;
  text: string;
  supporting: string[];
  contradicting: string[];
}

/**
 * HypothesisComparison: every interpretation and hypothesis the finding carries, each with the evidence for and
 * against it. Only what the finding holds; nothing is ranked or scored here, because weighing them is the scientist's job.
 */
export function comparisonEntries(f: ScientificFinding): ComparisonEntry[] {
  const fromClaims = f.claims
    .filter((c) => c.claimType === "interpretation" || c.claimType === "hypothesis")
    .map((c) => ({ claimType: c.claimType, text: c.text, supporting: [...(c.measurementIds ?? []), ...c.evidenceIds], contradicting: c.contradictingEvidenceIds ?? [] }));
  const fromReadings = f.possibleInterpretations.map((i) => ({
    claimType: "interpretation" as const,
    text: i.explanation,
    supporting: i.supportingEvidenceIds,
    contradicting: i.contradictingEvidenceIds,
  }));
  return [...fromClaims, ...fromReadings];
}

export function comparisonLines(f: ScientificFinding): CardLine[] {
  const entries = comparisonEntries(f);
  const lines: CardLine[] = [
    { text: "Possible readings side by side", tone: "title" },
    { text: "AI-generated. None of these is an established result; the evidence below is for you to weigh.", tone: "muted" },
  ];
  if (entries.length === 0) lines.push({ text: "This finding carries no interpretation or hypothesis.", tone: "muted" });
  else if (entries.length === 1) lines.push({ text: "Only one reading was recorded, so there is no rival to compare it with.", tone: "muted" });
  entries.forEach((e, n) => {
    lines.push({ text: `${n + 1}. ${e.text}`, tone: "body", badge: CLAIM_LABEL[e.claimType], badgeTone: e.claimType });
    lines.push({ text: `For: ${ids(e.supporting)}`, tone: "muted" });
    lines.push({ text: `Against: ${ids(e.contradicting)}`, tone: e.contradicting.length ? "body" : "muted" });
  });
  return lines;
}

/** "25_lroc_imagery_researcher" → "LROC imagery researcher". */
export function agentName(id: string): string {
  if (id === "narrator") return "Narrator";
  const words = id.replace(/^\d+_/, "").split("_");
  const acronyms = new Set(["lroc", "lola", "nac", "dtm"]);
  const text = words.map((w) => (acronyms.has(w) ? w.toUpperCase() : w)).join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
