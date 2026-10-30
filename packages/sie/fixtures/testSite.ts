// Test-only evidence for SIE fixtures. Not real products: ids say TEST and URLs point at example.org,
// so nothing here can be mistaken for curated evidence (AGENTS.md rule 3).
import type { AgentOutput, EvidenceItem, FindingDraft, MeasurementRecord, Observation } from "@nexus/schemas";
import { createContext } from "../src/context.js";

const item = (id: string, type: EvidenceItem["type"], title: string): EvidenceItem => ({
  id,
  siteId: "TEST_SITE",
  type,
  title,
  spokenLabel: title,
  dataset: type === "dataset" ? "TEST DEM" : undefined,
  sourceUrl: `https://example.org/test/${id}`,
  credit: "test fixture",
  license: "test fixture",
});

export const evidence: EvidenceItem[] = [
  item("EV-TEST-001", "dataset", "test elevation data"),
  item("EV-TEST-002", "image", "test image"),
  item("EV-TEST-003", "text", "test excerpt supporting a channel origin"),
  item("EV-TEST-004", "text", "test excerpt describing a different origin"),
];

const meas = (feature: string, quantity: MeasurementRecord["quantity"], value: number, unit: MeasurementRecord["unit"]): MeasurementRecord => ({
  id: `MEAS-TEST_SITE-${feature}-${quantity.toUpperCase()}`,
  siteId: "TEST_SITE",
  featureId: feature,
  quantity,
  value,
  unit,
  method: "synthetic fixture",
  sourceEvidenceId: "EV-TEST-001",
  computedAt: "2026-10-30T12:00:00Z",
});

export const measurements: MeasurementRecord[] = [
  meas("TEST_CRATER", "depth", 100, "m"),
  meas("TEST_CRATER", "diameter", 1000, "m"),
  meas("TEST_RILLE", "width", 400, "m"),
  meas("TEST_RILLE", "length", 2.5, "km"),
];

export const DEPTH = "MEAS-TEST_SITE-TEST_CRATER-DEPTH";
export const WIDTH = "MEAS-TEST_SITE-TEST_RILLE-WIDTH";

export const ctx = createContext("TEST_SITE", evidence, measurements);

export const observation: Observation = {
  id: "OBS-TEST-0001",
  siteId: "TEST_SITE",
  source: "hand_select",
  featureId: "TEST_RILLE",
  spatialAnchor: { terrainFeatureId: "TEST_RILLE", sceneLocal: { x: 500, y: 0, z: 500 } },
  createdBy: "user-test",
  createdAt: "2026-10-30T12:00:00Z",
};

export const lolaOutput: AgentOutput = {
  agentId: "26_lola_elevation_researcher",
  observationId: observation.id,
  claims: [
    { text: "The test DEM gives a channel width of about 400 m.", claimType: "measurement", evidenceIds: ["EV-TEST-001"], measurementIds: [WIDTH] },
  ],
};

export const imageryOutput: AgentOutput = {
  agentId: "25_lroc_imagery_researcher",
  observationId: observation.id,
  claims: [{ text: "The image shows a sinuous channel with a raised rim.", claimType: "observation", evidenceIds: ["EV-TEST-002"] }],
};

export const geologyOutput: AgentOutput = {
  agentId: "11_lunar_geology_researcher",
  observationId: observation.id,
  claims: [
    {
      text: "The channel shape is consistent with a lava channel origin.",
      claimType: "interpretation",
      evidenceIds: ["EV-TEST-003"],
    },
  ],
};

export const draft: FindingDraft = {
  title: "Test channel",
  summary: "The test DEM gives a channel width of about 400 m. The shape is consistent with a lava channel.",
  claimType: "interpretation",
  possibleInterpretations: [],
  uncertainty: { level: "medium", explanation: "single cross-section" },
};

export const NOW = "2026-10-30T12:00:00Z";
