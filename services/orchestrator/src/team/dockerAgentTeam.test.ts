import { describe, expect, it } from "vitest";
import type { Observation } from "@nexus/schemas";
import { agentPrompt, extractJson, planPhases, rerunAgent, runTeam, SYNTHESIS_ID, yamlAgentName, type AgentExec } from "./dockerAgentTeam.js";
import { dockerAgentArgs } from "./teamCli.js";

// Synthetic plumbing fixture: ids and values are made up and cite nothing real (AGENTS.md rule 3).
const observation = {
  id: "OBS-FIXTURE",
  sessionId: "SES-FIXTURE",
  siteId: "FIXTURE_SITE",
  featureId: "TEST_CRATER",
  source: "selection",
  createdAt: "2026-11-16T00:00:00Z",
} as unknown as Observation;

const base = { runId: "RUN-1", observation, fieldNotes: [] };
const out = (agentId: string) => JSON.stringify({ agentId, observationId: "OBS-FIXTURE", claims: [] });

function recorder(answer: (agent: string) => string | Error = (a) => out(a)) {
  const calls: { agent: string; prompt: string }[] = [];
  const exec: AgentExec = async ({ agent, prompt }) => {
    calls.push({ agent, prompt });
    const a = answer(agent);
    return a instanceof Error ? { ok: false, error: a.message } : { ok: true, value: a };
  };
  return { calls, exec };
}

describe("planPhases", () => {
  it("keeps coordinator order and only allowed agents", () => {
    expect(planPhases([SYNTHESIS_ID, "33_hypothesis_generator", "26_lola_elevation_researcher", "25_lroc_imagery_researcher"])).toEqual([
      ["26_lola_elevation_researcher", "25_lroc_imagery_researcher"],
      ["33_hypothesis_generator"],
      [SYNTHESIS_ID],
    ]);
  });

  it("never adds an agent that routing did not choose", () => {
    expect(planPhases(["99_unknown_agent"])).toEqual([]);
  });

  it("maps catalog ids to YAML agent keys", () => {
    expect(yamlAgentName("26_lola_elevation_researcher")).toBe("lola_elevation_researcher");
  });
});

describe("extractJson", () => {
  it("reads a plain JSON answer, a JSON-encoded string and a fenced block", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson(JSON.stringify('{"a":1}'))).toEqual({ a: 1 });
    expect(extractJson('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("returns undefined for prose", () => {
    expect(extractJson("I could not find anything.")).toBeUndefined();
  });
});

describe("runTeam", () => {
  it("runs phases in order, passes earlier outputs on, and returns synthesis separately", async () => {
    const { calls, exec } = recorder((a) => (a === "research_synthesis_specialist" ? JSON.stringify({ findingDraft: {}, spokenBriefingDraft: {} }) : out(a)));
    const res = await runTeam({ ...base, agentIds: ["26_lola_elevation_researcher", "33_hypothesis_generator", SYNTHESIS_ID] }, { exec });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(calls.map((c) => c.agent)).toEqual(["lola_elevation_researcher", "hypothesis_generator", "research_synthesis_specialist"]);
    expect(calls[0]?.prompt).not.toContain("already ran");
    expect(calls[1]?.prompt).toContain("26_lola_elevation_researcher");
    expect(res.value.outputs.map((o) => o.agentId)).toEqual(["26_lola_elevation_researcher", "33_hypothesis_generator"]);
    expect(res.value.synthesis).toEqual({ findingDraft: {}, spokenBriefingDraft: {} });
  });

  it("limits how many agents run at once", async () => {
    let running = 0;
    let peak = 0;
    const exec: AgentExec = async ({ agent }) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return { ok: true, value: out(agent) };
    };
    const ids = ["26_lola_elevation_researcher", "25_lroc_imagery_researcher", "2_lunar_image_analyst", "3_video_frame_analyst"];
    await runTeam({ ...base, agentIds: ids }, { exec, concurrency: 2 });
    expect(peak).toBe(2);
  });

  it("continues without a failed agent but fails when synthesis gives nothing", async () => {
    const { exec } = recorder((a) => (a === "lola_elevation_researcher" ? new Error("boom") : a === "research_synthesis_specialist" ? "no json here" : out(a)));
    const res = await runTeam({ ...base, agentIds: ["26_lola_elevation_researcher", "25_lroc_imagery_researcher", SYNTHESIS_ID] }, { exec });
    expect(res).toEqual({ ok: false, error: "synthesis produced no output" });
  });

  it("passes unparseable output through raw, so the orchestrator retries it and the SIE sees it", async () => {
    const { exec } = recorder(() => "not json");
    const res = await runTeam({ ...base, agentIds: ["26_lola_elevation_researcher"] }, { exec });
    expect(res.ok && res.value.outputs[0]?.output).toBe("not json");
  });

  it("labels the scientist's field note as focus, not evidence", () => {
    const prompt = agentPrompt("26_lola_elevation_researcher", { ...base, agentIds: [], fieldNotes: [{ transcript: "looks deep", descriptors: ["deep"] } as never] }, []);
    expect(prompt).toContain("Scientist's field note (verbatim, focus only, not evidence)");
  });
});

describe("rerunAgent", () => {
  it("re-runs only allowed agents, with the issues and the saved outputs", async () => {
    const { calls, exec } = recorder();
    const prior = [{ agentId: "26_lola_elevation_researcher", output: { claims: [] } }];
    const res = await rerunAgent({ ...base, agentIds: [SYNTHESIS_ID] }, SYNTHESIS_ID, ["missing evidence"], { exec }, prior);
    expect(res.ok).toBe(true);
    expect(calls[0]?.prompt).toContain("missing evidence");
    expect(calls[0]?.prompt).toContain("26_lola_elevation_researcher");
    expect(await rerunAgent({ ...base, agentIds: [] }, SYNTHESIS_ID, [], { exec })).toEqual({ ok: false, error: "agent not allowed in this run" });
  });
});

describe("dockerAgentArgs", () => {
  it("runs one agent headless in restricted safety with flavors and a model override", () => {
    const { command, args } = dockerAgentArgs("lola_elevation_researcher", { NEXUS_AGENT_FLAVORS: "container", NEXUS_GEMINI_MODEL: "gemini-x" }, "/repo");
    expect(command).toBe("docker");
    expect(args).toEqual([
      "agent", "run", "--exec", "--last", "--json", "--safety", "restricted", "--agent", "lola_elevation_researcher", "--working-dir", "/repo",
      "--flavor", "container", "--model", "google/gemini-x", "/repo/agents/nexus.yaml", "-",
    ]);
  });

  it("can call the standalone binary", () => {
    expect(dockerAgentArgs("x", { NEXUS_DOCKER_AGENT: "docker-agent" }, "/repo").command).toBe("docker-agent");
  });
});
