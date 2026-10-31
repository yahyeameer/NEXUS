// ScientificDecisionControls: the scientist's review buttons and the card's action row, in one place so their words
// stay within the rules: an AI finding is approved, rejected or left inconclusive by a person (AGENTS.md rule 8),
// and nothing ever says "confirmed", "discovered" or "proven" (AGENTS.md §10).
import type { ButtonSpec } from "./glassPanel.js";

export const DECISIONS = [
  { id: "card:approve", label: "Approve", style: "primary" },
  { id: "card:reject", label: "Reject", style: "danger" },
  { id: "card:inconclusive", label: "Inconclusive", style: "secondary" },
] as const satisfies readonly ButtonSpec[];

/**
 * Rows for a finding card, bottom-up as SpatialGlassPanel lays them out: the action row first, then the decision row
 * only while the finding waits for review, a "Hear it" chip only when the SIE approved the briefing for speech, and
 * "Compare" only when there are interpretations or hypotheses to set side by side.
 */
export function decisionControls(card: { reviewable: boolean; speakable: boolean; comparable?: boolean }, speaking: boolean): ButtonSpec[][] {
  const actions: ButtonSpec[] = [
    ...(card.speakable ? [{ id: "card:hear", label: speaking ? "Stop" : "Hear it", style: "chip" as const }] : []),
    ...(card.comparable ? [{ id: "card:compare", label: "Compare", style: "chip" as const }] : []),
    { id: "card:evidence", label: "Evidence", style: "chip" },
    { id: "card:sources", label: "Sources", style: "chip" },
    { id: "card:close", label: "Close" },
  ];
  return card.reviewable ? [actions, [...DECISIONS]] : [actions];
}
