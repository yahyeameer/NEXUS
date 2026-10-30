import { describe, expect, it } from "vitest";
import type { CandidateFeature, PointerSample, WordTiming } from "./index.js";
import { extractDescriptors, isSystemPhrase, resolveClarification, resolveReference, routeIntent, voiceFor } from "./index.js";

const sites = [
  { siteId: "TEST_RILLE_SITE", names: ["test rille", "the rille"] },
  { siteId: "TEST_CRATER_SITE", names: ["test crater"] },
];

describe("routeIntent", () => {
  it.each([
    ["Zoom in.", { kind: "zoom", direction: "in" }],
    ["NEXUS, rotate left", { kind: "rotate", direction: "left" }],
    ["show sources", { kind: "show", what: "sources" }],
    ["Read it to me", { kind: "read_it" }],
    ["Stop!", { kind: "stop" }],
    ["Where does that come from?", { kind: "provenance" }],
    ["go to the rille", { kind: "go_to", siteId: "TEST_RILLE_SITE" }],
    ["investigate this", { kind: "investigate", target: "this" }],
    ["Investigate test crater", { kind: "investigate", target: { siteId: "TEST_CRATER_SITE" } }],
    ["whisper mode on", { kind: "whisper", on: true }],
    ["mark this", { kind: "mark" }],
  ])("%s → command", (said, command) => {
    expect(routeIntent(said, { sites })).toEqual({ intent: "command", command });
  });

  it("keeps the review reason verbatim", () => {
    expect(routeIntent("Reject because the rim is too degraded, honestly.", { sites })).toEqual({
      intent: "review",
      decision: "rejected",
      rationaleText: "the rim is too degraded, honestly.",
    });
    expect(routeIntent("approve", { sites })).toEqual({ intent: "review", decision: "approved", rationaleText: undefined });
  });

  it("routes notes, questions, debate and clarifications", () => {
    expect(routeIntent("Note: boulders on the east rim", { sites })).toEqual({ intent: "field_note", text: "boulders on the east rim" });
    expect(routeIntent("What contradicts this?", { sites })).toEqual({ intent: "question", text: "What contradicts this?" });
    expect(routeIntent("debate this", { sites })).toEqual({ intent: "debate" });
    expect(routeIntent("the rim", { sites, pendingClarification: true })).toEqual({ intent: "clarification", answer: "the rim" });
    expect(routeIntent("Boulder field here, angular", { sites, pointing: true })).toEqual({ intent: "field_note", text: "Boulder field here, angular" });
    expect(routeIntent("Boulder field here, angular", { sites }).intent).toBe("unknown");
  });
});

describe("resolveReference", () => {
  const forward = { x: 0, y: 0, z: -1 };
  const head = { x: 0, y: 1.2, z: 0 };
  const rim: CandidateFeature = { id: "RIM", spokenLabel: "the crater rim", aliases: ["rim"], position: { x: -0.3, y: 0.8, z: -0.6 }, size: 0.8 };
  const boulder: CandidateFeature = { id: "BOULDER", spokenLabel: "the boulder", aliases: [], position: { x: 0.3, y: 0.8, z: -0.6 }, size: 0.2 };
  const words: WordTiming[] = [
    { text: "boulders", startMs: 0, endMs: 300 },
    { text: "here", startMs: 400, endMs: 600 },
  ];
  const sample = (tMs: number, over: Partial<PointerSample> = {}): PointerSample => ({ tMs, onUi: false, headPosition: head, headDirection: forward, ...over });

  it("resolves from the ray at the deictic word", () => {
    const samples = [0, 33, 300, 400, 433, 466, 500, 533, 566, 600, 700].map((t) =>
      sample(t, t >= 300 ? { rayFeatureId: "BOULDER", rayPoint: boulder.position } : { rayFeatureId: "RIM", rayPoint: rim.position }),
    );
    const r = resolveReference(words, samples, [rim, boulder]);
    expect(r.status).toBe("resolved");
    if (r.status === "resolved") {
      expect(r.featureId).toBe("BOULDER");
      expect(r.confidence).toBeGreaterThanOrEqual(0.75);
      expect(r.point?.x).toBeCloseTo(boulder.position.x);
      expect(r.point?.y).toBeCloseTo(boulder.position.y);
    }
  });

  it("asks when the ray is split between two features", () => {
    const samples = [400, 433, 466, 500, 533, 566].map((t, i) =>
      sample(t, i % 2 ? { rayFeatureId: "RIM", rayPoint: rim.position } : { rayFeatureId: "BOULDER", rayPoint: boulder.position }),
    );
    const r = resolveReference(words, samples, [rim, boulder]);
    expect(r.status).toBe("clarify");
    if (r.status === "clarify") expect(r.candidates.map((c) => c.featureId).sort()).toEqual(["BOULDER", "RIM"]);
  });

  it("never resolves silently from head direction alone", () => {
    const samples = [400, 500, 600].map((t) => sample(t, { onUi: true, headDirection: { x: 0.3, y: -0.4, z: -0.6 } }));
    expect(resolveReference(words, samples, [rim, boulder]).status).not.toBe("resolved");
  });

  it("uses a left/right qualifier to break a tie", () => {
    const w: WordTiming[] = [{ text: "that", startMs: 0, endMs: 200 }, { text: "left", startMs: 300, endMs: 500 }, { text: "one", startMs: 500, endMs: 600 }];
    const samples = [0, 50, 100, 150, 200].map((t, i) =>
      sample(t, { rayFeatureId: i % 2 ? "RIM" : "BOULDER", rayPoint: { x: 0, y: 0.8, z: -0.6 } }),
    );
    const r = resolveReference(w, samples, [rim, boulder]);
    expect(r.status === "resolved" && r.featureId).toBe("RIM");
    expect(r.status === "resolved" && r.method).toBe("ray+gaze+qualifier");
  });

  it("returns none without a deictic word or a name", () => {
    expect(resolveReference([{ text: "zoom", startMs: 0, endMs: 100 }], [], [rim]).status).toBe("none");
  });

  it("resolves a spoken clarification by name", () => {
    expect(resolveClarification("the rim", [rim, boulder])).toBe("RIM");
    expect(resolveClarification("the other one", [rim, boulder])).toBeUndefined();
  });
});

describe("extractDescriptors", () => {
  it("keeps only words the scientist said, in order (PRD §6.2 example)", () => {
    expect(extractDescriptors("Boulder field on the east rim, some blocks look angular.")).toEqual([
      "boulder field",
      "east rim",
      "blocks",
      "angular",
    ]);
  });
});

describe("voiceFor", () => {
  it("maps agents to spatial voices and falls back to the narrator", () => {
    expect(voiceFor("agent:26_lola_elevation_researcher")).toEqual({ voice: "voiceA", placement: "feature_floor" });
    expect(voiceFor("agent:34_alternative_explanation_researcher").voice).toBe("voiceD");
    expect(voiceFor("agent:99_unknown").voice).toBe("narrator");
  });
});

describe("system phrases", () => {
  it("recognises exact phrases only", () => {
    expect(isSystemPhrase("Listening.")).toBe(true);
    expect(isSystemPhrase("Listening. The crater is 100 m deep.")).toBe(false);
  });
});
