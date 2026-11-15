// The offline demo replays only what the SIE passed, and reviews keep the API's rules (AGENTS.md rules 2 and 8).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { demoBundle } from "@nexus/schemas";
import type { NexusEvent } from "@nexus/schemas";
import { DemoApi } from "./demoApi.js";

const bundle = demoBundle.parse(JSON.parse(readFileSync(fileURLToPath(new URL("../../../../data/demo/bundle.json", import.meta.url)), "utf8")));
const instant = { dispatchMs: 0, perAgentMs: 0, validateMs: 0 };
const settle = () => new Promise((r) => setTimeout(r, 5));

async function investigate(api: DemoApi, featureId: string, siteId: string) {
  const events: NexusEvent[] = [];
  api.events((e) => events.push(e));
  const obs = await api.createObservation(siteId, featureId, { terrainFeatureId: featureId });
  if (!obs.ok) throw new Error(obs.error);
  await api.emit("observation.selected", obs.value.id, { observationId: obs.value.id, action: "investigate", featureId });
  await settle();
  return { obs: obs.value, events };
}

describe("DemoApi (offline demo)", () => {
  it("pairs without a code and says it is offline", async () => {
    const api = new DemoApi(bundle, instant);
    expect(api.offline).toBe(true);
    expect((await api.pair("", "sci")).ok).toBe(true);
  });

  it("replays a research run ending in the bundled, SIE-passed finding", async () => {
    const api = new DemoApi(bundle, instant);
    await api.pair("", "sci");
    const { obs, events } = await investigate(api, "HADLEY_RILLE", "HADLEY_RILLE");
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("research.started");
    expect(types.at(-1)).toBe("finding.review.required");
    expect(types.filter((t) => t === "agent.task.completed").length).toBe(bundle.sites[0]?.agentIds.length);
    expect(events.every((e) => e.correlationId === obs.id)).toBe(true);
    const id = (events.at(-1)?.payload as { findingId: string }).findingId;
    const f = await api.getFinding(id);
    expect(f.ok && f.value).toEqual(bundle.sites[0]?.finding);
  });

  it("never invents a finding for a feature without precomputed research", async () => {
    const api = new DemoApi(bundle, instant);
    await api.pair("", "sci");
    const { events } = await investigate(api, "NOT_A_FEATURE", "HADLEY_RILLE");
    expect(events.map((e) => e.type)).toEqual(["research.started", "agent.task.failed"]);
    expect((await api.listFindings()).ok && (await api.listFindings())).toMatchObject({ value: [] });
  });

  it("reviews only a finding awaiting review, maps approved to reviewed, and logs the rationale verbatim", async () => {
    const api = new DemoApi(bundle, instant);
    await api.pair("", "sci");
    const { events } = await investigate(api, "ELBOW_CRATER", "ELBOW_CRATER");
    const id = (events.at(-1)?.payload as { findingId: string }).findingId;
    const r = await api.review(id, "rejected", "Wrong feature selected");
    expect(r.ok && r.value.status).toBe("rejected");
    expect(r.ok && r.value.review?.rationaleText).toBe("Wrong feature selected");
    expect((await api.review(id, "approved")).ok).toBe(false);
    const log = await api.logbook();
    expect(log.ok && log.value.map((e) => e.review.decision)).toEqual(["rejected"]);
    // The loaded bundle is untouched by a review in this tab.
    expect(bundle.sites[1]?.finding.status).toBe("ready_for_review");
    api.dispose();
  });
});
