import { describe, expect, it } from "vitest";
import type { ScientificFinding, TerrainFeature } from "@nexus/schemas";
import { resample, toPcm16 } from "./audio/pcm.js";
import { PokeTracker } from "./input/poke.js";
import { distanceToFeature, featureCenter, pickFeature } from "./scene/featurePick.js";
import { sceneToTile, tileFrame, tileToScene } from "./scene/tabletop.js";
import { agentName, cardModel, ringFor } from "./ui/findingView.js";
import { wrapText } from "./ui/textLayout.js";

const base = { siteId: "TEST_SITE", label: "x", spokenLabel: "x", aliases: [] };
const crater: TerrainFeature = { ...base, id: "TEST_CRATER", kind: "crater", center: { x: 500, z: 500 }, rimRadiusM: 100 };
const rille: TerrainFeature = {
  ...base,
  id: "TEST_RILLE",
  kind: "rille",
  path: [
    { x: 0, z: 0 },
    { x: 1000, z: 0 },
  ],
  crossSections: [
    [
      { x: 500, z: -50 },
      { x: 500, z: 50 },
    ],
  ],
};

describe("tabletop mapping", () => {
  const f = tileFrame(2000, 1000, -1500);
  it("puts the tile centre at the table centre and keeps vertical scale true", () => {
    expect(tileToScene(f, { x: 1000, y: -1500, z: 500 })).toEqual(f.center);
    const up = tileToScene(f, { x: 1000, y: -1400, z: 500 });
    expect(up.y - f.center.y).toBeCloseTo(100 * f.scale, 9);
    expect(f.scale).toBeCloseTo(0.8 / 2000, 12);
  });
  it("round-trips", () => {
    const p = { x: 123.4, y: -1432.1, z: 876.5 };
    const back = sceneToTile(f, tileToScene(f, p));
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
    expect(back.z).toBeCloseTo(p.z, 6);
  });
});

describe("feature picking", () => {
  it("measures distance to footprints", () => {
    expect(distanceToFeature(crater, { x: 550, z: 500 })).toBe(0);
    expect(distanceToFeature(crater, { x: 700, z: 500 })).toBe(100);
    expect(distanceToFeature(rille, { x: 400, z: 30 })).toBe(30);
    expect(distanceToFeature(rille, { x: 1100, z: 0 })).toBe(100);
  });
  it("picks the nearest feature within tolerance, else nothing", () => {
    expect(pickFeature([rille, crater], { x: 500, z: 390 }, 120)?.id).toBe("TEST_CRATER");
    expect(pickFeature([rille, crater], { x: 500, z: 20 }, 120)?.id).toBe("TEST_RILLE");
    expect(pickFeature([rille, crater], { x: 1500, z: 900 }, 120)).toBeUndefined();
  });
  it("anchors a rille on its middle vertex", () => {
    expect(featureCenter(rille)).toEqual({ x: 1000, z: 0 });
  });
});

describe("poke", () => {
  const buttons = [{ id: "ok", rect: { x: 0, y: 0, w: 0.05, h: 0.04 } }];
  it("presses once when the fingertip crosses the face from the front, and releases on pull-back", () => {
    const t = new PokeTracker();
    expect(t.update({ x: 0.02, y: 0.02, z: 0.05 }, buttons)).toBeUndefined();
    expect(t.update({ x: 0.02, y: 0.02, z: 0.004 }, buttons)).toEqual({ kind: "press", id: "ok" });
    expect(t.update({ x: 0.02, y: 0.02, z: -0.01 }, buttons)).toBeUndefined();
    expect(t.update({ x: 0.02, y: 0.02, z: 0.015 }, buttons)).toBeUndefined(); // hysteresis
    expect(t.update({ x: 0.02, y: 0.02, z: 0.03 }, buttons)).toEqual({ kind: "release", id: "ok" });
  });
  it("ignores a hand that arrives from behind or beside the panel", () => {
    const t = new PokeTracker();
    expect(t.update({ x: 0.02, y: 0.02, z: -0.03 }, buttons)).toBeUndefined();
    expect(t.update({ x: 0.02, y: 0.02, z: 0.0 }, buttons)).toBeUndefined();
    const side = new PokeTracker();
    side.update({ x: 0.2, y: 0.02, z: 0.05 }, buttons);
    side.update({ x: 0.2, y: 0.02, z: 0.0 }, buttons);
    expect(side.update({ x: 0.02, y: 0.02, z: 0.0 }, buttons)).toBeUndefined();
  });
  it("releases when tracking is lost mid-press (push-to-talk never sticks on)", () => {
    const t = new PokeTracker();
    t.update({ x: 0.02, y: 0.02, z: 0.05 }, buttons);
    t.update({ x: 0.02, y: 0.02, z: 0.0 }, buttons);
    expect(t.update(undefined, buttons)).toEqual({ kind: "release", id: "ok" });
  });
});

describe("pcm", () => {
  it("resamples 48 kHz to 16 kHz and encodes little-endian int16 with clipping", () => {
    expect(resample(new Float32Array(480), 48000, 16000)).toHaveLength(160);
    const bytes = toPcm16(Float32Array.from([0, 1, -1, 2]));
    const v = new DataView(bytes.buffer);
    expect([v.getInt16(0, true), v.getInt16(2, true), v.getInt16(4, true), v.getInt16(6, true)]).toEqual([0, 32767, -32768, 32767]);
  });
});

const finding: ScientificFinding = {
  id: "FND-1",
  observationId: "OBS-1",
  title: "Test rille cross-section",
  summary: "Test summary.",
  claimType: "measurement",
  claims: [{ text: "Depth is about 30 m.", claimType: "measurement", evidenceIds: ["EV-TEST-001"] }],
  removedClaims: [{ text: "A dropped claim.", reason: "no evidence" }],
  possibleInterpretations: [],
  sources: [{ dataset: "Test DTM", sourceUrl: "https://example.org/dtm", evidenceId: "EV-TEST-001" }],
  spatialAnchor: { terrainFeatureId: "TEST_RILLE" },
  uncertainty: { level: "medium", explanation: "Test." },
  contested: false,
  decision: { outcome: "ACCEPT_FOR_REVIEW", reason: "ok", source: "fallback" },
  status: "ready_for_review",
  spokenBriefing: { script: "Overall uncertainty is medium.", sentenceEvidence: [[]], voiceDecision: "SPEAK_AS_APPROVED", speakerAgentId: "25_lroc_imagery_researcher" },
  createdAt: "2026-10-30T12:00:00.000Z",
  updatedAt: "2026-10-30T12:00:00.000Z",
};

describe("finding card", () => {
  it("shows typed claims, uncertainty and removed claims, and offers review only while awaiting it", () => {
    const card = cardModel(finding);
    expect(card.lines.find((l) => l.badge === "Measurement")?.text).toBe("Depth is about 30 m.");
    expect(card.lines.some((l) => l.text === "Removed: no evidence. A dropped claim.")).toBe(true);
    expect(card.lines.some((l) => l.text.startsWith("Uncertainty medium"))).toBe(true);
    expect(card).toMatchObject({ reviewable: true, speakable: true, ring: "ready" });
    expect(cardModel({ ...finding, status: "reviewed" })).toMatchObject({ reviewable: false, ring: "reviewed" });
    expect(cardModel({ ...finding, spokenBriefing: { script: "", sentenceEvidence: [], speakerAgentId: "x", voiceDecision: "SILENT_CARD_ONLY" } }).speakable).toBe(false);
  });
  it("never uses certainty words in its own labels (AGENTS.md §10)", () => {
    for (const status of ["researching", "ready_for_review", "reviewed", "rejected", "inconclusive"] as const) {
      const text = cardModel({ ...finding, status, claims: [], removedClaims: [], summary: "" })
        .lines.map((l) => `${l.badge ?? ""} ${l.text}`)
        .join(" ");
      expect(text).not.toMatch(/\b(prov(e|es|ed|en|ing)|proof|confirm(s|ed|ing)?|discover(s|ed|y)?)\b/i);
    }
  });
  it("maps a request for more evidence to the dashed-amber state", () => {
    expect(ringFor({ status: "researching", decision: { ...finding.decision, outcome: "REQUEST_MORE_EVIDENCE" } })).toBe("needs_evidence");
  });
});

describe("labels", () => {
  it("wraps text greedily and names agents readably", () => {
    expect(wrapText("one two three four", 9, (s) => s.length)).toEqual(["one two", "three", "four"]);
    expect(agentName("26_lola_elevation_researcher")).toBe("LOLA elevation researcher");
  });
});
