import { describe, expect, it } from "vitest";
import { evaluateFinding } from "./index.js";
import { JEV_DEFAULT_MODEL, JevAdapter, jevFromEnv } from "./jevAdapter.js";
import type { JevDecisionLog } from "./jevAdapter.js";
import { NOW, ctx, draft, geologyOutput, imageryOutput, lolaOutput, observation } from "../fixtures/testSite.js";

interface Sent {
  url: string;
  auth: string | null;
  body: { model: string; state: Record<string, unknown>; questions: Record<string, { type: string }> };
}

/** A stand-in for the Jev endpoint: answers every question with `p(name)`, and records what was sent. */
function fakeJev(p: (name: string) => number, status = 200) {
  const sent: Sent[] = [];
  const fetchFn: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Sent["body"];
    sent.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body });
    if (status !== 200) return new Response(JSON.stringify({ detail: "secret provider detail" }), { status });
    const answers = Object.fromEntries(Object.keys(body.questions).map((k) => [k, { type: "noul", noul: p(k) }]));
    return new Response(JSON.stringify({ model: body.model, answers, usage: { input_tokens: 1, output_tokens: 1 } }), {
      status: 200,
      headers: { "x-typesafe-request-id": "req_test" },
    });
  };
  return { sent, fetchFn };
}

const jev = (p: (name: string) => number, status?: number, log?: (e: JevDecisionLog) => void) => {
  const f = fakeJev(p, status);
  return { ...f, adapter: new JevAdapter({ apiKey: "k-test", fetch: f.fetchFn, log }) };
};

const sufficiency = { validatorIssues: [], survivingClaims: 2, groundedObservationOrMeasurement: true };
const escalation = { contradiction: false, contradictionPresented: true, uncertainty: "low" as const, impact: "normal" as const };

describe("JevAdapter", () => {
  it("sends typed questions to the pinned model with the key as a bearer token", async () => {
    const { adapter, sent } = jev(() => 0.9);
    const r = await adapter.needsEscalation(escalation);
    expect(r).toEqual({ ok: true, value: { value: true, requestId: "req_test" } });
    expect(sent[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(sent[0]?.auth).toBe("Bearer k-test");
    expect(sent[0]?.body.model).toBe(JEV_DEFAULT_MODEL);
    expect(sent[0]?.body.questions.escalate?.type).toBe("noul");
  });

  it("turns confident probabilities into answers and leaves the undecided band to the fallback", async () => {
    expect(await jev(() => 0.1).adapter.needsEscalation(escalation)).toMatchObject({ ok: true, value: { value: false } });
    const undecided = await jev(() => 0.5).adapter.needsEscalation(escalation);
    expect(undecided).toEqual({ ok: false, error: "Jev undecided (escalate=0.50)" });
  });

  it("needs every sufficiency question to be a confident yes, and one confident no settles it", async () => {
    const claims = [{ text: "The floor is flat.", claimType: "observation", evidence: ["image: test frame"] }];
    const yes = jev(() => 0.9);
    expect(await yes.adapter.evidenceSufficient({ ...sufficiency, claims })).toMatchObject({ ok: true, value: { value: true } });
    expect(Object.keys(yes.sent[0]?.body.questions ?? {})).toEqual(["sufficient", "supported"]);
    expect(yes.sent[0]?.body.state.claims).toEqual(claims);

    const unsupported = jev((k) => (k === "supported" ? 0.1 : 0.9));
    expect(await unsupported.adapter.evidenceSufficient({ ...sufficiency, claims })).toMatchObject({ ok: true, value: { value: false } });
    const unsure = jev((k) => (k === "supported" ? 0.5 : 0.9));
    expect((await unsure.adapter.evidenceSufficient({ ...sufficiency, claims })).ok).toBe(false);
    // Without claims only the structural question is asked.
    const bare = jev(() => 0.9);
    await bare.adapter.evidenceSufficient(sufficiency);
    expect(Object.keys(bare.sent[0]?.body.questions ?? {})).toEqual(["sufficient"]);
  });

  it("always keeps the core team and lets Jev pick the rest, in the allowed order", async () => {
    const allowed = ["26_lola_elevation_researcher", "12_impact_crater_researcher", "14_lunar_volcanism_researcher", "22_research_synthesis_specialist"];
    const { adapter, sent } = jev((k) => (k === "12_impact_crater_researcher" ? 0.8 : 0.1));
    const r = await adapter.selectSpecialists({ observationSource: "hand_select", featureKind: "crater", descriptors: ["bowl shaped"], allowed });
    expect(r).toMatchObject({ ok: true, value: { value: ["26_lola_elevation_researcher", "12_impact_crater_researcher", "22_research_synthesis_specialist"] } });
    expect(Object.keys(sent[0]?.body.questions ?? {})).toEqual(["12_impact_crater_researcher", "14_lunar_volcanism_researcher"]);
  });

  it("never asks a model to compare scores", async () => {
    const { adapter, sent } = jev(() => 0.9);
    expect((await adapter.referenceNeedsClarification()).ok).toBe(false);
    expect(sent).toEqual([]);
  });

  it("returns typed errors without the provider's body, on HTTP errors, bad shapes and network failures", async () => {
    expect(await jev(() => 0.9, 429).adapter.needsEscalation(escalation)).toEqual({ ok: false, error: "Jev HTTP 429" });
    const badShape = new JevAdapter({ apiKey: "k", fetch: async () => new Response(JSON.stringify({ answers: { escalate: { type: "noul", noul: 7 } } })) });
    expect((await badShape.needsEscalation(escalation)).ok).toBe(false);
    const offline = new JevAdapter({ apiKey: "k", fetch: async () => Promise.reject(new TypeError("fetch failed: k")) });
    expect(await offline.needsEscalation(escalation)).toEqual({ ok: false, error: "Jev unreachable" });
  });

  it("logs probabilities and ids, never the key", async () => {
    const log: JevDecisionLog[] = [];
    await jev(() => 0.9, 200, (e) => log.push(e)).adapter.needsEscalation(escalation);
    expect(log).toEqual([{ question: "needsEscalation", requestId: "req_test", model: JEV_DEFAULT_MODEL, probabilities: { escalate: 0.9 } }]);
    expect(JSON.stringify(log)).not.toContain("k-test");
  });

  it("is off without a key", () => {
    expect(jevFromEnv({})).toBeUndefined();
    expect(jevFromEnv({ JEV_API_KEY: "" })).toBeUndefined();
    expect(jevFromEnv({ JEV_API_KEY: "k" })).toBeInstanceOf(JevAdapter);
  });
});

describe("evaluateFinding with Jev", () => {
  const good = { observation, agentOutputs: [lolaOutput, imageryOutput, geologyOutput], draft };

  it("shows Jev the surviving claims beside their evidence, and records its request ids", async () => {
    const { adapter, sent } = jev((k) => (k === "escalate" ? 0.05 : 0.95));
    const r = await evaluateFinding(good, ctx, adapter, NOW);
    expect(r.decision).toMatchObject({ outcome: "ACCEPT_FOR_REVIEW", source: "jev" });
    expect(r.audit.jevRequestIds).toEqual(["req_test", "req_test"]);
    const claims = sent[0]?.body.state.claims as { text: string; evidence: string[] }[];
    expect(claims.map((c) => c.text)).toEqual(r.claims.map((c) => c.text));
    expect(claims.every((c) => c.evidence.length > 0)).toBe(true);
  });

  it("lets Jev hold back a finding whose evidence does not support its claims", async () => {
    const r = await evaluateFinding(good, ctx, jev((k) => (k === "supported" ? 0.05 : k === "escalate" ? 0.05 : 0.95)).adapter, NOW);
    expect(r.decision.outcome).toBe("REQUEST_MORE_EVIDENCE");
    expect(r.status).toBe("researching");
  });

  it("lets Jev escalate a finding the policy would accept", async () => {
    const r = await evaluateFinding(good, ctx, jev(() => 0.95).adapter, NOW);
    expect(r.decision).toMatchObject({ outcome: "ESCALATE_TO_SCIENTIST", source: "jev" });
  });

  it("never lets Jev loosen the gate: no approving thin evidence, no un-escalating a high-impact finding", async () => {
    const eager = jev((k) => (k === "escalate" ? 0.05 : 0.95)).adapter;
    const thin = await evaluateFinding({ observation, agentOutputs: [lolaOutput], draft: { ...draft, summary: "" } }, ctx, eager, NOW);
    expect(thin.decision).toMatchObject({ outcome: "REQUEST_MORE_EVIDENCE", source: "fallback" });
    const high = await evaluateFinding({ ...good, impact: "high" }, ctx, eager, NOW);
    expect(high.decision).toMatchObject({ outcome: "ESCALATE_TO_SCIENTIST", source: "fallback" });
  });

  it("decides exactly as without Jev when Jev is down or undecided", async () => {
    const baseline = await evaluateFinding(good, ctx, undefined, NOW);
    for (const adapter of [jev(() => 0.5).adapter, jev(() => 0.9, 503).adapter]) {
      const r = await evaluateFinding(good, ctx, adapter, NOW);
      expect(r.decision).toEqual(baseline.decision);
    }
  });
});
