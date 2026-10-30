// End-to-end through the real services/api (in memory): voice → API → SIE → speech.
import { beforeEach, describe, expect, it } from "vitest";
import type { Result, VoiceServerMessage } from "@nexus/schemas";
import { Auth } from "../../api/src/auth.js";
import { EventBus } from "../../api/src/eventBus.js";
import { evidenceStore } from "../../api/src/evidenceStore.js";
import { buildServer as buildApi } from "../../api/src/server.js";
import { MemoryStore } from "../../api/src/store.js";
import { draft, evidence, geologyOutput, imageryOutput, lolaOutput, measurements, WIDTH } from "../../../packages/sie/fixtures/testSite.js";
import { FakeReasoning } from "./adapters/reasoningAdapter.js";
import { FakeSpeechToText, SilentTextToSpeech } from "./adapters/speechAdapter.js";
import type { Api } from "./apiClient.js";
import { buildServer as buildGateway } from "./server.js";
import { VoiceSession } from "./voiceSession.js";

const VOICE = "voice-token";
const ORCH = "orch-token";

/** Api backed by app.inject, so the gateway talks to the real API routes. */
function injectApi(app: ReturnType<typeof buildApi>): Api {
  const call = async <T>(method: "GET" | "POST", url: string, token: string, payload?: object): Promise<Result<T>> => {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });
    const json = res.json<{ ok: boolean; value?: T }>();
    return json.ok ? { ok: true, value: json.value as T } : { ok: false, error: `api ${res.statusCode}` };
  };
  return {
    createUtterance: (t, u) => call("POST", "/utterances", t, u),
    recordOutgoing: (u) => call("POST", "/utterances", VOICE, u),
    createObservation: (t, o) => call("POST", "/observations", t, o),
    createFieldNote: (t, n) => call("POST", "/field-notes", t, n),
    review: (t, id, b) => call("POST", `/findings/${id}/review`, t, b),
    getFinding: (id) => call("GET", `/findings/${id}`, VOICE),
    getEvidence: (site) => call("GET", `/evidence/${site}`, VOICE),
    listFieldNotes: (obs) => call("GET", `/observations/${obs}/field-notes`, VOICE),
    validateScript: (b) => call("POST", "/scripts/validate", VOICE, b),
    emit: async (type, sessionId, correlationId, payload) => {
      await call("POST", "/events", VOICE, { type, sessionId, correlationId, payload });
    },
  };
}

const head = { x: 0, y: 1.2, z: 0 };
const forward = { x: 0, y: 0, z: -1 };
const rille = { id: "TEST_RILLE", spokenLabel: "the test rille", aliases: ["rille"], position: { x: 0, y: 0.8, z: -0.6 } };
const crater = { id: "TEST_CRATER", spokenLabel: "the test crater", aliases: ["crater"], position: { x: 0.5, y: 0.8, z: -0.6 } };

let api: ReturnType<typeof buildApi>;
let stt: FakeSpeechToText;
let reasoning: FakeReasoning;
let sent: VoiceServerMessage[];
let session: VoiceSession;
let human: { token: string; sessionId: string };

beforeEach(async () => {
  api = buildApi({
    store: new MemoryStore(),
    evidence: evidenceStore(evidence, measurements),
    auth: new Auth({ pairingCode: "1234", serviceTokens: { orchestrator: ORCH, "voice-gateway": VOICE } }),
    bus: new EventBus(),
  });
  human = (await api.inject({ method: "POST", url: "/sessions", payload: { pairingCode: "1234", userId: "sci" } })).json<{ value: { token: string; sessionId: string } }>().value;
  stt = new FakeSpeechToText();
  reasoning = new FakeReasoning();
  sent = [];
  session = new VoiceSession({ api: injectApi(api), stt, tts: new SilentTextToSpeech(), reasoning, send: (m) => sent.push(m) });
  await session.handle({ type: "auth", ...human });
});

async function speak(transcript: string, rayFeatureId?: string) {
  stt.say(transcript);
  await session.handle({ type: "ptt.start", sampleRateHz: 16000 });
  session.audio(new Uint8Array(32000)); // 1 s of 16 kHz PCM
  const target = rayFeatureId === rille.id ? rille : crater;
  await session.handle({
    type: "pointer",
    samples: rayFeatureId
      ? Array.from({ length: 30 }, (_, i) => ({ tMs: i * 33, rayFeatureId, rayPoint: target.position, onUi: false, headPosition: head, headDirection: forward }))
      : [],
  });
  await session.handle({ type: "ptt.end" });
}

const spoken = () => sent.filter((m): m is Extract<VoiceServerMessage, { type: "speak" }> => m.type === "speak").map((m) => m.text);

async function readyFinding(): Promise<string> {
  const obs = await api.inject({
    method: "POST",
    url: "/observations",
    headers: { authorization: `Bearer ${human.token}` },
    payload: { siteId: "TEST_SITE", source: "hand_select", featureId: "TEST_RILLE", spatialAnchor: { terrainFeatureId: "TEST_RILLE" } },
  });
  const obsId = obs.json<{ value: { id: string } }>().value.id;
  const res = await api.inject({
    method: "POST",
    url: `/observations/${obsId}/research`,
    headers: { authorization: `Bearer ${ORCH}` },
    payload: {
      sessionId: human.sessionId,
      agentOutputs: [lolaOutput, imageryOutput, geologyOutput].map((o) => ({ ...o, observationId: obsId })),
      synthesis: {
        findingDraft: draft,
        spokenBriefingDraft: { script: "Overall uncertainty is medium.", sentenceEvidence: [[]], speakerAgentId: "25_lroc_imagery_researcher" },
      },
    },
  });
  return res.json<{ value: { finding: { id: string } } }>().value.finding.id;
}

describe("VoiceSession", () => {
  beforeEach(async () => {
    await session.handle({ type: "context", siteId: "TEST_SITE", sites: [], candidates: [rille, crater], language: "en" });
  });

  it("turns a pointed spoken note into an observation and a verbatim field note", async () => {
    await speak("Boulder field here, blocks look angular.", "TEST_RILLE");
    const created = sent.find((m) => m.type === "fieldnote.created");
    expect(created?.type === "fieldnote.created" && created.fieldNote).toMatchObject({
      transcript: "Boulder field here, blocks look angular.",
      descriptors: ["boulder field", "blocks", "angular"],
      reference: { method: "ray", clarificationAsked: false, targetFeatureId: "TEST_RILLE" },
    });
    expect(spoken()).toEqual(["Noted."]);
  });

  it("drops model descriptors the scientist did not say", async () => {
    reasoning.descriptors = ["angular", "volcanic"];
    await speak("Note: angular blocks here", "TEST_RILLE");
    const created = sent.find((m) => m.type === "fieldnote.created");
    expect(created?.type === "fieldnote.created" && created.fieldNote.descriptors).toEqual(["angular"]);
  });

  it("asks instead of guessing, then accepts a poked candidate", async () => {
    await session.handle({ type: "ptt.start", sampleRateHz: 16000 });
    stt.say("Note this looks slumped");
    session.audio(new Uint8Array(32000));
    await session.handle({
      type: "pointer",
      samples: Array.from({ length: 30 }, (_, i) => ({
        tMs: i * 33,
        rayFeatureId: i % 2 ? rille.id : crater.id,
        rayPoint: { x: 0.25, y: 0.8, z: -0.6 },
        onUi: false,
        headPosition: head,
        headDirection: forward,
      })),
    });
    await session.handle({ type: "ptt.end" });
    expect(sent.some((m) => m.type === "clarify")).toBe(true);
    expect(sent.some((m) => m.type === "fieldnote.created")).toBe(false);

    await session.handle({ type: "clarify.choose", featureId: "TEST_CRATER" });
    const created = sent.find((m) => m.type === "fieldnote.created");
    expect(created?.type === "fieldnote.created" && created.fieldNote.reference).toMatchObject({ method: "manual", confidence: 1, clarificationAsked: true });
  });

  it("forwards commands for the headset to execute", async () => {
    await speak("zoom in");
    expect(sent.find((m) => m.type === "command")).toMatchObject({ command: { kind: "zoom", direction: "in" } });
  });

  it("speaks a grounded answer only after the SIE approves it, with one rewrite", async () => {
    const findingId = await readyFinding();
    await session.handle({ type: "context", siteId: "TEST_SITE", sites: [], selectedFindingId: findingId, candidates: [rille], language: "en" });
    reasoning.answers = [
      { script: "It is definitely 900 m wide. Uncertainty is medium.", sentenceEvidence: [[WIDTH], []], noEvidence: false },
      { script: "The test DEM gives about 400 m of width. Uncertainty is medium.", sentenceEvidence: [[WIDTH], []], speakerAgentId: "26_lola_elevation_researcher", noEvidence: false },
    ];
    await speak("How wide is it?");
    const speak1 = sent.find((m) => m.type === "speak");
    expect(speak1).toMatchObject({ text: "The test DEM gives about 400 m of width. Uncertainty is medium.", voice: "voiceA", placement: "feature_floor" });
    expect(speak1?.type === "speak" && speak1.sieDecisionId).toMatch(/^SIE-/);
  });

  it("says it has no evidence when both attempts fail the SIE", async () => {
    const findingId = await readyFinding();
    await session.handle({ type: "context", siteId: "TEST_SITE", sites: [], selectedFindingId: findingId, candidates: [rille], language: "en" });
    const bad = { script: "This proves it is a lava tube. Uncertainty is medium.", sentenceEvidence: [["EV-TEST-003"], []], noEvidence: false };
    reasoning.answers = [bad, bad];
    await speak("What is it?");
    expect(spoken()).toEqual(["I don't have evidence for that in this investigation."]);
  });

  it("reviews by voice with the reason stored verbatim", async () => {
    const findingId = await readyFinding();
    await session.handle({ type: "context", siteId: "TEST_SITE", sites: [], selectedFindingId: findingId, candidates: [], language: "en" });
    await speak("Reject because the rim is too degraded");
    expect(sent.find((m) => m.type === "reviewed")).toMatchObject({ findingId, status: "rejected" });
    const f = await api.inject({ method: "GET", url: `/findings/${findingId}`, headers: { authorization: `Bearer ${human.token}` } });
    expect(f.json<{ value: { review: { rationaleText: string } } }>().value.review.rationaleText).toBe("the rim is too degraded");
  });

  it("does nothing before auth and says it did not catch empty speech", async () => {
    const fresh: VoiceServerMessage[] = [];
    const s = new VoiceSession({ api: injectApi(api), stt, tts: new SilentTextToSpeech(), send: (m) => fresh.push(m) });
    await s.handle({ type: "ptt.end" });
    expect(fresh).toEqual([{ type: "error", message: "unauthenticated" }]);

    await speak("");
    expect(spoken()).toContain("I didn't catch that.");
  });
});

describe("simulated speech (emulator)", () => {
  async function socket(simulatedSpeech: boolean) {
    const gateway = buildGateway({ api: injectApi(api), stt: new FakeSpeechToText(), tts: new SilentTextToSpeech(), simulatedSpeech });
    await gateway.ready();
    const ws = await gateway.injectWS("/voice");
    const inbox: VoiceServerMessage[] = [];
    ws.on("message", (d: Buffer) => inbox.push(JSON.parse(d.toString()) as VoiceServerMessage));
    const send = (m: object) => ws.send(JSON.stringify(m));
    const until = async (type: string) => {
      for (let i = 0; i < 200 && !inbox.some((m) => m.type === type); i++) await new Promise((r) => setTimeout(r, 5));
      return inbox.find((m) => m.type === type);
    };
    return { gateway, ws, inbox, send, until };
  }

  it("routes a typed transcript like speech, with the mic audio still streamed", async () => {
    const s = await socket(true);
    s.send({ type: "auth", ...human });
    await s.until("ready");
    s.send({ type: "ptt.start", sampleRateHz: 16000 });
    s.ws.send(new Uint8Array(3200));
    s.send({ type: "ptt.simulated_transcript", text: "next site" });
    s.send({ type: "ptt.end" });
    expect(await s.until("command")).toMatchObject({ command: { kind: "next_site" } });
    s.ws.terminate();
    await s.gateway.close();
  });

  it("is refused unless the gateway was started for the emulator", async () => {
    const s = await socket(false);
    s.send({ type: "auth", ...human });
    await s.until("ready");
    s.send({ type: "ptt.simulated_transcript", text: "next site" });
    expect(await s.until("error")).toEqual({ type: "error", message: "simulated speech is disabled" });
    s.ws.terminate();
    await s.gateway.close();
  });
});
