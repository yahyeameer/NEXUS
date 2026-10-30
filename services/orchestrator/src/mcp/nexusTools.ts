import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { teamNoteKind, type Result } from "@nexus/schemas";
import { matchesQuery, READABLE_ROOTS, type DataStore } from "./dataStore.js";
import type { TeamBoard } from "./teamBoard.js";

/**
 * Hosts a proposed source may come from. Mirrors `science_fetch.allowed_domains` in
 * agents/nexus.yaml; #32 Dataset Provenance Validator still verifies every candidate.
 */
export const CANDIDATE_HOSTS = [
  "nasa.gov",
  "asu.edu",
  "usgs.gov",
  "usra.edu",
  "adsabs.harvard.edu",
  "arxiv.org",
  "doi.org",
  "esa.int",
  "jaxa.jp",
];

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
// Appends to the run's own files only: nothing in data/ or the database changes (AGENTS.md §6).
const APPEND_ONLY = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

const siteId = z.string().describe('Site ID, e.g. "HADLEY_RILLE"');
const agentId = z.string().min(1).describe('Your catalog id, e.g. "26_lola_elevation_researcher"');

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function json(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function fail(error: string): ToolResult {
  return { content: [{ type: "text", text: error }], isError: true };
}

function unwrap<T>(res: Result<T>, then: (value: T) => ToolResult): ToolResult {
  return res.ok ? then(res.value) : fail(res.error);
}

export function hostAllowed(url: string): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return CANDIDATE_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** The NEXUS tool server every agent in agents/nexus.yaml talks to over stdio. */
export function buildNexusToolServer(store: DataStore, board: TeamBoard): McpServer {
  const server = new McpServer({ name: "nexus-tools", version: "0.1.0" });

  // ---------------------------------------------------------------- evidence (read-only)

  server.registerTool(
    "evidence_lookup",
    {
      description: "List curated evidence items for a site. Only IDs returned here (or by evidence_get / evidence_search) may be cited.",
      inputSchema: {
        siteId,
        types: z.array(z.enum(["image", "measurement", "text", "dataset"])).optional(),
        featureId: z.string().optional(),
      },
      annotations: READ_ONLY,
    },
    async ({ siteId, types, featureId }) =>
      unwrap(await store.evidence(siteId), (items) =>
        json(items.filter((e) => (!types || types.includes(e.type)) && (!featureId || e.region?.featureId === featureId))),
      ),
  );

  server.registerTool(
    "evidence_get",
    { description: "Get one evidence item by ID.", inputSchema: { evidenceId: z.string() }, annotations: READ_ONLY },
    async ({ evidenceId }) => {
      const item = await store.evidenceById(evidenceId);
      return item ? json(item) : fail(`no evidence item ${evidenceId}`);
    },
  );

  server.registerTool(
    "evidence_search",
    {
      description: "Search evidence titles, spoken labels, excerpts and dataset names. All words must match.",
      inputSchema: { query: z.string().min(1), siteId: siteId.optional() },
      annotations: READ_ONLY,
    },
    async ({ query, siteId }) => {
      if (siteId) return unwrap(await store.evidence(siteId), (items) => json(items.filter((e) => matchesQuery(e, query))));
      return json((await store.allEvidence()).filter((e) => matchesQuery(e, query)));
    },
  );

  server.registerTool(
    "evidence_image",
    {
      description: "Get an image evidence item: metadata plus the image itself when a local copy exists.",
      inputSchema: { evidenceId: z.string() },
      annotations: READ_ONLY,
    },
    async ({ evidenceId }) => {
      const item = await store.evidenceById(evidenceId);
      if (!item) return fail(`no evidence item ${evidenceId}`);
      if (item.type !== "image") return fail(`${evidenceId} is a ${item.type} item, not an image`);
      const image = await store.evidenceImage(evidenceId);
      const meta = { type: "text" as const, text: JSON.stringify({ ...item, localImage: image !== undefined }, null, 2) };
      return image ? { content: [meta, { type: "image" as const, data: image.base64, mimeType: image.mimeType }] } : { content: [meta] };
    },
  );

  server.registerTool(
    "dataset_catalog",
    {
      description: "List the datasets behind the evidence (DEMs, image products) with product IDs, credits and licenses, plus the sites available.",
      inputSchema: { siteId: siteId.optional() },
      annotations: READ_ONLY,
    },
    async ({ siteId }) => {
      const sites = siteId ? [siteId] : await store.listSites();
      const out = [];
      for (const s of sites) {
        const res = await store.evidence(s);
        if (!res.ok) return fail(res.error);
        out.push({ siteId: s, datasets: res.value.filter((e) => e.type === "dataset" || e.productId) });
      }
      return json(out);
    },
  );

  // ---------------------------------------------------------------- terrain (read-only)

  server.registerTool(
    "terrain_measurements",
    {
      description: "MeasurementRecords computed by packages/terrain. Copy numbers exactly and cite the MEAS- id; never compute new numbers.",
      inputSchema: { siteId, featureId: z.string().optional() },
      annotations: READ_ONLY,
    },
    async ({ siteId, featureId }) =>
      unwrap(await store.measurements(siteId), (records) => json(records.filter((m) => !featureId || m.featureId === featureId))),
  );

  server.registerTool(
    "site_features",
    { description: "Labelled terrain features the scientist can select at a site.", inputSchema: { siteId }, annotations: READ_ONLY },
    async ({ siteId }) => unwrap(await store.features(siteId), (features) => json(features)),
  );

  // ---------------------------------------------------------------- run context (read-only)

  server.registerTool(
    "observation_get",
    {
      description: "The observation under investigation, plus the comparison observation when the scientist selected one.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      unwrap(await store.runContext(), (ctx) =>
        json({ observation: ctx.observation, comparisonObservation: ctx.comparisonObservation ?? null }),
      ),
  );

  server.registerTool(
    "fieldnote_get",
    {
      description: "The scientist's spoken field note for this observation, verbatim. Use it to focus; it is never evidence.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => unwrap(await store.runContext(), (ctx) => json(ctx.fieldNote ?? null)),
  );

  // ---------------------------------------------------------------- files (read-only)

  server.registerTool(
    "data_files_list",
    {
      description: `List files under ${READABLE_ROOTS.join("/ or ")}/ (evidence packs, terrain metadata, docs).`,
      inputSchema: { dir: z.string().default("data") },
      annotations: READ_ONLY,
    },
    async ({ dir }) => unwrap(await store.listFiles(dir), (files) => json(files)),
  );

  server.registerTool(
    "data_file_read",
    {
      description: `Read a text file under ${READABLE_ROOTS.join("/ or ")}/, up to 256 KB per call. Use nextOffset to continue. Binary tiles are refused.`,
      inputSchema: { path: z.string(), offset: z.number().int().nonnegative().default(0) },
      annotations: READ_ONLY,
    },
    async ({ path, offset }) => unwrap(await store.readTextFile(path, offset), (chunk) => json(chunk)),
  );

  // ---------------------------------------------------------------- team board (collaboration)

  server.registerTool(
    "team_notes_read",
    {
      description: "Read the team board for this run: previews, questions, answers and handoffs from the other agents. Notes are not evidence.",
      inputSchema: { forAgentId: z.string().optional(), sinceId: z.string().optional() },
      annotations: READ_ONLY,
    },
    async ({ forAgentId, sinceId }) => {
      const ctx = await store.runContext();
      if (!ctx.ok) return fail(ctx.error);
      return json(await board.read({ runId: ctx.value.runId, forAgentId, sinceId }));
    },
  );

  server.registerTool(
    "team_note_post",
    {
      description:
        "Post a short note to the team board so other agents can build on your work: a preview of a result, a question to another agent, an answer, a handoff, or a caution. refs may only hold existing EV-/MEAS- IDs.",
      inputSchema: {
        agentId,
        kind: teamNoteKind,
        text: z.string().min(1).max(600),
        toAgentId: z.string().optional(),
        replyTo: z.string().optional(),
        refs: z.array(z.string()).default([]),
      },
      annotations: APPEND_ONLY,
    },
    async ({ agentId, kind, text, toAgentId, replyTo, refs }) => {
      const ctx = await store.runContext();
      if (!ctx.ok) return fail(ctx.error);
      for (const ref of refs) if (!(await store.idExists(ref))) return fail(`unknown evidence or measurement ID: ${ref}`);
      return json(await board.post({ runId: ctx.value.runId, agentId, kind, text, toAgentId, replyTo, refs }));
    },
  );

  // ---------------------------------------------------------------- curation queue (scoped write)

  server.registerTool(
    "evidence_candidate_propose",
    {
      description: `Queue a web source for human curation. It does NOT become evidence and cannot be cited. https only, hosts: ${CANDIDATE_HOSTS.join(", ")}.`,
      inputSchema: { agentId, siteId, url: z.string().url(), title: z.string().min(1).max(300), reason: z.string().min(1).max(600) },
      annotations: APPEND_ONLY,
    },
    async ({ agentId, siteId, url, title, reason }) => {
      if (!hostAllowed(url)) return fail(`host not allowed for candidates: ${url}`);
      const ctx = await store.runContext();
      if (!ctx.ok) return fail(ctx.error);
      return json(await board.propose({ runId: ctx.value.runId, agentId, siteId, url, title, reason }));
    },
  );

  return server;
}
