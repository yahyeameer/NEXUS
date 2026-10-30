import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { NexusEvent, Observation, Result } from "@nexus/schemas";
import { Auth } from "../../api/src/auth.js";
import { EventBus } from "../../api/src/eventBus.js";
import { evidenceStore } from "../../api/src/evidenceStore.js";
import { buildServer as buildApi } from "../../api/src/server.js";
import { MemoryStore } from "../../api/src/store.js";
import { draft, evidence, geologyOutput, imageryOutput, lolaOutput, measurements } from "../../../packages/sie/fixtures/testSite.js";
import type { Api } from "./apiClient.js";
import { Dispatcher } from "./dispatcher.js";
import { runResearch } from "./researchRun.js";
import type { TeamResult, TeamRunner, TeamTask } from "./teamRunner.js";
import { CommandRunner, PrecomputedRunner } from "./teamRunner.js";

const ORCH = "orch-token";
const briefing = {
  script: "I investigated the test channel. The image shows a sinuous channel with a raised rim. Overall uncertainty is medium.",
  sentenceEvidence: [[], ["EV-TEST-002"], []],
  speakerAgentId: "25_lroc_imagery_researcher",
};
const synthesis = { findingDraft: draft, spokenBriefingDraft: briefing };

function injectApi(app: ReturnType<typeof buildApi>): Api {
  const call = async (method: "GET" | "POST", url: string, payload?: object) => {
    const res = await app.inject({ method, url, headers: { authorization: `Bearer ${ORCH}` }, payload });
    return { status: res.statusCode, json: res.json<{ ok: boolean; value?: unknown; issues?: unknown }>() };
  };
  const simple = async <T>(method: "GET" | "POST", url: string, payload?: object): Promise<Result<T>> => {
    const r = await call(method, url, payload);
    return r.json.ok ? { ok: true, value: r.json.value as T } : { ok: false, error: String(r.status) };
  };
  return {
    getObservation: (id) => simple("GET", `/observations/${id}`),
    listFieldNotes: (id) => simple("GET", `/observations/${id}/field-notes`),
    submitResearch: async (id, body) => {
      const r = await call("POST", `/observations/${id}/research`, body);
      return r.json.ok ? { ok: true, value: r.json.value as never } : { ok: false, error: { status: r.status, issues: r.json.issues } };
    },
    validateBriefing: (body) => simple("POST", "/scripts/validate", { ...body, isBriefing: true, rewriteAttempted: true }),
    emit: async (type, sessionId, correlationId, payload) => {
      await call("POST", "/events", { type, sessionId, correlationId, payload });
    },
  };
}

class ScriptedRunner implements TeamRunner {
  reruns: string[] = [];
  constructor(
    private readonly result: (task: TeamTask) => Promise<Result<TeamResult>>,
    private readonly rerunWith: (agentId: string) => unknown = () => undefined,
  ) {}
  run(task: TeamTask) {
    return this.result(task);
  }
  async rerun(_task: TeamTask, agentId: string): Promise<Result<unknown>> {
    this.reruns.push(agentId);
    const v = this.rerunWith(agentId);
    return v === undefined ? { ok: false, error: "no rerun" } : { ok: true, value: v };
  }
}

const team = (obsId: string): TeamResult => ({
  outputs: [lolaOutput, imageryOutput, geologyOutput].map((o) => ({ agentId: o.agentId, output: { ...o, observationId: obsId } })),
  synthesis,
});

let app: ReturnType<typeof buildApi>;
let bus: EventBus;
let api: Api;
let events: NexusEvent[];
let human: { token: string; sessionId: string };

beforeEach(async () => {
  bus = new EventBus();
  app = buildApi({
    store: new MemoryStore(),
    evidence: evidenceStore(evidence, measurements),
    auth: new Auth({ pairingCode: "1234", serviceTokens: { orchestrator: ORCH } }),
    bus,
  });
  api = injectApi(app);
  events = [];
  bus.subscribe((e) => events.push(e));
  human = (await app.inject({ method: "POST", url: "/sessions", payload: { pairingCode: "1234", userId: "sci" } })).json<{ value: { token: string; sessionId: string } }>().value;
});

async function observation(source: Observation["source"] = "hand_select", featureId = "TEST_RILLE"): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/observations",
    headers: { authorization: `Bearer ${human.token}` },
    payload: { siteId: "TEST_SITE", source, featureId, spatialAnchor: { terrainFeatureId: featureId } },
  });
  return res.json<{ value: { id: string } }>().value.id;
}

describe("runResearch", () => {
  it("routes, runs, parses and submits through the SIE", async () => {
    const obsId = await observation();
    let picked: string[] = [];
    const runner = new ScriptedRunner(async (task) => {
      picked = task.agentIds;
      return { ok: true, value: team(obsId) };
    });
    const res = await runResearch(obsId, human.sessionId, { api, runner });
    expect(res.ok && res.value.status).toBe("ready_for_review");
    // Fallback routing for a rille includes hypothesis + skeptic, and synthesis always runs.
    expect(picked).toEqual(expect.arrayContaining(["26_lola_elevation_researcher", "33_hypothesis_generator", "22_research_synthesis_specialist"]));
    const types = events.map((e) => e.type);
    expect(types[1]).toBe("research.started");
    expect(types).toContain("evidence.retrieved");
    expect(types.indexOf("finding.validation.completed")).toBeLessThan(types.indexOf("finding.generated"));
  });

  it("retries an unparseable output once, and never retries self-approval", async () => {
    const obsId = await observation();
    const broken = { agentId: "26_lola_elevation_researcher", observationId: obsId, claims: "nope" };
    const selfApproving = { ...imageryOutput, observationId: obsId, status: "reviewed" };
    const runner = new ScriptedRunner(
      async () => ({
        ok: true,
        value: {
          outputs: [
            { agentId: "26_lola_elevation_researcher", output: broken },
            { agentId: "25_lroc_imagery_researcher", output: selfApproving },
            { agentId: "11_lunar_geology_researcher", output: { ...geologyOutput, observationId: obsId } },
          ],
          synthesis,
        },
      }),
      (agentId) => (agentId === "26_lola_elevation_researcher" ? { ...lolaOutput, observationId: obsId } : undefined),
    );
    const res = await runResearch(obsId, human.sessionId, { api, runner });
    // Imagery claims are gone, so the briefing that cites imagery needs its one rewrite too.
    expect(runner.reruns).toEqual(["26_lola_elevation_researcher", "22_research_synthesis_specialist"]);
    expect(res.ok && res.value.claims.map((c) => c.text)).toEqual([lolaOutput.claims[0]?.text, geologyOutput.claims[0]?.text]);
  });

  it("re-runs synthesis once when the SIE rejects it", async () => {
    const obsId = await observation();
    const runner = new ScriptedRunner(
      async () => ({ ok: true, value: { ...team(obsId), synthesis: { ...synthesis, status: "reviewed" } } }),
      (agentId) => (agentId === "22_research_synthesis_specialist" ? synthesis : undefined),
    );
    const res = await runResearch(obsId, human.sessionId, { api, runner });
    expect(runner.reruns).toEqual(["22_research_synthesis_specialist"]);
    expect(res.ok).toBe(true);
  });

  it("fails the run on timeout and reports every task as failed", async () => {
    const obsId = await observation();
    const runner = new ScriptedRunner(
      (task) =>
        new Promise((resolve) => {
          task.signal.addEventListener("abort", () => resolve({ ok: false, error: "team run timed out" }));
        }),
    );
    const res = await runResearch(obsId, human.sessionId, { api, runner, timeoutMs: 20 });
    expect(res).toEqual({ ok: false, error: "team run timed out" });
    expect(events.filter((e) => e.type === "agent.task.failed").length).toBeGreaterThan(0);
  });
});

describe("PrecomputedRunner", () => {
  it("binds stored outputs to the observation and keeps only routed agents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nexus-pre-"));
    await mkdir(join(dir, "TEST_SITE"));
    await writeFile(join(dir, "TEST_SITE", "TEST_RILLE.json"), JSON.stringify(team("OBS-TEMPLATE")));
    const obsId = await observation();
    const res = await runResearch(obsId, human.sessionId, { api, runner: new PrecomputedRunner(dir) });
    expect(res.ok && res.value.observationId).toBe(obsId);

    const missing = await new PrecomputedRunner(dir).run({
      observation: { id: "OBS-1", siteId: "TEST_SITE", source: "hand_select", featureId: "../../etc", spatialAnchor: {}, createdBy: "x", createdAt: "2026-10-30T12:00:00Z" },
      runId: "RUN-test",
      fieldNotes: [],
      agentIds: [],
      signal: new AbortController().signal,
    });
    expect(missing.ok).toBe(false);
  });
});

describe("CommandRunner", () => {
  it("writes the run context for the tool server, passes the task on stdin and parses stdout", async () => {
    // The child echoes the mode and the runId it reads back from $NEXUS_RUN_DIR/context.json.
    const script =
      "const fs=require('fs');let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const t=JSON.parse(s);const c=JSON.parse(fs.readFileSync(process.env.NEXUS_RUN_DIR+'/context.json','utf8'));console.log(JSON.stringify({outputs:[{agentId:t.agentIds[0],output:{seen:t.mode,runId:c.runId}}],synthesis:null}))})";
    const r = new CommandRunner(process.execPath, ["-e", script], process.cwd(), await mkdtemp(join(tmpdir(), "nexus-run-")));
    const res = await r.run({
      observation: { id: "OBS-1", siteId: "S", source: "hand_select", spatialAnchor: {}, createdBy: "x", createdAt: "2026-10-30T12:00:00Z" },
      runId: "RUN-test",
      fieldNotes: [],
      agentIds: ["26_lola_elevation_researcher"],
      signal: new AbortController().signal,
    });
    expect(res).toEqual({ ok: true, value: { outputs: [{ agentId: "26_lola_elevation_researcher", output: { seen: "run", runId: "RUN-test" } }], synthesis: null } });
  });

  it("reports a non-zero exit without leaking stderr", async () => {
    const r = new CommandRunner(process.execPath, ["-e", "console.error('secret'); process.exit(3)"], process.cwd());
    const res = await r.run({
      observation: { id: "OBS-1", siteId: "S", source: "hand_select", spatialAnchor: {}, createdBy: "x", createdAt: "2026-10-30T12:00:00Z" },
      runId: "RUN-test",
      fieldNotes: [],
      agentIds: [],
      signal: new AbortController().signal,
    });
    expect(res).toEqual({ ok: false, error: "team command exited with 3" });
  });
});

describe("Dispatcher", () => {
  it("auto-starts spoken notes, waits for Investigate on hand selections", async () => {
    const started: string[] = [];
    const runner = new ScriptedRunner(async (task) => {
      started.push(task.observation.id);
      return { ok: true, value: team(task.observation.id) };
    });
    const d = new Dispatcher({ api, runner });
    bus.subscribe((e) => d.onEvent(e));

    const hand = await observation("hand_select");
    const spoken = await observation("field_note");
    await d.idle();
    expect(started).toEqual([spoken]);

    await app.inject({
      method: "POST",
      url: "/events",
      headers: { authorization: `Bearer ${human.token}` },
      payload: { type: "observation.selected", correlationId: hand, payload: { observationId: hand, action: "investigate" } },
    });
    await d.idle();
    expect(started).toEqual([spoken, hand]);
    expect(d.state.completed).toBe(2);
  });
});
