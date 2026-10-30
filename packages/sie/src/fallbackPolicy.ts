// Deterministic answers to the Jev decision questions, used when Jev is unavailable
// (SCIENTIFIC_INTEGRITY.md §4). Decisions logged with source "fallback".
import { DEICTIC_CONFIDENCE_THRESHOLD } from "@nexus/schemas";
import type { EscalationQuestion, ReferenceQuestion, SpecialistQuestion, SufficiencyQuestion } from "./decisionAdapter.js";

/** VOICE.md §4: ask when the top two candidates are this close. */
export const CLARIFY_MARGIN = 0.1;

const INTERPRETIVE = /\b(why|how|formed|origin|lava|channel|collapse|impact|old|age|strange|unusual|odd)\b/i;

/** MVP research team order (AGENT_CATALOG.md): measurement and imagery first, interpretation only when asked for. */
export function selectSpecialistsFallback(q: SpecialistQuestion): string[] {
  const wanted = ["26_lola_elevation_researcher", "25_lroc_imagery_researcher"];
  const interpretive = q.featureKind === "rille" || q.descriptors.some((d) => INTERPRETIVE.test(d));
  if (q.featureKind !== "point") wanted.push("11_lunar_geology_researcher");
  if (interpretive) wanted.push("33_hypothesis_generator", "34_alternative_explanation_researcher");
  wanted.push("37_uncertainty_analyst", "22_research_synthesis_specialist");
  return wanted.filter((a) => q.allowed.includes(a));
}

export function evidenceSufficientFallback(q: SufficiencyQuestion): boolean {
  return q.survivingClaims >= 2 && q.groundedObservationOrMeasurement && !q.validatorIssues.some((i) => i.validator === "V7");
}

export function needsEscalationFallback(q: EscalationQuestion): boolean {
  if (q.impact === "high") return true;
  if (!q.contradiction) return false;
  return !q.contradictionPresented || q.uncertainty === "high";
}

export function referenceNeedsClarificationFallback(q: ReferenceQuestion): boolean {
  const [top = 0, second = 0] = [...q.scores].sort((a, b) => b - a);
  return top < DEICTIC_CONFIDENCE_THRESHOLD || top - second < CLARIFY_MARGIN;
}
