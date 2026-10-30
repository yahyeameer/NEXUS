// Planted bad claims that the SIE must catch (SCIENTIFIC_INTEGRITY.md §7). Every case here must stay green.
import { describe, expect, it } from "vitest";
import type { AgentOutput } from "@nexus/schemas";
import { evaluateDebateTurn, evaluateFinding, evaluateScript } from "../src/index.js";
import { DEPTH, NOW, WIDTH, ctx, draft, geologyOutput, imageryOutput, lolaOutput, observation } from "../fixtures/testSite.js";

const support = [lolaOutput, imageryOutput];
const claims = [...lolaOutput.claims, ...imageryOutput.claims, ...geologyOutput.claims];

async function run(planted: unknown, extra: Partial<Parameters<typeof evaluateFinding>[0]> = {}) {
  return evaluateFinding({ observation, agentOutputs: [...support, planted], draft, ...extra }, ctx, undefined, NOW);
}

function script(text: string, sentenceEvidence: string[][], extra = {}) {
  return evaluateScript({ scriptId: "RT", script: text, sentenceEvidence, claims, uncertainty: "medium", ...extra }, ctx, NOW);
}

describe("SIE red-team", () => {
  it("removes a claim citing a fake evidence ID (EV-9999)", async () => {
    const planted: AgentOutput = {
      agentId: "25_lroc_imagery_researcher",
      observationId: observation.id,
      claims: [{ text: "The image shows boulders on the floor.", claimType: "observation", evidenceIds: ["EV-9999"] }],
    };
    const r = await run(planted);
    expect(r.removedClaims).toContainEqual({ text: "The image shows boulders on the floor.", reason: "no evidence" });
    expect(r.claims.map((c) => c.text)).not.toContain("The image shows boulders on the floor.");
  });

  it("removes a number off by 20 % from its measurement", async () => {
    const planted: AgentOutput = {
      agentId: "26_lola_elevation_researcher",
      observationId: observation.id,
      claims: [{ text: "The crater is about 120 m deep.", claimType: "measurement", evidenceIds: ["EV-TEST-001"], measurementIds: [DEPTH] }],
    };
    expect((await run(planted)).removedClaims).toContainEqual({ text: "The crater is about 120 m deep.", reason: "number does not match a measurement" });
  });

  it("removes a hypothesis stated as fact", async () => {
    const planted: AgentOutput = {
      agentId: "33_hypothesis_generator",
      observationId: observation.id,
      claims: [{ text: "This rille is a collapsed lava tube.", claimType: "hypothesis", evidenceIds: ["EV-TEST-003"] }],
    };
    const r = await run(planted);
    expect(r.removedClaims.map((c) => c.text)).toContain("This rille is a collapsed lava tube.");
  });

  it('refuses to speak a script saying "proves"', () => {
    const r = script("The image shows a channel. This proves it was a lava channel. Uncertainty is medium.", [["EV-TEST-002"], ["EV-TEST-003"], []]);
    expect(r.decision).not.toBe("SPEAK_AS_APPROVED");
    expect(r.issues.some((i) => i.validator === "VV1")).toBe(true);
  });

  it("removes an imagery agent claiming mineral composition", async () => {
    const planted: AgentOutput = {
      agentId: "25_lroc_imagery_researcher",
      observationId: observation.id,
      claims: [{ text: "The image shows ilmenite-rich basalt on the rim.", claimType: "observation", evidenceIds: ["EV-TEST-002"] }],
    };
    expect((await run(planted)).removedClaims).toContainEqual({ text: "The image shows ilmenite-rich basalt on the rim.", reason: "outside the agent's scope" });
  });

  it("rejects an agent setting status: reviewed, without retry", async () => {
    const planted = { ...imageryOutput, status: "reviewed" };
    const r = await run(planted);
    expect(r.rejectedOutputs).toContainEqual(expect.objectContaining({ index: 2, retryable: false }));
    expect(r.issues.some((i) => i.validator === "V9")).toBe(true);
    expect(r.status).not.toBe("reviewed");
  });

  it("strips precise lat/lon from a video frame with no localisation metadata", async () => {
    const frameObs = {
      ...observation,
      source: "video_mark" as const,
      frameRef: { videoId: "VID-TEST", timestampMs: 1000, imageUrl: "https://example.org/test/frame.jpg" },
      spatialAnchor: { latitude: 26.1, longitude: 3.6, coordinateReferenceSystem: "TEST_LOCAL", terrainFeatureId: "TEST_RILLE" },
    };
    const planted: AgentOutput = {
      agentId: "25_lroc_imagery_researcher",
      observationId: observation.id,
      claims: [{ text: "The frame shows the channel at 26.1° N, 3.6° E.", claimType: "observation", evidenceIds: ["EV-TEST-002"] }],
    };
    const r = await run(planted, { observation: frameObs });
    expect(r.spatialAnchor).toEqual({ terrainFeatureId: "TEST_RILLE", sceneLocal: undefined });
    expect(r.claims.map((c) => c.text)).not.toContain("The frame shows the channel at 26.1° N, 3.6° E.");
  });

  it("flags contradicting evidence omitted from the summary and escalates", async () => {
    const skeptic: AgentOutput = {
      agentId: "34_alternative_explanation_researcher",
      observationId: observation.id,
      claims: [
        {
          text: "The channel may instead follow a fault.",
          claimType: "hypothesis",
          evidenceIds: ["EV-TEST-004"],
          contradictingEvidenceIds: ["EV-TEST-003"],
        },
      ],
    };
    const r = await evaluateFinding({ observation, agentOutputs: [...support, geologyOutput, skeptic], draft }, ctx, undefined, NOW);
    expect(r.contested).toBe(true);
    expect(r.issues.some((i) => i.validator === "V6" && i.message.includes("summary"))).toBe(true);
    expect(r.decision.outcome).toBe("ESCALATE_TO_SCIENTIST");
  });

  it("refuses speculation the user did not ask for", () => {
    const r = script("The image shows a channel. I think it probably drained a lava lake. Uncertainty is medium.", [["EV-TEST-002"], ["EV-TEST-003"], []]);
    expect(r.issues.map((i) => i.message)).toContain("speculation spoken without the user asking");
    expect(r.decision).not.toBe("SPEAK_AS_APPROVED");
  });

  it("removes an uncited debate turn", () => {
    const r = evaluateDebateTurn({ turnId: "T1", speakerAgentId: "33_hypothesis_generator", text: "It could be a lava channel.", evidenceIds: [] }, ctx, NOW);
    expect(r.outcome).toBe("REMOVE");
  });

  // Extra plants beyond the §7 list.
  it("refuses a spoken number that is not a measurement", () => {
    const r = script("The test DEM gives about 520 metres of width. Uncertainty is medium.", [[WIDTH], []]);
    expect(r.issues.some((i) => i.validator === "VV2")).toBe(true);
  });

  it("refuses a spelled-out measurement that cannot be checked", () => {
    const r = script("The test DEM gives about five hundred metres of width. Uncertainty is medium.", [[WIDTH], []]);
    expect(r.issues.some((i) => i.validator === "VV2")).toBe(true);
  });

  it("refuses observation framing for evidence that only supports an interpretation", () => {
    const r = script("The image shows a lava channel. Uncertainty is medium.", [["EV-TEST-003"], []]);
    expect(r.decision).not.toBe("SPEAK_AS_APPROVED");
  });

  it("refuses an unmapped claim sentence", () => {
    const r = script("The channel is a lava channel. Uncertainty is medium.", [[], []]);
    expect(r.issues.some((i) => i.validator === "VV3")).toBe(true);
  });

  it("rejects a finding whose only claims come from the coordinator", async () => {
    const coordinator: AgentOutput = {
      agentId: "1_observation_coordinator",
      observationId: observation.id,
      claims: [{ text: "The image shows a channel.", claimType: "observation", evidenceIds: ["EV-TEST-002"] }],
    };
    const r = await evaluateFinding({ observation, agentOutputs: [coordinator], draft }, ctx, undefined, NOW);
    expect(r.decision.outcome).toBe("REJECT");
  });
});
