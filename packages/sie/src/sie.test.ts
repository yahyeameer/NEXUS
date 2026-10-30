import { describe, expect, it } from "vitest";
import { sieDecisionRecord } from "@nexus/schemas";
import type { DecisionAdapter } from "./index.js";
import {
  decide,
  evaluateFinding,
  evaluateScript,
  extractNumbers,
  hashInput,
  referenceNeedsClarificationFallback,
  selectSpecialistsFallback,
  splitSentences,
  validateAttribution,
  validateReference,
} from "./index.js";
import { DEPTH, NOW, WIDTH, ctx, draft, geologyOutput, imageryOutput, lolaOutput, observation } from "../fixtures/testSite.js";

describe("extractNumbers", () => {
  it("reads units, skips identifiers, mission names and years", () => {
    const n = extractNumbers("Apollo 15 in 1971 saw EV-TEST-001 at 2.5 km and 400 m, slope 12°, about 7.");
    expect(n.map((x) => [x.value, x.unit])).toEqual([
      [2.5, "km"],
      [400, "m"],
      [12, "deg"],
      [7, null],
    ]);
  });

  it("splits sentences without breaking decimals", () => {
    expect(splitSentences("It is 2.5 km long. Uncertainty is low.")).toEqual(["It is 2.5 km long.", "Uncertainty is low."]);
  });
});

describe("evaluateFinding", () => {
  it("accepts a well-grounded finding for review, never as reviewed", async () => {
    const r = await evaluateFinding({ observation, agentOutputs: [lolaOutput, imageryOutput, geologyOutput], draft }, ctx, undefined, NOW);
    expect(r.issues).toEqual([]);
    expect(r.claims).toHaveLength(3);
    expect(r.decision).toEqual({ outcome: "ACCEPT_FOR_REVIEW", reason: "validated claims with sufficient evidence", source: "fallback" });
    expect(r.status).toBe("ready_for_review");
    expect(sieDecisionRecord.safeParse(r.audit).success).toBe(true);
  });

  it("asks for more evidence with a single claim", async () => {
    const r = await evaluateFinding({ observation, agentOutputs: [lolaOutput], draft: { ...draft, summary: "" } }, ctx, undefined, NOW);
    expect(r.decision.outcome).toBe("REQUEST_MORE_EVIDENCE");
    expect(r.status).toBe("researching");
  });

  it("accepts km for a record in km and m for the same length", async () => {
    const out = {
      ...lolaOutput,
      claims: [
        { text: "The channel is about 2500 m long.", claimType: "measurement" as const, evidenceIds: ["EV-TEST-001"], measurementIds: ["MEAS-TEST_SITE-TEST_RILLE-LENGTH"] },
      ],
    };
    const r = await evaluateFinding({ observation, agentOutputs: [out, imageryOutput], draft }, ctx, undefined, NOW);
    expect(r.removedClaims).toEqual([]);
  });

  it("uses Jev when it answers, and the fallback when it fails", async () => {
    const jev: DecisionAdapter = {
      selectSpecialists: async () => ({ ok: true, value: { value: [], requestId: "j1" } }),
      evidenceSufficient: async () => ({ ok: true, value: { value: true, requestId: "j2" } }),
      needsEscalation: async () => ({ ok: true, value: { value: false, requestId: "j3" } }),
      referenceNeedsClarification: async () => ({ ok: true, value: { value: false, requestId: "j4" } }),
    };
    const input = { observation, agentOutputs: [lolaOutput, imageryOutput], draft };
    const viaJev = await evaluateFinding(input, ctx, jev, NOW);
    expect(viaJev.decision.source).toBe("jev");
    expect(viaJev.audit.jevRequestIds).toEqual(["j2", "j3"]);

    const down: DecisionAdapter = { ...jev, evidenceSufficient: async () => ({ ok: false, error: "503" }) };
    expect((await evaluateFinding(input, ctx, down, NOW)).decision.source).toBe("fallback");
  });
});

describe("decide", () => {
  it("falls back on timeout and on answers outside policy", async () => {
    const slow = () => new Promise<never>(() => undefined);
    expect(await decide(slow, () => 1, undefined, 10)).toMatchObject({ value: 1, source: "fallback" });
    const bad = async () => ({ ok: true as const, value: { value: ["99_unknown"], requestId: "x" } });
    expect(await decide(bad, () => ["ok"], (v) => v.every((a) => a !== "99_unknown"))).toMatchObject({ value: ["ok"], source: "fallback" });
  });
});

describe("fallback policy", () => {
  it("keeps specialists inside the allowed list", () => {
    const picked = selectSpecialistsFallback({
      observationSource: "hand_select",
      featureKind: "rille",
      descriptors: [],
      allowed: ["26_lola_elevation_researcher", "33_hypothesis_generator"],
    });
    expect(picked).toEqual(["26_lola_elevation_researcher", "33_hypothesis_generator"]);
  });

  it("asks for clarification below 0.75 or when the top two are close", () => {
    expect(referenceNeedsClarificationFallback({ scores: [0.7] })).toBe(true);
    expect(referenceNeedsClarificationFallback({ scores: [0.9, 0.85] })).toBe(true);
    expect(referenceNeedsClarificationFallback({ scores: [0.9, 0.5] })).toBe(false);
  });
});

describe("evaluateScript", () => {
  const claims = [...lolaOutput.claims, ...imageryOutput.claims, ...geologyOutput.claims];
  const base = {
    scriptId: "SCRIPT-1",
    claims,
    uncertainty: "medium" as const,
  };

  it("approves a script that follows the Epistemic Voice Policy", () => {
    const r = evaluateScript(
      {
        ...base,
        script:
          "I investigated the test channel. The image shows a sinuous channel with a raised rim. The test DEM gives about 400 metres of width. This is consistent with a lava channel. Overall uncertainty is medium.",
        sentenceEvidence: [[], ["EV-TEST-002"], [WIDTH], ["EV-TEST-003"], []],
      },
      ctx,
      NOW,
    );
    expect(r.issues).toEqual([]);
    expect(r.decision).toBe("SPEAK_AS_APPROVED");
  });

  it("rewrites once, then goes silent", () => {
    const bad = { ...base, script: "The image shows a 300 m deep crater. Uncertainty is medium.", sentenceEvidence: [["EV-TEST-002", DEPTH], []] };
    expect(evaluateScript(bad, ctx, NOW).decision).toBe("REWRITE_SCRIPT");
    expect(evaluateScript({ ...bad, rewriteAttempted: true }, ctx, NOW).decision).toBe("SILENT_CARD_ONLY");
  });

  it("slows high-uncertainty speech and wants the level up front", () => {
    const r = evaluateScript(
      {
        ...base,
        uncertainty: "high",
        script: "I investigated the test channel. The image shows a sinuous channel with a raised rim. Uncertainty is high.",
        sentenceEvidence: [[], ["EV-TEST-002"], []],
      },
      ctx,
      NOW,
    );
    expect(r.speechRate).toBe(0.9);
    expect(r.issues.map((i) => i.message)).toContain("high uncertainty must be stated first");
  });
});

describe("VR1 / VA1", () => {
  it("blocks low-confidence references unless chosen manually", () => {
    expect(validateReference({ reference: { method: "ray", confidence: 0.6, clarificationAsked: false } }).ok).toBe(false);
    expect(validateReference({ reference: { method: "manual", confidence: 0, clarificationAsked: true } }).ok).toBe(true);
  });

  it("keeps the scientist's words verbatim", () => {
    const utt = { id: "U-1", transcript: "Note: the rim looks slumped here.", speaker: "scientist" as const };
    expect(validateAttribution({ utteranceId: "U-1", transcript: utt.transcript, descriptors: ["slumped", "rim"] }, utt).ok).toBe(true);
    expect(validateAttribution({ utteranceId: "U-1", transcript: utt.transcript, descriptors: ["collapsed"] }, utt).ok).toBe(false);
    expect(validateAttribution({ utteranceId: "U-1", transcript: "The rim is slumped.", descriptors: [] }, utt).ok).toBe(false);
  });
});

describe("hashInput", () => {
  it("ignores key order", () => {
    expect(hashInput({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(hashInput({ b: [1, { d: 3, c: 2 }], a: 1 }));
  });
});
