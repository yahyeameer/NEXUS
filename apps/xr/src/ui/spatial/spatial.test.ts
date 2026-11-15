import { describe, expect, it } from "vitest";
import type { EvidenceItem, MeasurementRecord, TerrainFeature } from "@nexus/schemas";
import { agentActivityLines } from "./agentActivityPanel.js";
import { decisionControls, DECISIONS } from "./decisionControls.js";
import { evidenceContent } from "./evidenceViewer.js";
import { outlinePath } from "./rockSelectionOutline.js";
import { arcPoint } from "./spatialConnector.js";
import { statusLabel } from "./statusIndicator.js";
import { voiceLines } from "./voicePanel.js";

const FORBIDDEN = /\b(confirmed|discovered|proven)\b/i;
const base = { siteId: "TEST_SITE", label: "x", spokenLabel: "x", aliases: [] };

describe("SpatialConnector arc", () => {
  it("starts and ends at its endpoints and lifts its midpoint", () => {
    const a = { x: 0, y: 1, z: 0 };
    const b = { x: 1, y: 1, z: -1 };
    const out = { x: 0, y: 0, z: 0 };
    expect(arcPoint(a, b, 0.1, 0, out)).toEqual(a);
    expect(arcPoint(a, b, 0.1, 1, out)).toEqual(b);
    const mid = arcPoint(a, b, 0.1, 0.5, out);
    expect(mid.x).toBeCloseTo(0.5);
    expect(mid.y).toBeCloseTo(1.05);
  });
});

describe("RockSelectionOutline footprint", () => {
  it("rings a crater at its rim radius", () => {
    const crater: TerrainFeature = { ...base, id: "C", kind: "crater", center: { x: 500, z: 400 }, rimRadiusM: 100 };
    const { points, closed } = outlinePath(crater, 36);
    expect(closed).toBe(true);
    expect(points).toHaveLength(36);
    for (const p of points) expect(Math.hypot(p.x - 500, p.z - 400)).toBeCloseTo(100);
  });

  it("follows a rille's course, densified, from first to last vertex", () => {
    const rille: TerrainFeature = { ...base, id: "R", kind: "rille", path: [{ x: 0, z: 0 }, { x: 1000, z: 0 }], crossSections: [] };
    const { points, closed } = outlinePath(rille);
    expect(closed).toBe(false);
    expect(points.length).toBeGreaterThan(20);
    expect(points[0]).toEqual({ x: 0, z: 0 });
    expect(points[points.length - 1]).toEqual({ x: 1000, z: 0 });
  });
});

describe("ScientificDecisionControls", () => {
  it("offers the decision row only while the finding awaits review", () => {
    expect(decisionControls({ reviewable: true, speakable: false }, false)).toHaveLength(2);
    expect(decisionControls({ reviewable: false, speakable: false }, false)).toHaveLength(1);
  });

  it("offers Hear it only for an SIE-approved briefing", () => {
    const ids = (speakable: boolean) => decisionControls({ reviewable: false, speakable }, false)[0]?.map((b) => b.id);
    expect(ids(true)).toContain("card:hear");
    expect(ids(false)).not.toContain("card:hear");
  });

  it("never uses forbidden words", () => {
    const labels = [...DECISIONS, ...decisionControls({ reviewable: true, speakable: true }, true).flat()].map((b) => b.label);
    for (const l of labels) expect(l).not.toMatch(FORBIDDEN);
  });
});

describe("ResearchStatusIndicator words", () => {
  it("never claims a result the scientist did not give", () => {
    for (const s of ["observed", "researching", "needs_evidence", "ready", "reviewed", "closed"] as const) expect(statusLabel(s)).not.toMatch(FORBIDDEN);
    expect(statusLabel("reviewed")).toMatch(/you/);
  });
});

describe("AgentActivityPanel lines", () => {
  it("lists each agent with its state", () => {
    const lines = agentActivityLines(new Map([["25_lroc_imagery_researcher", "working"], ["30_terrain_analyst", "failed"]]));
    expect(lines[1]).toMatchObject({ text: "0 of 2 agents done" });
    expect(lines[2]).toMatchObject({ text: "LROC imagery researcher", badge: "Working" });
    expect(lines[3]).toMatchObject({ tone: "warn", badge: "Stopped" });
  });
});

describe("AgentActivityPanel size", () => {
  it("names at most four agents and sums up the rest", () => {
    const many = new Map(Array.from({ length: 7 }, (_, i) => [`${i}_agent_${i}`, i < 2 ? ("done" as const) : ("working" as const)]));
    const lines = agentActivityLines(many);
    expect(lines).toHaveLength(2 + 4 + 1);
    expect(lines[1]?.text).toBe("2 of 7 agents done");
    expect(lines[lines.length - 1]?.text).toBe("+3 more");
  });
});

describe("EvidenceViewer content", () => {
  const item = {
    id: "EV-1",
    type: "image",
    title: "Orthophoto",
    spokenLabel: "the orthophoto",
    dataset: "LROC NAC",
    acquiredAt: "2010-01-02T00:00:00Z",
    credit: "NASA/GSFC/ASU",
    license: "Public domain",
    sourceUrl: "https://example.invalid/ev-1",
  } as unknown as EvidenceItem;
  const measurement = { id: "MEAS-1", quantity: "depth", value: 300, unit: "m", method: "DEM profile", sourceEvidenceId: "EV-1" } as unknown as MeasurementRecord;

  it("labels archival data as not live", () => {
    const c = evidenceContent("EV-1", [item], []);
    expect(c.lines.some((l) => /Archival data, not live/.test(l.text))).toBe(true);
  });

  it("says measurements come from code, not a model", () => {
    const c = evidenceContent("MEAS-1", [], [measurement]);
    expect(c.lines[0]?.text).toBe("depth: 300 m");
    expect(c.lines.some((l) => /deterministic code/.test(l.text))).toBe(true);
  });

  it("says so when the evidence is not in the store, rather than inventing it", () => {
    const c = evidenceContent("EV-404", [item], [measurement]);
    expect(c.lines[1]).toMatchObject({ tone: "warn" });
  });
});

describe("VoicePanel lines", () => {
  it("names the state, then the newest caption above the one before it", () => {
    expect(voiceLines("idle", undefined, [])).toEqual([
      { text: "VOICE · hold to talk on the wrist menu", tone: "muted" },
      { text: "Captions appear here.", tone: "muted" },
    ]);
    expect(voiceLines("listening", undefined, ["a", "b", "c"]).map((l) => l.text)).toEqual(["LISTENING · release to send", "c", "b"]);
    expect(voiceLines("speaking", "LROC imagery researcher", ["You: hi", "LROC imagery researcher: I investigated"])[0]).toEqual({
      text: "LROC IMAGERY RESEARCHER · SPEAKING",
      tone: "title",
    });
  });

  it("adds no words of its own beyond the state label and never claims a result", () => {
    for (const mode of ["idle", "listening", "speaking"] as const) {
      const text = voiceLines(mode, "Narrator", []).map((l) => l.text).join(" ");
      expect(text).not.toMatch(FORBIDDEN);
    }
  });
});
