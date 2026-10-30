// SIE V4: each agent may only make claims inside its declared scope (docs/AGENT_CATALOG.md).
import type { ClaimType } from "@nexus/schemas";

export type Topic = "composition" | "formation" | "age";

/** Keyword detectors for topics that need data or expertise most agents do not have. */
export const TOPIC_PATTERNS: Record<Topic, RegExp> = {
  // Composition needs spectral data, which no MVP evidence pack carries (catalog #13 is post-MVP).
  composition:
    /\b(mineral(?:s|ogy|ogical)?|composition(?:al)?|composed of|olivine|pyroxene|ilmenite|plagioclase|anorthosit\w*|titanium|iron[- ]rich|spectr(?:al|um|a)|glass beads?|KREEP)\b/i,
  formation:
    /\b(formed|formation|origin|lava (?:tube|channel|flow)|volcanic|collapsed?|impact(?:-| )(?:origin|melt)|tectonic|graben|fault(?:ing)?|erosion|eroded|carved)\b/i,
  age: /\b(billion|million) years\b|\b(older|younger) than\b|\b(relative|absolute|model) age\b|\bcrater count/i,
};

export interface AgentScope {
  claimTypes: readonly ClaimType[];
  topics: readonly Topic[];
}

const ALL_TYPES: readonly ClaimType[] = ["observation", "measurement", "interpretation", "hypothesis"];

/** Keyed by catalog id without the numeric prefix, so "26_lola_elevation_researcher" → "lola_elevation_researcher". */
export const AGENT_SCOPES: Readonly<Record<string, AgentScope>> = {
  // Coordinator routes and merges but never makes claims itself.
  observation_coordinator: { claimTypes: [], topics: [] },
  lunar_image_analyst: { claimTypes: ["observation"], topics: [] },
  video_frame_analyst: { claimTypes: ["observation"], topics: [] },
  visual_comparison_researcher: { claimTypes: ["observation"], topics: [] },
  lroc_imagery_researcher: { claimTypes: ["observation"], topics: [] },
  lola_elevation_researcher: { claimTypes: ["observation", "measurement"], topics: [] },
  lunar_geology_researcher: { claimTypes: ["observation", "interpretation", "hypothesis"], topics: ["formation", "age"] },
  impact_crater_researcher: { claimTypes: ["observation", "interpretation", "hypothesis"], topics: ["formation", "age"] },
  lunar_volcanism_researcher: { claimTypes: ["observation", "interpretation", "hypothesis"], topics: ["formation", "age"] },
  historical_observation_researcher: { claimTypes: ["observation", "interpretation"], topics: ["formation"] },
  hypothesis_generator: { claimTypes: ["hypothesis"], topics: ["formation", "age"] },
  alternative_explanation_researcher: { claimTypes: ["interpretation", "hypothesis"], topics: ["formation", "age"] },
  contradiction_detection_agent: { claimTypes: ["interpretation"], topics: ["formation", "age"] },
  uncertainty_analyst: { claimTypes: ["interpretation"], topics: ["formation", "age"] },
  research_synthesis_specialist: { claimTypes: ALL_TYPES, topics: ["formation", "age"] },
};

export function scopeFor(agentId: string): AgentScope | undefined {
  return AGENT_SCOPES[agentId.replace(/^\d+_/, "")];
}

/** Topics that `text` touches. */
export function topicsOf(text: string): Topic[] {
  return (Object.keys(TOPIC_PATTERNS) as Topic[]).filter((t) => TOPIC_PATTERNS[t].test(text));
}
