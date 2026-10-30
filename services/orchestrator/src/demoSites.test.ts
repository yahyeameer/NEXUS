// The three judged demo sites must work with every provider down (AGENTS.md §6 "Demo safety"):
// the precomputed outputs in data/precomputed are replayed against the real evidence packs and DEMs,
// and every claim and the spoken briefing must pass the SIE unchanged.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Result } from "@nexus/schemas";
import { Auth } from "../../api/src/auth.js";
import { EventBus } from "../../api/src/eventBus.js";
import { loadEvidenceStore } from "../../api/src/evidenceStore.js";
import { buildServer as buildApi } from "../../api/src/server.js";
import { MemoryStore } from "../../api/src/store.js";
import type { Api } from "./apiClient.js";
import { runResearch } from "./researchRun.js";
import { PrecomputedRunner } from "./teamRunner.js";

const DATA = fileURLToPath(new URL("../../../data", import.meta.url));
const ORCH = "orch-token";

const SITES = [
  { siteId: "HADLEY_RILLE", featureId: "HADLEY_RILLE" },
  { siteId: "ELBOW_CRATER", featureId: "ELBOW_CRATER" },
  { siteId: "HADLEY_DELTA", featureId: "HADLEY_DELTA_SLOPE" },
];

describe("demo sites in precomputed mode", async () => {
  const evidence = await loadEvidenceStore(DATA);
  const app = buildApi({
    store: new MemoryStore(),
    evidence,
    auth: new Auth({ pairingCode: "1234", serviceTokens: { orchestrator: ORCH } }),
    bus: new EventBus(),
  });
  const call = async (method: "GET" | "POST", url: string, payload?: object) => {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${ORCH}` }, payload });
    return { status: res.statusCode, json: res.json<{ ok: boolean; value?: unknown; issues?: unknown }>() };
  };
  const simple = async <T>(method: "GET" | "POST", url: string, payload?: object): Promise<Result<T>> => {
    const r = await call(method, url, payload);
    return r.json.ok ? { ok: true, value: r.json.value as T } : { ok: false, error: JSON.stringify(r.json.issues ?? r.status) };
  };
  const api: Api = {
    getObservation: (id) => simple("GET", `/observations/${id}`),
    listFieldNotes: (id) => simple("GET", `/observations/${id}/field-notes`),
    submitResearch: async (id, body) => {
      const r = await call("POST", `/observations/${id}/research`, body);
      return r.json.ok ? { ok: true, value: r.json.value as never } : { ok: false, error: { status: r.status, issues: r.json.issues } };
    },
    validateBriefing: (body) => simple("POST", "/scripts/validate", { ...body, isBriefing: true, rewriteAttempted: true }),
    emit: async () => undefined,
  };
  const human = (await app.inject({ method: "POST", url: "/sessions", payload: { pairingCode: "1234", userId: "sci" } })).json<{
    value: { token: string; sessionId: string };
  }>().value;

  it("computes the measurements every pack relies on from the DEMs", () => {
    for (const { siteId } of SITES) expect(evidence.contextFor(siteId).measurements.size).toBeGreaterThan(0);
  });

  it.each(SITES)("$featureId passes the SIE with every claim kept and the briefing spoken", async ({ siteId, featureId }) => {
    const created = await app.inject({
      method: "POST",
      url: "/observations",
      headers: { authorization: `Bearer ${human.token}` },
      payload: { siteId, source: "hand_select", featureId, spatialAnchor: { terrainFeatureId: featureId } },
    });
    const obsId = created.json<{ value: { id: string } }>().value.id;
    const res = await runResearch(obsId, human.sessionId, { api, runner: new PrecomputedRunner(`${DATA}/precomputed`) });
    if (!res.ok) throw new Error(res.error);
    const f = res.value;
    expect({ status: f.status, outcome: f.decision.outcome, removed: f.removedClaims }).toEqual({
      status: "ready_for_review",
      outcome: "ACCEPT_FOR_REVIEW",
      removed: [],
    });
    expect(f.claims.length).toBeGreaterThan(0);
    expect(f.spokenBriefing?.voiceDecision).toBe("SPEAK_AS_APPROVED");
  });
});
