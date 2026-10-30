import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  agentRunContext,
  evidencePack,
  featureCollection,
  type AgentRunContext,
  type EvidenceItem,
  type MeasurementRecord,
  type Result,
  type TerrainFeature,
} from "@nexus/schemas";
import { measureFeature, parseDem } from "@nexus/terrain";

/** Directories agents may read, relative to the repo root (PRD §9: read-only source data). */
export const READABLE_ROOTS = ["data", "docs"] as const;
const MAX_READ_BYTES = 256 * 1024;
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const SITE_ID = /^[A-Z0-9_]+$/;

export interface DataStoreConfig {
  /** Repo root that holds data/ and docs/. */
  root: string;
  /** Per-run directory with context.json, team-board.jsonl and evidence-candidates.jsonl. */
  runDir: string;
}

export interface ImageFile {
  mimeType: string;
  base64: string;
}

/** Read-only access to evidence packs, terrain records and the run context. */
export class DataStore {
  constructor(readonly config: DataStoreConfig) {}

  async listSites(): Promise<string[]> {
    const files = await safeReaddir(path.join(this.config.root, "data", "evidence-packs"));
    return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length));
  }

  async evidence(siteId: string): Promise<Result<EvidenceItem[]>> {
    if (!SITE_ID.test(siteId)) return { ok: false, error: `invalid siteId: ${siteId}` };
    const raw = await readJson(path.join(this.config.root, "data", "evidence-packs", `${siteId}.json`));
    if (!raw.ok) return { ok: false, error: `no evidence pack for ${siteId}` };
    const pack = evidencePack.safeParse(raw.value);
    if (!pack.success) return { ok: false, error: `evidence pack ${siteId} failed validation` };
    return { ok: true, value: pack.data.items };
  }

  async allEvidence(): Promise<EvidenceItem[]> {
    const items: EvidenceItem[] = [];
    for (const site of await this.listSites()) {
      const res = await this.evidence(site);
      if (res.ok) items.push(...res.value);
    }
    return items;
  }

  async evidenceById(evidenceId: string): Promise<EvidenceItem | undefined> {
    // EV-<SITE>-NNN names its pack; fall back to a full scan for IDs that don't.
    const site = /^EV-([A-Z0-9_]+)-\d+$/.exec(evidenceId)?.[1];
    if (site) {
      for (const candidate of await this.listSites()) {
        if (!candidate.includes(site)) continue;
        const res = await this.evidence(candidate);
        const hit = res.ok ? res.value.find((e) => e.id === evidenceId) : undefined;
        if (hit) return hit;
      }
    }
    return (await this.allEvidence()).find((e) => e.id === evidenceId);
  }

  /**
   * MeasurementRecords computed by packages/terrain from the site's DEM and labelled features.
   * Agents never compute numbers (AGENTS.md rule 4); this is the deterministic code that does.
   */
  async measurements(siteId: string): Promise<Result<MeasurementRecord[]>> {
    const features = await this.features(siteId);
    if (!features.ok) return features;
    if (features.value.length === 0) return { ok: true, value: [] };
    const dir = path.join(this.config.root, "data", "terrain", siteId);
    const header = await readJson(path.join(dir, "dem.json"));
    if (!header.ok) return { ok: true, value: [] };
    let bytes: Buffer;
    let computedAt: string;
    try {
      bytes = await readFile(path.join(dir, "dem.bin"));
      // The DEM's timestamp keeps records stable across calls and agents in a run.
      computedAt = (await stat(path.join(dir, "dem.bin"))).mtime.toISOString();
    } catch {
      return { ok: true, value: [] };
    }
    const grid = parseDem(header.value, bytes);
    if (!grid.ok) return grid;
    const records: MeasurementRecord[] = [];
    for (const feature of features.value) {
      const res = measureFeature(grid.value, feature, computedAt);
      if (!res.ok) return { ok: false, error: `${feature.id}: ${res.error}` };
      records.push(...res.value);
    }
    return { ok: true, value: records };
  }

  async features(siteId: string): Promise<Result<TerrainFeature[]>> {
    if (!SITE_ID.test(siteId)) return { ok: false, error: `invalid siteId: ${siteId}` };
    const raw = await readJson(path.join(this.config.root, "data", "terrain", siteId, "features.json"));
    if (!raw.ok) return { ok: true, value: [] };
    const file = featureCollection.safeParse(raw.value);
    if (!file.success) return { ok: false, error: `features for ${siteId} failed validation` };
    return { ok: true, value: file.data.features };
  }

  /** True when an ID is a known evidence item or measurement record. */
  async idExists(id: string): Promise<boolean> {
    if (id.startsWith("MEAS-")) {
      for (const site of await safeReaddir(path.join(this.config.root, "data", "terrain"))) {
        if (!SITE_ID.test(site)) continue;
        const res = await this.measurements(site);
        if (res.ok && res.value.some((m) => m.id === id)) return true;
      }
      return false;
    }
    return (await this.evidenceById(id)) !== undefined;
  }

  /** Local media file for an image evidence item: data/evidence-packs/media/<id>.<ext>. */
  async evidenceImage(evidenceId: string): Promise<ImageFile | undefined> {
    const dir = path.join(this.config.root, "data", "evidence-packs", "media");
    for (const [ext, mimeType] of Object.entries(IMAGE_TYPES)) {
      try {
        const bytes = await readFile(path.join(dir, `${evidenceId}${ext}`));
        return { mimeType, base64: bytes.toString("base64") };
      } catch {
        // try the next extension
      }
    }
    return undefined;
  }

  async runContext(): Promise<Result<AgentRunContext>> {
    const raw = await readJson(path.join(this.config.runDir, "context.json"));
    if (!raw.ok) return { ok: false, error: "no run context: the orchestrator writes context.json before each run" };
    const ctx = agentRunContext.safeParse(raw.value);
    if (!ctx.success) return { ok: false, error: "run context failed validation" };
    return { ok: true, value: ctx.data };
  }

  /** Resolve a repo-relative path and refuse anything outside READABLE_ROOTS, following symlinks. */
  async resolveReadable(relPath: string): Promise<Result<string>> {
    const denied: Result<string> = { ok: false, error: `path is outside ${READABLE_ROOTS.join(", ")}: ${relPath}` };
    let abs: string;
    let root: string;
    try {
      root = await realpath(this.config.root);
      abs = await realpath(path.resolve(this.config.root, relPath));
    } catch {
      return { ok: false, error: `not found: ${relPath}` };
    }
    const inside = READABLE_ROOTS.some((r) => {
      const base = path.join(root, r);
      return abs === base || abs.startsWith(base + path.sep);
    });
    return inside ? { ok: true, value: abs } : denied;
  }

  async listFiles(relDir: string): Promise<Result<{ path: string; type: "file" | "dir"; bytes?: number }[]>> {
    const dir = await this.resolveReadable(relDir);
    if (!dir.ok) return dir;
    try {
      const entries = await readdir(dir.value, { withFileTypes: true });
      const out = [];
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const rel = path.relative(await realpath(this.config.root), path.join(dir.value, e.name));
        if (e.isDirectory()) out.push({ path: rel, type: "dir" as const });
        else if (e.isFile()) out.push({ path: rel, type: "file" as const, bytes: (await stat(path.join(dir.value, e.name))).size });
      }
      return { ok: true, value: out.sort((a, b) => a.path.localeCompare(b.path)) };
    } catch {
      return { ok: false, error: `not a directory: ${relDir}` };
    }
  }

  async readTextFile(relPath: string, offset = 0, maxBytes = MAX_READ_BYTES): Promise<Result<{ text: string; nextOffset?: number }>> {
    const file = await this.resolveReadable(relPath);
    if (!file.ok) return file;
    let bytes: Buffer;
    try {
      bytes = await readFile(file.value);
    } catch {
      return { ok: false, error: `cannot read: ${relPath}` };
    }
    const end = Math.min(bytes.length, offset + Math.min(maxBytes, MAX_READ_BYTES));
    const chunk = bytes.subarray(offset, end);
    // Binary tiles and textures are not for models; numbers come from packages/terrain (AGENTS.md rule 4).
    if (chunk.includes(0)) return { ok: false, error: `binary file, not readable as text: ${relPath}` };
    return { ok: true, value: { text: chunk.toString("utf8"), ...(end < bytes.length ? { nextOffset: end } : {}) } };
  }
}

/** Case-insensitive match on the fields an agent would search by. */
export function matchesQuery(item: EvidenceItem, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = [item.title, item.spokenLabel, item.excerpt, item.dataset, item.region?.featureId].filter(Boolean).join(" ").toLowerCase();
  return terms.every((t) => hay.includes(t));
}

async function readJson(file: string): Promise<Result<unknown>> {
  try {
    return { ok: true, value: JSON.parse(await readFile(file, "utf8")) as unknown };
  } catch {
    return { ok: false, error: `cannot read ${file}` };
  }
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}
