import { afterEach, describe, expect, it } from "vitest";
import type { ScientificFinding } from "@nexus/schemas";
import { Auth } from "./auth.js";
import { EventBus } from "./eventBus.js";
import { evidenceStore } from "./evidenceStore.js";
import { buildServer } from "./server.js";
import { MemoryStore } from "./store.js";
import { draft, evidence, geologyOutput, imageryOutput, lolaOutput, measurements, WIDTH } from "../../../packages/sie/fixtures/testSite.js";

const ORCH = "orch-test-token";
const VOICE = "voice-test-token";

function setup() {
  const bus = new EventBus();
  const app = buildServer({
    store: new MemoryStore(),
    evidence: evidenceStore(evidence, measurements),
    auth: new Auth({ pairingCode: "1234", serviceTokens: { orchestrator: ORCH, "voice-gateway": VOICE } }),
    bus,
  });
  return { app, bus };
}

let ctx = setup();
afterEach(async () => {
  await ctx.app.close();
  ctx = setup();
});

async function session() {
  const res = await ctx.app.inject({ method: "POST", url: "/sessions", payload: { pairingCode: "1234", userId: "scientist-1" } });
  const body = res.json<{ value: { token: string; sessionId: string } }>();
  return { auth: `Bearer ${body.value.token}`, sessionId: body.value.sessionId };
}

async function observation(auth: string) {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/observations",
    headers: { authorization: auth },
    payload: { siteId: "TEST_SITE", source: "hand_select", featureId: "TEST_RILLE", spatialAnchor: { terrainFeatureId: "TEST_RILLE" } },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ value: { id: string } }>().value.id;
}

const briefing = {
  script: "I investigated the test channel. The image shows a sinuous channel with a raised rim. Overall uncertainty is medium.",
  sentenceEvidence: [[], ["EV-TEST-002"], []],
  speakerAgentId: "25_lroc_imagery_researcher",
};

async function research(observationId: string, sessionId: string, synthesis: unknown = { findingDraft: draft, spokenBriefingDraft: briefing }) {
  const outputs = [lolaOutput, imageryOutput, geologyOutput].map((o) => ({ ...o, observationId }));
  return ctx.app.inject({
    method: "POST",
    url: `/observations/${observationId}/research`,
    headers: { authorization: `Bearer ${ORCH}` },
    payload: { sessionId, agentOutputs: outputs, synthesis },
  });
}

describe("api", () => {
  it("answers /health", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toEqual({ ok: true, service: "api" });
  });

  it("requires authentication and a valid pairing code", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/findings" })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: "POST", url: "/sessions", payload: { pairingCode: "0000", userId: "x" } })).statusCode).toBe(401);
  });

  it("runs research through the SIE and lets only a human review it", async () => {
    const s = await session();
    const obsId = await observation(s.auth);
    const events: string[] = [];
    ctx.bus.subscribe((e) => events.push(e.type));

    const res = await research(obsId, s.sessionId);
    expect(res.statusCode).toBe(201);
    const finding = res.json<{ value: { finding: ScientificFinding } }>().value.finding;
    expect(finding.status).toBe("ready_for_review");
    expect(finding.decision.outcome).toBe("ACCEPT_FOR_REVIEW");
    expect(finding.spokenBriefing?.voiceDecision).toBe("SPEAK_AS_APPROVED");
    expect(finding.sources.map((x) => x.evidenceId).sort()).toEqual(["EV-TEST-001", "EV-TEST-002", "EV-TEST-003"]);
    expect(events).toEqual(["finding.validation.completed", "finding.review.required", "spatial.annotation.created", "speech.script.validated"]);

    // Agents and services can never review (AGENTS.md rule 8).
    const byAgent = await ctx.app.inject({ method: "POST", url: `/findings/${finding.id}/review`, headers: { authorization: `Bearer ${ORCH}` }, payload: { decision: "approved" } });
    expect(byAgent.statusCode).toBe(403);

    const review = await ctx.app.inject({
      method: "POST",
      url: `/findings/${finding.id}/review`,
      headers: { authorization: s.auth },
      payload: { decision: "approved", rationaleText: "the width matches my own read" },
    });
    expect(review.statusCode).toBe(200);
    expect(review.json<{ value: ScientificFinding }>().value).toMatchObject({ status: "reviewed", review: { reviewerId: "scientist-1", rationaleText: "the width matches my own read" } });
    expect(events.slice(-2)).toEqual(["finding.approved", "review.rationale.recorded"]);

    const again = await ctx.app.inject({ method: "POST", url: `/findings/${finding.id}/review`, headers: { authorization: s.auth }, payload: { decision: "rejected" } });
    expect(again.statusCode).toBe(409);

    const logbook = await ctx.app.inject({ method: "GET", url: "/logbook", headers: { authorization: s.auth } });
    expect(logbook.json<{ value: unknown[] }>().value).toHaveLength(1);
  });

  it("rejects a synthesis output that sets its own status", async () => {
    const s = await session();
    const obsId = await observation(s.auth);
    const res = await research(obsId, s.sessionId, { findingDraft: { ...draft, status: "reviewed" }, spokenBriefingDraft: briefing });
    expect(res.statusCode).toBe(422);
  });

  it("hides findings the SIE rejected from the headset", async () => {
    const s = await session();
    const obsId = await observation(s.auth);
    await ctx.app.inject({
      method: "POST",
      url: `/observations/${obsId}/research`,
      headers: { authorization: `Bearer ${ORCH}` },
      payload: { sessionId: s.sessionId, agentOutputs: [], synthesis: { findingDraft: draft, spokenBriefingDraft: briefing } },
    });
    const list = await ctx.app.inject({ method: "GET", url: `/findings?observationId=${obsId}`, headers: { authorization: s.auth } });
    expect(list.json<{ value: unknown[] }>().value).toEqual([]);
  });

  it("refuses outgoing speech without SIE approval, except system phrases", async () => {
    const base = { id: "U-OUT-1", sessionId: "S-x", speaker: "narrator", direction: "out", transcript: "The crater is 100 m deep.", language: "en", createdAt: "2026-10-30T12:00:00Z", sieDecisionId: "SIE-made-up" };
    const h = { authorization: `Bearer ${VOICE}` };
    expect((await ctx.app.inject({ method: "POST", url: "/utterances", headers: h, payload: base })).statusCode).toBe(422);
    const phrase = { ...base, id: "U-OUT-2", transcript: "Listening.", sieDecisionId: undefined, systemPhraseId: "listening" };
    expect((await ctx.app.inject({ method: "POST", url: "/utterances", headers: h, payload: phrase })).statusCode).toBe(201);
    const fake = { ...phrase, id: "U-OUT-3", transcript: "Listening. It is a lava tube." };
    expect((await ctx.app.inject({ method: "POST", url: "/utterances", headers: h, payload: fake })).statusCode).toBe(422);
  });

  it("asks for clarification below 0.75 and keeps field notes verbatim", async () => {
    const s = await session();
    const obsId = await observation(s.auth);
    const utt = { id: "U-IN-1", sessionId: s.sessionId, speaker: "scientist", direction: "in", transcript: "Boulders here, angular.", language: "en", createdAt: "2026-10-30T12:00:00Z" };
    expect((await ctx.app.inject({ method: "POST", url: "/utterances", headers: { authorization: s.auth }, payload: utt })).statusCode).toBe(201);
    const note = (confidence: number, descriptors: string[]) => ({
      observationId: obsId,
      utteranceId: "U-IN-1",
      transcript: utt.transcript,
      language: "en",
      descriptors,
      reference: { method: "ray", confidence, clarificationAsked: false, targetFeatureId: "TEST_RILLE" },
      spatialAnchor: { terrainFeatureId: "TEST_RILLE" },
    });
    const post = (payload: Record<string, unknown>) => ctx.app.inject({ method: "POST", url: "/field-notes", headers: { authorization: s.auth }, payload });
    expect((await post(note(0.6, ["boulders"]))).json()).toMatchObject({ error: "clarification_required" });
    expect((await post(note(0.9, ["collapsed"]))).json()).toMatchObject({ error: "attribution" });
    expect((await post(note(0.9, ["boulders", "angular"]))).statusCode).toBe(201);
  });

  it("only lets the headset play scripts the SIE approved", async () => {
    const s = await session();
    const obsId = await observation(s.auth);
    const findingId = (await research(obsId, s.sessionId)).json<{ value: { finding: ScientificFinding } }>().value.finding.id;
    const play = (scriptId: string) =>
      ctx.app.inject({ method: "POST", url: "/events", headers: { authorization: s.auth }, payload: { type: "speech.playback.started", correlationId: obsId, payload: { scriptId } } });
    expect((await play("QA-1")).statusCode).toBe(422);

    const validate = (script: string, sentenceEvidence: string[][]) =>
      ctx.app.inject({
        method: "POST",
        url: "/scripts/validate",
        headers: { authorization: `Bearer ${VOICE}` },
        payload: { sessionId: s.sessionId, scriptId: "QA-1", findingId, script, sentenceEvidence },
      });
    expect((await validate("It is 900 m wide. Uncertainty is medium.", [[WIDTH], []])).json()).toMatchObject({ value: { decision: "REWRITE_SCRIPT" } });
    expect((await play("QA-1")).statusCode).toBe(422);
    expect((await validate("The test DEM gives about 400 m of width. Uncertainty is medium.", [[WIDTH], []])).json()).toMatchObject({ value: { decision: "SPEAK_AS_APPROVED" } });
    expect((await play("QA-1")).statusCode).toBe(201);
    expect((await play(`${findingId}-briefing`)).statusCode).toBe(201);
  });

  it("stops services from relaying events they do not own", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: `Bearer ${VOICE}` },
      payload: { type: "finding.approved", sessionId: "S-x", correlationId: "OBS-x", payload: {} },
    });
    expect(res.statusCode).toBe(403);
  });

  it("streams a session's events over WebSocket after first-message auth", async () => {
    const s = await session();
    await ctx.app.ready();
    const ws = await ctx.app.injectWS("/events");
    const received: string[] = [];
    const ready = new Promise<void>((resolve) => {
      ws.on("message", (d: Buffer) => {
        const m = JSON.parse(d.toString()) as { type: string };
        received.push(m.type);
        if (m.type === "auth.ok") resolve();
      });
    });
    ws.send(JSON.stringify({ type: "auth", token: s.auth.slice(7) }));
    await ready;
    await observation(s.auth);
    ctx.bus.emit("observation.created", "S-someone-else", "OBS-y", {});
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual(["auth.ok", "observation.created"]);
    ws.terminate();
  });
});
