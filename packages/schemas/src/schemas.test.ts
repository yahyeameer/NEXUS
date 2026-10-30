import { describe, expect, it } from "vitest";
import { agentOutput, evidenceItem, spatialAnchor, voiceUtterance } from "./index.js";

describe("spatialAnchor", () => {
  it("requires a CRS when coordinates are present", () => {
    expect(spatialAnchor.safeParse({ latitude: 26.1, longitude: 3.6 }).success).toBe(false);
    expect(spatialAnchor.safeParse({ terrainFeatureId: "TEST_FEATURE" }).success).toBe(true);
  });
});

describe("evidenceItem", () => {
  const base = {
    id: "EV-TEST-001",
    siteId: "TEST_SITE",
    type: "dataset",
    title: "test item",
    spokenLabel: "test item",
    sourceUrl: "https://example.org/item",
    credit: "test",
    license: "test",
  } as const;

  it("accepts a well-formed item", () => {
    expect(evidenceItem.safeParse(base).success).toBe(true);
  });

  it("rejects placeholder product IDs and URLs", () => {
    expect(evidenceItem.safeParse({ ...base, productId: "<exact product id>" }).success).toBe(false);
    expect(evidenceItem.safeParse({ ...base, sourceUrl: "<verified url>" }).success).toBe(false);
  });
});

describe("agentOutput", () => {
  it("rejects outputs that try to set a review status", () => {
    const out = { agentId: "25_lroc_imagery_researcher", observationId: "OBS-0001", claims: [], status: "reviewed" };
    expect(agentOutput.safeParse(out).success).toBe(false);
  });
});

describe("voiceUtterance", () => {
  const base = {
    id: "U-1",
    sessionId: "S-1",
    speaker: "narrator",
    direction: "out",
    transcript: "Listening",
    language: "en",
    createdAt: "2026-10-30T12:00:00Z",
  } as const;

  it("requires an SIE decision or a system phrase for outgoing speech", () => {
    expect(voiceUtterance.safeParse(base).success).toBe(false);
    expect(voiceUtterance.safeParse({ ...base, systemPhraseId: "listening" }).success).toBe(true);
  });
});
