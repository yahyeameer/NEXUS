// The committed demo bundle must be exactly what the SIE produces today, so the offline build never shows a claim the
// integrity engine did not pass (AGENTS.md rule 2). Run `pnpm demo:bundle` after changing research, evidence or the SIE.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { demoBundle } from "@nexus/schemas";
import { buildDemoBundle } from "./demoBundle.js";

const DATA = fileURLToPath(new URL("../../../data", import.meta.url));

describe("standalone demo bundle", () => {
  it("is up to date with the precomputed research and the SIE", async () => {
    const built = await buildDemoBundle(DATA);
    if (!built.ok) throw new Error(built.error);
    const committed = demoBundle.parse(JSON.parse(await readFile(`${DATA}/demo/bundle.json`, "utf8")));
    expect(committed).toEqual(built.value);
  });

  it("holds only findings passed for review, with SIE-approved speech and real evidence IDs", async () => {
    const bundle = demoBundle.parse(JSON.parse(await readFile(`${DATA}/demo/bundle.json`, "utf8")));
    expect(bundle.sites.map((s) => s.siteId)).toEqual(["HADLEY_RILLE", "ELBOW_CRATER", "HADLEY_DELTA"]);
    for (const s of bundle.sites) {
      expect(s.finding.status).toBe("ready_for_review");
      expect(s.finding.decision.outcome).toBe("ACCEPT_FOR_REVIEW");
      expect(s.finding.review).toBeUndefined();
      expect(s.finding.spokenBriefing?.voiceDecision).toBe("SPEAK_AS_APPROVED");
      const known = new Set([...s.evidence.items.map((i) => i.id), ...s.evidence.measurements.map((m) => m.id)]);
      for (const c of s.finding.claims) for (const id of [...c.evidenceIds, ...(c.measurementIds ?? [])]) expect(known).toContain(id);
    }
  });
});
