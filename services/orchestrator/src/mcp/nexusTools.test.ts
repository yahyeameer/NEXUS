import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DataStore } from "./dataStore.js";
import { buildNexusToolServer, hostAllowed } from "./nexusTools.js";
import { TeamBoard } from "./teamBoard.js";

// Synthetic fixture for tool plumbing only. Not lunar data: the site, IDs and values are made up
// and live in a temp dir, never in data/ (AGENTS.md rule 3).
const SITE = "FIXTURE_SITE";
const pack = {
  siteId: SITE,
  version: 1,
  items: [
    {
      id: "EV-FIXTURE_SITE-001",
      siteId: SITE,
      type: "dataset",
      title: "Fixture elevation tile",
      spokenLabel: "fixture elevation data",
      dataset: "FIXTURE DEM",
      productId: "FIXTURE-PRODUCT",
      sourceUrl: "https://example.org/fixture/dem",
      credit: "test",
      license: "test",
    },
    {
      id: "EV-FIXTURE_SITE-002",
      siteId: SITE,
      type: "image",
      title: "Fixture image of the test crater",
      spokenLabel: "fixture image",
      sourceUrl: "https://example.org/fixture/image",
      region: { featureId: "TEST_CRATER" },
      credit: "test",
      license: "test",
    },
  ],
};
// Bowl crater on a 101 x 101 grid, 10 m posts: rim crest at r = 200 m around (500, 500).
const DEM = { siteId: SITE, width: 101, height: 101, cellSizeM: 10, coordinateReferenceSystem: "TEST_LOCAL", sourceEvidenceId: "EV-FIXTURE_SITE-001" };
function demBytes(): Buffer {
  const buf = Buffer.alloc(DEM.width * DEM.height * 4);
  for (let r = 0; r < DEM.height; r++)
    for (let c = 0; c < DEM.width; c++) {
      const d = Math.hypot(c * 10 - 500, r * 10 - 500);
      buf.writeFloatLE(d <= 200 ? 50 * ((d / 200) ** 2 - 1) + 10 : 10 * Math.exp(-(d - 200) / 50), (r * DEM.width + c) * 4);
    }
  return buf;
}
const features = {
  siteId: SITE,
  features: [{ id: "TEST_CRATER", siteId: SITE, kind: "crater", label: "Test crater", spokenLabel: "test crater", center: { x: 500, z: 500 }, rimRadiusM: 200 }],
};
const context = {
  runId: "RUN-1",
  observation: {
    id: "OBS-1",
    siteId: SITE,
    source: "hand_select",
    featureId: "TEST_CRATER",
    spatialAnchor: { terrainFeatureId: "TEST_CRATER" },
    createdBy: "tester",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
};

let root: string;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as { type: string; text?: string }[];
  return { isError: res.isError === true, text: content[0]?.text ?? "", content };
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nexus-tools-"));
  await mkdir(path.join(root, "data", "evidence-packs", "media"), { recursive: true });
  await mkdir(path.join(root, "data", "terrain", SITE), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, "secret"), { recursive: true });
  await writeFile(path.join(root, "data", "evidence-packs", `${SITE}.json`), JSON.stringify(pack));
  await writeFile(path.join(root, "data", "evidence-packs", "media", "EV-FIXTURE_SITE-002.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]));
  await writeFile(path.join(root, "data", "terrain", SITE, "dem.json"), JSON.stringify(DEM));
  await writeFile(path.join(root, "data", "terrain", SITE, "dem.bin"), demBytes());
  await writeFile(path.join(root, "data", "terrain", SITE, "features.json"), JSON.stringify(features));
  await writeFile(path.join(root, "docs", "NOTE.md"), "hello docs");
  await writeFile(path.join(root, "secret", "key.txt"), "nope");
  await symlink(path.join(root, "secret"), path.join(root, "docs", "escape"));
  const runDir = path.join(root, ".nexus-run");
  await mkdir(runDir);
  await writeFile(path.join(runDir, "context.json"), JSON.stringify(context));

  const server = buildNexusToolServer(new DataStore({ root, runDir }), new TeamBoard(runDir));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
  await rm(root, { recursive: true, force: true });
});

describe("nexus agent tools", () => {
  it("marks every read tool read-only so docker-agent's readonly toolset keeps it", async () => {
    const { tools } = await client.listTools();
    const writes = tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name);
    expect(writes.sort()).toEqual(["evidence_candidate_propose", "team_note_post"]);
  });

  it("looks up, filters and searches evidence", async () => {
    expect(JSON.parse((await call("evidence_lookup", { siteId: SITE })).text)).toHaveLength(2);
    expect(JSON.parse((await call("evidence_lookup", { siteId: SITE, types: ["image"] })).text)[0].id).toBe("EV-FIXTURE_SITE-002");
    expect(JSON.parse((await call("evidence_search", { query: "elevation tile" })).text)[0].id).toBe("EV-FIXTURE_SITE-001");
    expect((await call("evidence_get", { evidenceId: "EV-NOPE-001" })).isError).toBe(true);
  });

  it("returns the local image with its metadata", async () => {
    const res = await call("evidence_image", { evidenceId: "EV-FIXTURE_SITE-002" });
    expect(res.content.map((c) => c.type)).toEqual(["text", "image"]);
  });

  it("serves precomputed measurements, features, datasets and run context", async () => {
    const records = JSON.parse((await call("terrain_measurements", { siteId: SITE, featureId: "TEST_CRATER" })).text);
    expect(records.map((m: { id: string }) => m.id)).toEqual(["MEAS-FIXTURE_SITE-TEST_CRATER-DEPTH", "MEAS-FIXTURE_SITE-TEST_CRATER-DIAMETER"]);
    expect(records[0].sourceEvidenceId).toBe("EV-FIXTURE_SITE-001");
    expect(JSON.parse((await call("site_features", { siteId: SITE })).text)[0].kind).toBe("crater");
    expect(JSON.parse((await call("dataset_catalog")).text)[0].datasets).toHaveLength(1);
    expect(JSON.parse((await call("observation_get")).text).observation.id).toBe("OBS-1");
  });

  it("reads files under data/ and docs/ only", async () => {
    expect(JSON.parse((await call("data_file_read", { path: "docs/NOTE.md" })).text).text).toBe("hello docs");
    expect((await call("data_file_read", { path: "secret/key.txt" })).isError).toBe(true);
    expect((await call("data_file_read", { path: "data/../secret/key.txt" })).isError).toBe(true);
    expect((await call("data_file_read", { path: "docs/escape/key.txt" })).isError).toBe(true);
    expect((await call("data_file_read", { path: "data/evidence-packs/media/EV-FIXTURE_SITE-002.png" })).isError).toBe(true);
    expect((await call("data_files_list", { dir: "data/terrain" })).text).toContain(SITE);
  });

  it("lets agents collaborate on the team board, with refs checked against the store", async () => {
    const posted = await call("team_note_post", {
      agentId: "26_lola_elevation_researcher",
      kind: "preview",
      text: "Depth record available for the test crater.",
      refs: ["MEAS-FIXTURE_SITE-TEST_CRATER-DEPTH"],
    });
    expect(posted.isError).toBe(false);
    const q = await call("team_note_post", {
      agentId: "12_impact_crater_researcher",
      kind: "question",
      toAgentId: "25_lroc_imagery_researcher",
      text: "Is the rim sharp in the image?",
    });
    expect(q.isError).toBe(false);
    const bad = await call("team_note_post", { agentId: "x", kind: "preview", text: "t", refs: ["EV-MADE_UP-001"] });
    expect(bad.isError).toBe(true);

    const forLola = JSON.parse((await call("team_notes_read", { forAgentId: "26_lola_elevation_researcher" })).text);
    expect(forLola).toHaveLength(1); // the question was addressed to someone else
    expect(JSON.parse((await call("team_notes_read")).text)).toHaveLength(2);
  });

  it("queues candidates only from allowed https hosts", async () => {
    const ok = await call("evidence_candidate_propose", {
      agentId: "20_historical_observation_researcher",
      siteId: SITE,
      url: "https://www.hq.nasa.gov/fixture",
      title: "t",
      reason: "r",
    });
    expect(JSON.parse(ok.text).status).toBe("pending_curation");
    expect(hostAllowed("http://nasa.gov/x")).toBe(false);
    expect(hostAllowed("https://notnasa.gov/x")).toBe(false);
    expect(hostAllowed("https://evil.com/nasa.gov")).toBe(false);
  });
});
