// Builds the standalone demo bundle the XR client ships with (ARCHITECTURE.md "Precomputed mode" and "Deployment").
// The precomputed outputs in data/precomputed are replayed through the real API and the real SIE, exactly as in
// `NEXUS_MODE=precomputed`, so every finding in the bundle carries the decision the SIE actually made. Nothing here
// writes a claim, a number or an evidence ID by hand (AGENTS.md rules 2–4).
import type { DemoBundle, DemoSite, EvidenceItem, MeasurementRecord, Observation, Result, ScientificFinding } from "@nexus/schemas";
import { demoBundle } from "@nexus/schemas";
import { Auth } from "../../api/src/auth.js";
import { EventBus } from "../../api/src/eventBus.js";
import { loadEvidenceStore } from "../../api/src/evidenceStore.js";
import { buildServer as buildApi } from "../../api/src/server.js";
import { MemoryStore } from "../../api/src/store.js";
import type { Api } from "./apiClient.js";
import { runResearch } from "./researchRun.js";
import { PrecomputedRunner } from "./teamRunner.js";

/** The three judged demo sites and the feature each one's precomputed research covers. */
export const DEMO_FEATURES = [
  { siteId: "HADLEY_RILLE", featureId: "HADLEY_RILLE" },
  { siteId: "ELBOW_CRATER", featureId: "ELBOW_CRATER" },
  { siteId: "HADLEY_DELTA", featureId: "HADLEY_DELTA_SLOPE" },
] as const;

/** Fixed so the committed bundle only changes when the research or the SIE does. */
const BUILT_AT = "2026-11-15T00:00:00.000Z";
const SERVICE = "demo-bundle-service";
const PAIRING = "demo-bundle";

export async function buildDemoBundle(dataDir: string): Promise<Result<DemoBundle, string>> {
  const evidence = await loadEvidenceStore(dataDir);
  const app = buildApi({
    store: new MemoryStore(),
    evidence,
    auth: new Auth({ pairingCode: PAIRING, serviceTokens: { orchestrator: SERVICE } }),
    bus: new EventBus(),
  });
  const call = async (method: "GET" | "POST", url: string, token: string, payload?: object) => {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });
    return { status: res.statusCode, json: res.json<{ ok: boolean; value?: unknown; issues?: unknown }>() };
  };
  const simple = async <T>(method: "GET" | "POST", url: string, payload?: object): Promise<Result<T>> => {
    const r = await call(method, url, SERVICE, payload);
    return r.json.ok ? { ok: true, value: r.json.value as T } : { ok: false, error: JSON.stringify(r.json.issues ?? r.status) };
  };
  const routed = new Map<string, string[]>();
  const api: Api = {
    getObservation: (id) => simple("GET", `/observations/${id}`),
    listFieldNotes: (id) => simple("GET", `/observations/${id}/field-notes`),
    submitResearch: async (id, body) => {
      const r = await call("POST", `/observations/${id}/research`, SERVICE, body);
      return r.json.ok ? { ok: true, value: r.json.value as never } : { ok: false, error: { status: r.status, issues: r.json.issues } };
    },
    validateBriefing: (body) => simple("POST", "/scripts/validate", { ...body, isBriefing: true, rewriteAttempted: true }),
    emit: async (type, _sessionId, observationId, payload) => {
      const p = payload as { agentIds?: unknown };
      if (type === "research.started" && Array.isArray(p.agentIds)) routed.set(observationId, p.agentIds.filter((a): a is string => typeof a === "string"));
    },
  };
  const paired = await app.inject({ method: "POST", url: "/sessions", payload: { pairingCode: PAIRING, userId: "demo-bundle" } });
  const human = paired.json<{ value: { token: string; sessionId: string } }>().value;

  const sites: DemoSite[] = [];
  for (const { siteId, featureId } of DEMO_FEATURES) {
    const created = await call("POST", "/observations", human.token, { siteId, source: "hand_select", featureId, spatialAnchor: { terrainFeatureId: featureId } });
    if (!created.json.ok) return { ok: false, error: `${siteId}: observation refused` };
    const obs = created.json.value as Observation;
    const run = await runResearch(obs.id, human.sessionId, { api, runner: new PrecomputedRunner(`${dataDir}/precomputed`) });
    if (!run.ok) return { ok: false, error: `${siteId}: ${run.error}` };
    // The client only ever shows a finding the SIE passed for review (findingBuilder.ts renderable).
    if (run.value.status !== "ready_for_review") return { ok: false, error: `${siteId}: SIE outcome ${run.value.decision.outcome}, not shown` };
    const ev = await call("GET", `/evidence/${siteId}`, human.token);
    if (!ev.json.ok) return { ok: false, error: `${siteId}: evidence unavailable` };
    const agentIds = routed.get(obs.id) ?? [];
    sites.push(stable({ siteId, featureId, agentIds, observation: obs, finding: run.value, evidence: ev.json.value as { items: EvidenceItem[]; measurements: MeasurementRecord[] } }));
  }
  const bundle = demoBundle.safeParse({
    kind: "nexus-precomputed-demo",
    note: "Precomputed research replayed through the NEXUS API and Scientific Integrity Engine at build time. Archival NASA data, not live mission data.",
    sites,
  });
  return bundle.success ? { ok: true, value: bundle.data } : { ok: false, error: bundle.error.message };
}

/**
 * Replaces the run's random IDs and wall-clock times with fixed ones so a rebuild is byte-identical unless the
 * research or the SIE changed. Claims, numbers, evidence IDs and decisions are left exactly as the SIE returned them.
 */
function stable(site: DemoSite): DemoSite {
  const obsId = `OBS-DEMO-${site.featureId}`;
  const findingId = `FND-DEMO-${site.featureId}`;
  const observation: Observation = { ...site.observation, id: obsId, createdAt: BUILT_AT };
  const f: ScientificFinding = site.finding;
  const finding: ScientificFinding = {
    ...f,
    id: findingId,
    observationId: obsId,
    sources: f.sources.map((s) => ({ ...s, observationId: obsId })),
    createdAt: BUILT_AT,
    updatedAt: BUILT_AT,
  };
  const measurements = site.evidence.measurements.map((m) => ({ ...m, computedAt: BUILT_AT }));
  return { ...site, observation, finding, evidence: { ...site.evidence, measurements } };
}
