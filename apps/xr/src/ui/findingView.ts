// What a finding card shows (PRD §6.6, INTERACTION.md §4). Pure: the panel only draws these lines.
import type { ClaimType, ScientificFinding } from "@nexus/schemas";

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
}

export interface CardModel {
  findingId: string;
  lines: CardLine[];
  sources: { evidenceId: string; label: string }[];
  /** Review buttons only while awaiting the scientist (AGENTS.md rule 8). */
  reviewable: boolean;
  /** The speaker icon only when the SIE approved the briefing for speech. */
  speakable: boolean;
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

export function cardModel(f: ScientificFinding): CardModel {
  const lines: CardLine[] = [
    { text: f.title, tone: "title" },
    { text: `${STATUS_LABEL[f.status]} · AI-generated`, tone: "muted" },
  ];
  if (f.contested) lines.push({ text: "Contested: the evidence points both ways", tone: "warn" });
  lines.push({ text: f.summary, tone: "body" });
  for (const c of f.claims) lines.push({ text: c.text, tone: "body", badge: CLAIM_LABEL[c.claimType] });
  for (const i of f.possibleInterpretations) lines.push({ text: `One interpretation: ${i.explanation}`, tone: "body", badge: CLAIM_LABEL.interpretation });
  lines.push({ text: `Uncertainty ${f.uncertainty.level}: ${f.uncertainty.explanation}`, tone: f.uncertainty.level === "high" ? "warn" : "muted" });
  // SCIENTIFIC_INTEGRITY.md: removed claims stay visible so the scientist sees what the SIE took out.
  for (const r of f.removedClaims) lines.push({ text: `Removed: no evidence. ${r.text}`, tone: "muted" });
  if (f.review?.rationaleText) lines.push({ text: `Your reason: ${f.review.rationaleText}`, tone: "muted" });
  return {
    findingId: f.id,
    lines,
    sources: f.sources.map((s) => ({ evidenceId: s.evidenceId, label: s.dataset })),
    reviewable: f.status === "ready_for_review",
    speakable: f.spokenBriefing?.voiceDecision === "SPEAK_AS_APPROVED",
    ring: ringFor(f),
  };
}

/** "25_lroc_imagery_researcher" → "LROC imagery researcher". */
export function agentName(id: string): string {
  if (id === "narrator") return "Narrator";
  const words = id.replace(/^\d+_/, "").split("_");
  const acronyms = new Set(["lroc", "lola", "nac", "dtm"]);
  const text = words.map((w) => (acronyms.has(w) ? w.toUpperCase() : w)).join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
