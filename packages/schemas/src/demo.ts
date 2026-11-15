import { z } from "zod";
import { evidenceItem, measurementRecord } from "./evidence.js";
import { scientificFinding } from "./finding.js";
import { observation } from "./observation.js";

/**
 * Standalone demo bundle (ARCHITECTURE.md "Precomputed bundle shipped with the client"). Built by
 * `pnpm demo:bundle`, which replays data/precomputed through the real API and SIE, so every finding here carries the
 * SIE decision it was given. The XR client loads it when no NEXUS service is reachable, e.g. on a static HTTPS host.
 */
export const demoSite = z.object({
  siteId: z.string().min(1),
  featureId: z.string().min(1),
  /** The research team routing chose for this feature, in dispatch order. */
  agentIds: z.array(z.string().min(1)).min(1),
  observation,
  finding: scientificFinding,
  evidence: z.object({ items: z.array(evidenceItem), measurements: z.array(measurementRecord) }),
});
export type DemoSite = z.infer<typeof demoSite>;

export const demoBundle = z.object({
  /** Says plainly what this is wherever it is shown (AGENTS.md rule 7). */
  kind: z.literal("nexus-precomputed-demo"),
  note: z.string().min(1),
  sites: z.array(demoSite).min(1),
});
export type DemoBundle = z.infer<typeof demoBundle>;
